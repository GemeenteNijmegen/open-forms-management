import { randomBytes } from 'crypto';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteCase } from '../../domain/WoonbehoefteCase';
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

function makeCase(overrides: Partial<WoonbehoefteCase> = {}): WoonbehoefteCase {
  return {
    caseReference: 'OF-1',
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

describe('WoonbehoefteCheckHandler', () => {
  it('requests a check, no requester-specific gate', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue(makeCase({ check: { requested: false }, version: 1 })),
      requestCheck: jest.fn().mockResolvedValue('OK'),
      completeCheck: jest.fn(),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteCheckHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    await handler.handleRequest('request', { principalId: 'medewerker', email: 'a@example.nl' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', csrfToken }), false);

    expect(caseRepository.requestCheck).toHaveBeenCalledWith('OF-1', 'a@example.nl', 1, undefined);
  });

  it('lets the same medewerker complete a check they themselves requested (no vierogenprincipe)', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue(makeCase({ check: { requested: true, requestedBy: 'a@example.nl' }, version: 2 })),
      requestCheck: jest.fn(),
      completeCheck: jest.fn().mockResolvedValue('OK'),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteCheckHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest(
      'complete', { principalId: 'medewerker', email: 'a@example.nl' }, 'OF-1', cookieHeader, form({ expectedVersion: '2', outcome: 'OK', csrfToken }), false,
    );

    expect(caseRepository.completeCheck).toHaveBeenCalledWith('OF-1', 'a@example.nl', 2, 'OK', undefined);
    expect(response.statusCode).toBe(303);
  });

  it('passes the optional toelichting straight to the repository: no separate note write that could orphan on a failed check mutation', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue(makeCase({ check: { requested: false }, version: 1 })),
      requestCheck: jest.fn().mockResolvedValue('OK'),
      completeCheck: jest.fn(),
      addNote: jest.fn(),
    };
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
    const caseRepository = { getCase: jest.fn(), requestCheck: jest.fn(), completeCheck: jest.fn() };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteCheckHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest(
      'complete', { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '2', outcome: 'MAYBE', csrfToken }), false,
    );

    expect(response.statusCode).toBe(400);
    expect(caseRepository.getCase).not.toHaveBeenCalled();
    expect(caseRepository.completeCheck).not.toHaveBeenCalled();
  });

  it('returns 404 without any mutation when the case does not exist', async () => {
    const caseRepository = { getCase: jest.fn().mockResolvedValue(undefined), requestCheck: jest.fn(), completeCheck: jest.fn() };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteCheckHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest(
      'request', { principalId: 'medewerker' }, 'OF-missing', cookieHeader, form({ expectedVersion: '1', csrfToken }), false,
    );

    expect(response.statusCode).toBe(404);
    expect(caseRepository.requestCheck).not.toHaveBeenCalled();
  });

  it('refuses to request a check that is already open: 409, no mutation', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue(makeCase({ check: { requested: true, requestedBy: 'someone-else@example.nl' }, version: 3 })),
      requestCheck: jest.fn(),
      completeCheck: jest.fn(),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteCheckHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest(
      'request', { principalId: 'medewerker', email: 'a@example.nl' }, 'OF-1', cookieHeader, form({ expectedVersion: '3', csrfToken }), false,
    );

    expect(response.statusCode).toBe(409);
    expect(caseRepository.requestCheck).not.toHaveBeenCalled();
  });

  it('refuses to complete a check when there is no open check: 409, no mutation', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue(makeCase({ check: { requested: false }, version: 4 })),
      requestCheck: jest.fn(),
      completeCheck: jest.fn(),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteCheckHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest(
      'complete', { principalId: 'medewerker', email: 'a@example.nl' }, 'OF-1', cookieHeader, form({ expectedVersion: '4', outcome: 'OK', csrfToken }), false,
    );

    expect(response.statusCode).toBe(409);
    expect(caseRepository.completeCheck).not.toHaveBeenCalled();
  });
});
