import { randomBytes } from 'crypto';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteCheckHandler } from '../WoonbehoefteCheckHandler';

const csrfToken = randomBytes(32).toString('base64url');
const cookieHeader = `${CSRF_COOKIE_NAME}=${csrfToken}`;

function makeAuthorizationService(): AuthorizationService {
  const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['manage'] }]);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' }, evaluator }),
    requireAuthorization: jest.fn().mockResolvedValue(undefined),
    denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
  } as unknown as AuthorizationService;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('WoonbehoefteCheckHandler', () => {
  it('requests a check, no requester-specific gate', async () => {
    const caseRepository = { requestCheck: jest.fn().mockResolvedValue('OK'), completeCheck: jest.fn() };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteCheckHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    await handler.handleRequest('request', { principalId: 'medewerker', email: 'a@example.nl' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', csrfToken }), false);

    expect(caseRepository.requestCheck).toHaveBeenCalledWith('OF-1', 'a@example.nl', 1, undefined);
  });

  it('lets the same medewerker complete a check they themselves requested (no vierogenprincipe)', async () => {
    const caseRepository = { requestCheck: jest.fn(), completeCheck: jest.fn().mockResolvedValue('OK') };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteCheckHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest(
      'complete', { principalId: 'medewerker', email: 'a@example.nl' }, 'OF-1', cookieHeader, form({ expectedVersion: '2', outcome: 'OK', csrfToken }), false,
    );

    expect(caseRepository.completeCheck).toHaveBeenCalledWith('OF-1', 'a@example.nl', 2, 'OK', undefined);
    expect(response.statusCode).toBe(303);
  });

  it('passes the optional toelichting straight to the repository: no separate note write that could orphan on a failed check mutation', async () => {
    const caseRepository = { requestCheck: jest.fn().mockResolvedValue('OK'), completeCheck: jest.fn(), addNote: jest.fn() };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteCheckHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    await handler.handleRequest(
      'request', { principalId: 'medewerker', email: 'a@example.nl' }, 'OF-1', cookieHeader,
      form({ expectedVersion: '1', note: 'Controleer de BOPA', csrfToken }), false,
    );

    expect(caseRepository.requestCheck).toHaveBeenCalledWith('OF-1', 'a@example.nl', 1, 'Controleer de BOPA');
    expect(caseRepository.addNote).not.toHaveBeenCalled();
  });

  it('rejects an unknown check outcome', async () => {
    const caseRepository = { requestCheck: jest.fn(), completeCheck: jest.fn() };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteCheckHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest(
      'complete', { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '2', outcome: 'MAYBE', csrfToken }), false,
    );

    expect(response.statusCode).toBe(400);
    expect(caseRepository.completeCheck).not.toHaveBeenCalled();
  });
});
