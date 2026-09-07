import { randomBytes } from 'crypto';
import { AuditTrail } from '../../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteCaseRepository } from '../../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteCase } from '../../../domain/WoonbehoefteCase';
import { ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceRecord } from '../../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceRepository, AdditionalEvidenceWorkItem } from '../../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../../source/AdditionalEvidenceSourceCacheStore';
import { AdditionalEvidenceLinkHandler } from '../AdditionalEvidenceLinkHandler';
import { AdditionalEvidenceLinkRepository } from '../AdditionalEvidenceLinkRepository';

const csrfToken = randomBytes(32).toString('base64url');
const cookieHeader = `${CSRF_COOKIE_NAME}=${csrfToken}`;

function makeAuthorizationService(grants: { resource: string; actions: string[] }[]): AuthorizationService {
  const evaluator = new PermissionEvaluator(grants);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' }, evaluator }),
    requireAuthorization: jest.fn().mockImplementation(async (context, check) => (evaluator.evaluate(check) === 'ALLOW' ? undefined : { statusCode: 403 })),
    denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
  } as unknown as AuthorizationService;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function workItem(overrides: Partial<AdditionalEvidenceWorkItem> = {}): AdditionalEvidenceWorkItem {
  return {
    objectUuid: 'uuid-1',
    submissionReference: 'OF-EXTRA01',
    status: 'NEW',
    createdAt: '2026-09-07T18:00:00.000Z',
    createdBy: 'additional-evidence-sync-worker',
    ...overrides,
  };
}

function source(overrides: Partial<AdditionalEvidenceSourceRecord> = {}): AdditionalEvidenceSourceRecord {
  return {
    status: 'READY',
    cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
    objectUuid: 'uuid-1',
    submissionId: 'uuid-1',
    reference: 'OF-EXTRA01',
    formName: 'Extra bewijzen stroomaansluiting woningbouw',
    submittedAt: '2026-09-07T17:54:04.702Z',
    originalCaseReference: 'OF-HOOFD01',
    attachments: [{ documentId: 'att-1', url: 'https://example.invalid/att-1', role: 'ATTACHMENT' }],
    evidenceDescription: 'Aanvullende planning.',
    cachedAt: '2026-09-07T18:00:00.000Z',
    ...overrides,
  };
}

function woonbehoefteCase(overrides: Partial<WoonbehoefteCase> & { caseReference: string }): WoonbehoefteCase {
  return {
    status: 'IN_PROGRESS',
    statusChangedAt: '2026-08-01T00:00:00.000Z',
    assessment: {},
    check: { requested: false },
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'woonbehoefte-sync-worker',
    updatedAt: '2026-08-01T00:00:00.000Z',
    updatedBy: 'woonbehoefte-sync-worker',
    ...overrides,
  };
}

