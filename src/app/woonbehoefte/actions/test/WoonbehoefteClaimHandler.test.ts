import { randomBytes } from 'crypto';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteClaimHandler } from '../WoonbehoefteClaimHandler';

const csrfToken = randomBytes(32).toString('base64url');
const cookieHeader = `${CSRF_COOKIE_NAME}=${csrfToken}`;

function makeAuthorizationService(allowed: boolean): AuthorizationService {
  const evaluator = new PermissionEvaluator(allowed ? [{ resource: 'woonbehoefte', actions: ['manage'] }] : []);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' }, evaluator }),
    requireAuthorization: jest.fn().mockImplementation(async () => (allowed ? undefined : { statusCode: 403 })),
    denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
  } as unknown as AuthorizationService;
}

function makeCaseRepository() {
  return {
    getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', status: 'NEW', claimedBy: undefined, version: 1 }),
    claim: jest.fn().mockResolvedValue('OK'),
    release: jest.fn().mockResolvedValue('OK'),
    takeOver: jest.fn().mockResolvedValue('OK'),
  };
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('WoonbehoefteClaimHandler', () => {
  it('rejects a missing/invalid CSRF token with a 403, without ever calling claim', async () => {
    const caseRepository = makeCaseRepository();
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteClaimHandler(makeAuthorizationService(true), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest('claim', { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', csrfToken: 'wrong-token' }), false);

    expect(response.statusCode).toBe(403);
    expect(caseRepository.claim).not.toHaveBeenCalled();
  });

  it('claims a NEW case, passing its current status so the repository can auto-start it', async () => {
    const caseRepository = makeCaseRepository();
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteClaimHandler(makeAuthorizationService(true), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest('claim', { principalId: 'medewerker', email: 'medewerker@example.nl' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', csrfToken }), false);

    expect(caseRepository.claim).toHaveBeenCalledWith('OF-1', 'medewerker@example.nl', 1, 'NEW');
    expect(response.statusCode).toBe(303);
  });

  it('redirects with a stale-version status when the case changed since the form was rendered', async () => {
    const caseRepository = makeCaseRepository();
    caseRepository.claim.mockResolvedValue('STALE_VERSION');
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteClaimHandler(makeAuthorizationService(true), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest('claim', { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', csrfToken }), false);

    expect(response.headers?.Location).toContain('status=stale');
    expect(auditTrail.record).not.toHaveBeenCalled();
  });

  it('take-over passes the previous assignee for the activity trail', async () => {
    const caseRepository = makeCaseRepository();
    caseRepository.getCase.mockResolvedValue({ caseReference: 'OF-1', status: 'IN_PROGRESS', claimedBy: 'ander@example.nl', version: 2 });
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteClaimHandler(makeAuthorizationService(true), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    await handler.handleRequest('takeOver', { principalId: 'medewerker', email: 'nieuw@example.nl' }, 'OF-1', cookieHeader, form({ expectedVersion: '2', csrfToken }), false);

    expect(caseRepository.takeOver).toHaveBeenCalledWith('OF-1', 'nieuw@example.nl', 2, 'ander@example.nl');
  });
});
