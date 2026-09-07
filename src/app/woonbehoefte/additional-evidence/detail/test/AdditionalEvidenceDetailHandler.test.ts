import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { OpenZaakClient } from '../../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseRepository, WoonbehoefteCaseItems } from '../../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteCase } from '../../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../../../source/WoonbehoefteSourceCacheStore';
import { ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceRecord } from '../../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceRepository, AdditionalEvidenceWorkItem } from '../../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../../source/AdditionalEvidenceSourceCacheStore';
import { AdditionalEvidenceDetailHandler } from '../AdditionalEvidenceDetailHandler';

function makeAuthorizationService(): AuthorizationService {
  const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['view'] }]);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' }, evaluator }),
    requireAuthorization: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuthorizationService;
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
    attachments: [],
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

function primarySource(overrides: Partial<WoonbehoefteSourceRecord> = {}): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: 'uuid-primary-1',
    submissionId: 'uuid-primary-1',
    submissionType: 'PRIMARY_APPLICATION',
    reference: 'OF-HOOFD01',
    caseReference: 'OF-HOOFD01',
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-01T00:00:00.000Z',
    applicantType: 'UNKNOWN',
    attachments: [],
    cachedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function emptyCaseItems(): WoonbehoefteCaseItems {
  return { sourceLinks: [], notes: [], activities: [] };
}

function noPrimaryCaseRepository(): WoonbehoefteCaseRepository {
  return { getCase: jest.fn().mockResolvedValue(undefined), getCaseItems: jest.fn() } as unknown as WoonbehoefteCaseRepository;
}

function noPrimarySourceCacheStore(): WoonbehoefteSourceCacheStore {
  return { getItems: jest.fn() } as unknown as WoonbehoefteSourceCacheStore;
}

describe('AdditionalEvidenceDetailHandler', () => {
  it('returns 404 for an unknown submissionId', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(undefined) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn() } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const handler = new AdditionalEvidenceDetailHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, noPrimaryCaseRepository(), noPrimarySourceCacheStore(),
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-missing', undefined);

    expect(response.statusCode).toBe(404);
    expect(sourceCacheStore.getItems).not.toHaveBeenCalled();
  });

  it('renders the submission with its current source data', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', source({ submittedProjectName: 'Project Lindenhof' })]])),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const handler = new AdditionalEvidenceDetailHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, noPrimaryCaseRepository(), noPrimarySourceCacheStore(),
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('OF-EXTRA01');
    expect(response.body).toContain('Project Lindenhof');
    expect(response.body).toContain('OF-HOOFD01');
  });

  it('still renders when the source is missing entirely (race just after workitem creation), with a bronfout warning', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map()) } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const handler = new AdditionalEvidenceDetailHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, noPrimaryCaseRepository(), noPrimarySourceCacheStore(),
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('nog niet beschikbaar');
  });

  it('does not look up a hoofdzaak when no search was performed', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', source()]])) } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const primaryCaseRepository = noPrimaryCaseRepository();
    const handler = new AdditionalEvidenceDetailHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, primaryCaseRepository, noPrimarySourceCacheStore(),
    );

    await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', undefined);

    expect(primaryCaseRepository.getCase).not.toHaveBeenCalled();
  });

  it('shows the found hoofdzaak with its READY primary projectnaam/status/e-mail, distinctly labelled', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', source()]])) } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const primaryCaseRepository = {
      getCase: jest.fn().mockResolvedValue(woonbehoefteCase({ caseReference: 'OF-HOOFD01' })),
      getCaseItems: jest.fn().mockResolvedValue({
        ...emptyCaseItems(),
        sourceLinks: [{ caseReference: 'OF-HOOFD01', submissionId: 'uuid-primary-1', submissionReference: 'OF-HOOFD01', relation: 'PRIMARY', linkedAt: '2026-08-01T00:00:00.000Z' }],
      }),
    } as unknown as WoonbehoefteCaseRepository;
    const primarySourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-primary-1', primarySource({ projectName: 'Project Lindenhof fase 2', contactEmail: 'project@example.invalid' })]])),
    } as unknown as WoonbehoefteSourceCacheStore;
    const handler = new AdditionalEvidenceDetailHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, primaryCaseRepository, primarySourceCacheStore,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', { searchCaseReference: 'OF-HOOFD01' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Hoofdzaak gevonden');
    expect(response.body).toContain('Project Lindenhof fase 2');
    expect(response.body).toContain('In behandeling');
    expect(response.body).toContain('project@example.invalid');
  });

  it('shows the found hoofdzaak with a warning, never blocking, when its primary source is missing/FAILED', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', source()]])) } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const primaryCaseRepository = {
      getCase: jest.fn().mockResolvedValue(woonbehoefteCase({ caseReference: 'OF-HOOFD01' })),
      getCaseItems: jest.fn().mockResolvedValue(emptyCaseItems()),
    } as unknown as WoonbehoefteCaseRepository;
    const primarySourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map()) } as unknown as WoonbehoefteSourceCacheStore;
    const handler = new AdditionalEvidenceDetailHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, primaryCaseRepository, primarySourceCacheStore,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', { searchCaseReference: 'OF-HOOFD01' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Hoofdzaak gevonden');
    expect(response.body).toContain('konden niet volledig worden geladen');
  });

  it('shows a clear not-found message and keeps the searched kenmerk, without creating anything', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', source()]])) } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const primaryCaseRepository = noPrimaryCaseRepository();
    const handler = new AdditionalEvidenceDetailHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, primaryCaseRepository, noPrimarySourceCacheStore(),
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', { searchCaseReference: 'OF-ONBEKEND99' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Geen hoofdzaak gevonden met kenmerk OF-ONBEKEND99');
    expect(response.body).toContain('value="OF-ONBEKEND99"');
  });

  it('finds a different, corrected hoofdzaak when the medewerker adjusts the zoekkenmerk', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', source({ originalCaseReference: 'OF-VERKEERD' })]])),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const primaryCaseRepository = {
      getCase: jest.fn().mockImplementation(async (ref: string) => (ref === 'OF-GECORRIGEERD' ? woonbehoefteCase({ caseReference: 'OF-GECORRIGEERD' }) : undefined)),
      getCaseItems: jest.fn().mockResolvedValue(emptyCaseItems()),
    } as unknown as WoonbehoefteCaseRepository;
    const primarySourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map()) } as unknown as WoonbehoefteSourceCacheStore;
    const handler = new AdditionalEvidenceDetailHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, primaryCaseRepository, primarySourceCacheStore,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', { searchCaseReference: 'OF-GECORRIGEERD' });

    expect(response.body).toContain('Hoofdzaak gevonden');
    expect(response.body).toContain('OF-GECORRIGEERD');
  });
});