describe('AdditionalEvidenceLinkHandler', () => {
  it('links, audits documentCount and redirects with saved=linked', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', source()]])) } as unknown as AdditionalEvidenceSourceCacheStore;
    const primaryCaseRepository = { getCase: jest.fn().mockResolvedValue(woonbehoefteCase({ caseReference: 'OF-HOOFD01' })) } as unknown as WoonbehoefteCaseRepository;
    const linkRepository = { link: jest.fn().mockResolvedValue('OK') } as unknown as AdditionalEvidenceLinkRepository;
    const record = jest.fn().mockResolvedValue(undefined);
    const handler = new AdditionalEvidenceLinkHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, sourceCacheStore, primaryCaseRepository, linkRepository,
      { record } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, targetCaseReference: 'OF-HOOFD01' }), false,
    );

    expect(linkRepository.link).toHaveBeenCalledWith(
      'uuid-1', 'OF-EXTRA01', 'OF-HOOFD01', expect.stringContaining('Automatisch toegevoegd vanuit extra-bewijzeninzending OF-EXTRA01.'), 'medewerker',
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?saved=linked#koppelen');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'WOONBEHOEFTE_ADDITIONAL_EVIDENCE_LINKED',
      metadata: { additionalSubmissionReference: 'OF-EXTRA01', submissionId: 'uuid-1', caseReference: 'OF-HOOFD01', documentCount: 1 },
    }));
  });

  it('returns 404 for an unknown submissionId', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(undefined) } as unknown as AdditionalEvidenceRepository;
    const handler = new AdditionalEvidenceLinkHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository,
      { getItems: jest.fn() } as unknown as AdditionalEvidenceSourceCacheStore, {} as WoonbehoefteCaseRepository,
      { link: jest.fn() } as unknown as AdditionalEvidenceLinkRepository, { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-missing', cookieHeader, form({ csrfToken, targetCaseReference: 'OF-HOOFD01' }), false,
    );

    expect(response.statusCode).toBe(404);
  });

  it('redirects with a conflict marker for an already-LINKED workitem, without ever attempting the transaction', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem({ status: 'LINKED' })) } as unknown as AdditionalEvidenceRepository;
    const linkRepository = { link: jest.fn() } as unknown as AdditionalEvidenceLinkRepository;
    const handler = new AdditionalEvidenceLinkHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository,
      { getItems: jest.fn() } as unknown as AdditionalEvidenceSourceCacheStore, {} as WoonbehoefteCaseRepository, linkRepository,
      { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, targetCaseReference: 'OF-HOOFD01' }), false,
    );

    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?linkError=conflict#koppelen');
    expect(linkRepository.link).not.toHaveBeenCalled();
  });

  it('redirects with a generic failure marker when the target case no longer exists', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const primaryCaseRepository = { getCase: jest.fn().mockResolvedValue(undefined) } as unknown as WoonbehoefteCaseRepository;
    const linkRepository = { link: jest.fn() } as unknown as AdditionalEvidenceLinkRepository;
    const handler = new AdditionalEvidenceLinkHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository,
      { getItems: jest.fn() } as unknown as AdditionalEvidenceSourceCacheStore, primaryCaseRepository, linkRepository,
      { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, targetCaseReference: 'OF-VERDWENEN' }), false,
    );

    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?linkError=failed#koppelen');
    expect(linkRepository.link).not.toHaveBeenCalled();
  });

  it('redirects with a generic failure marker when this submission\'s own source is not READY', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const primaryCaseRepository = { getCase: jest.fn().mockResolvedValue(woonbehoefteCase({ caseReference: 'OF-HOOFD01' })) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map()) } as unknown as AdditionalEvidenceSourceCacheStore;
    const linkRepository = { link: jest.fn() } as unknown as AdditionalEvidenceLinkRepository;
    const handler = new AdditionalEvidenceLinkHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, sourceCacheStore, primaryCaseRepository, linkRepository,
      { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, targetCaseReference: 'OF-HOOFD01' }), false,
    );

    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?linkError=failed#koppelen');
    expect(linkRepository.link).not.toHaveBeenCalled();
  });

  it('redirects with a conflict marker when the transaction itself reports CONFLICT, without auditing', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', source()]])) } as unknown as AdditionalEvidenceSourceCacheStore;
    const primaryCaseRepository = { getCase: jest.fn().mockResolvedValue(woonbehoefteCase({ caseReference: 'OF-HOOFD01' })) } as unknown as WoonbehoefteCaseRepository;
    const linkRepository = { link: jest.fn().mockResolvedValue('CONFLICT') } as unknown as AdditionalEvidenceLinkRepository;
    const record = jest.fn().mockResolvedValue(undefined);
    const handler = new AdditionalEvidenceLinkHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, sourceCacheStore, primaryCaseRepository, linkRepository,
      { record } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, targetCaseReference: 'OF-HOOFD01' }), false,
    );

    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?linkError=conflict#koppelen');
    expect(record).not.toHaveBeenCalled();
  });

  it('preserves the sanitized back-filter on redirect', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', source()]])) } as unknown as AdditionalEvidenceSourceCacheStore;
    const primaryCaseRepository = { getCase: jest.fn().mockResolvedValue(woonbehoefteCase({ caseReference: 'OF-HOOFD01' })) } as unknown as WoonbehoefteCaseRepository;
    const linkRepository = { link: jest.fn().mockResolvedValue('OK') } as unknown as AdditionalEvidenceLinkRepository;
    const handler = new AdditionalEvidenceLinkHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, sourceCacheStore, primaryCaseRepository, linkRepository,
      { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, targetCaseReference: 'OF-HOOFD01', back: 'status=NEW' }), false,
    );

    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?back=status%3DNEW&saved=linked#koppelen');
  });

  it('denies without woonbehoefte:manage', async () => {
    const repository = { getWorkItem: jest.fn() } as unknown as AdditionalEvidenceRepository;
    const handler = new AdditionalEvidenceLinkHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]), repository,
      { getItems: jest.fn() } as unknown as AdditionalEvidenceSourceCacheStore, {} as WoonbehoefteCaseRepository,
      { link: jest.fn() } as unknown as AdditionalEvidenceLinkRepository, { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, targetCaseReference: 'OF-HOOFD01' }), false,
    );

    expect(response.statusCode).toBe(403);
    expect(repository.getWorkItem).not.toHaveBeenCalled();
  });

  it('denies a request without a valid CSRF token', async () => {
    const repository = { getWorkItem: jest.fn() } as unknown as AdditionalEvidenceRepository;
    const handler = new AdditionalEvidenceLinkHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository,
      { getItems: jest.fn() } as unknown as AdditionalEvidenceSourceCacheStore, {} as WoonbehoefteCaseRepository,
      { link: jest.fn() } as unknown as AdditionalEvidenceLinkRepository, { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken: 'wrong-token', targetCaseReference: 'OF-HOOFD01' }), false,
    );

    expect(response.statusCode).toBe(403);
    expect(repository.getWorkItem).not.toHaveBeenCalled();
  });

  it('rejects a request without a targetCaseReference', async () => {
    const repository = { getWorkItem: jest.fn() } as unknown as AdditionalEvidenceRepository;
    const handler = new AdditionalEvidenceLinkHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository,
      { getItems: jest.fn() } as unknown as AdditionalEvidenceSourceCacheStore, {} as WoonbehoefteCaseRepository,
      { link: jest.fn() } as unknown as AdditionalEvidenceLinkRepository, { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken }), false);

    expect(response.statusCode).toBe(400);
    expect(repository.getWorkItem).not.toHaveBeenCalled();
  });
});
