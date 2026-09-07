import { randomBytes } from 'crypto';
import { AuditTrail } from '../../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../../shared/security/csrf/CsrfProtection';
import { AdditionalEvidenceRepository } from '../../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceStatusHandler } from '../AdditionalEvidenceStatusHandler';

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

describe('AdditionalEvidenceStatusHandler', () => {
  it('changes the status and audits fromStatus/toStatus on success', async () => {
    const repository = {
      changeStatus: jest.fn().mockResolvedValue({ result: 'OK', fromStatus: 'NEW', submissionReference: 'OF-EXTRA01' }),
    } as unknown as AdditionalEvidenceRepository;
    const record = jest.fn().mockResolvedValue(undefined);
    const handler = new AdditionalEvidenceStatusHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, { record } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, status: 'UNKNOWN' }), false,
    );

    expect(repository.changeStatus).toHaveBeenCalledWith('uuid-1', 'UNKNOWN');
    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?saved=status');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'WOONBEHOEFTE_ADDITIONAL_EVIDENCE_STATUS_CHANGED',
      metadata: { submissionReference: 'OF-EXTRA01', fromStatus: 'NEW', toStatus: 'UNKNOWN' },
    }));
  });

  it('redirects with saved=status on a no-op resave, without auditing', async () => {
    const repository = {
      changeStatus: jest.fn().mockResolvedValue({ result: 'NOOP', fromStatus: 'NEW', submissionReference: 'OF-EXTRA01' }),
    } as unknown as AdditionalEvidenceRepository;
    const record = jest.fn().mockResolvedValue(undefined);
    const handler = new AdditionalEvidenceStatusHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, { record } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, status: 'NEW' }), false,
    );

    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?saved=status');
    expect(record).not.toHaveBeenCalled();
  });

  it('redirects with a linked-conflict marker instead of moving an already-LINKED workitem', async () => {
    const repository = {
      changeStatus: jest.fn().mockResolvedValue({ result: 'LINKED', fromStatus: 'LINKED', submissionReference: 'OF-EXTRA01' }),
    } as unknown as AdditionalEvidenceRepository;
    const handler = new AdditionalEvidenceStatusHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, status: 'UNKNOWN' }), false,
    );

    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?status=linked-conflict');
  });

  it('preserves the sanitized back-filter on redirect', async () => {
    const repository = {
      changeStatus: jest.fn().mockResolvedValue({ result: 'OK', fromStatus: 'NEW', submissionReference: 'OF-EXTRA01' }),
    } as unknown as AdditionalEvidenceRepository;
    const handler = new AdditionalEvidenceStatusHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, status: 'UNKNOWN', back: 'status=NEW' }), false,
    );

    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?back=status%3DNEW&saved=status');
  });

  it('returns 404 for an unknown submissionId', async () => {
    const repository = { changeStatus: jest.fn().mockResolvedValue({ result: 'NOT_FOUND' }) } as unknown as AdditionalEvidenceRepository;
    const handler = new AdditionalEvidenceStatusHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-missing', cookieHeader, form({ csrfToken, status: 'UNKNOWN' }), false,
    );

    expect(response.statusCode).toBe(404);
  });

  it('rejects an unknown target status (LINKED is never a valid manual target)', async () => {
    const repository = { changeStatus: jest.fn() } as unknown as AdditionalEvidenceRepository;
    const handler = new AdditionalEvidenceStatusHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, status: 'LINKED' }), false,
    );

    expect(response.statusCode).toBe(400);
    expect(repository.changeStatus).not.toHaveBeenCalled();
  });

  it('denies without woonbehoefte:manage', async () => {
    const repository = { changeStatus: jest.fn() } as unknown as AdditionalEvidenceRepository;
    const handler = new AdditionalEvidenceStatusHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]), repository, { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, status: 'UNKNOWN' }), false,
    );

    expect(response.statusCode).toBe(403);
  });

  it('denies a request without a valid CSRF token', async () => {
    const repository = { changeStatus: jest.fn() } as unknown as AdditionalEvidenceRepository;
    const handler = new AdditionalEvidenceStatusHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['manage'] }]), repository, { record: jest.fn() } as unknown as AuditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken: 'wrong-token', status: 'UNKNOWN' }), false,
    );

    expect(response.statusCode).toBe(403);
    expect(repository.changeStatus).not.toHaveBeenCalled();
  });
});
