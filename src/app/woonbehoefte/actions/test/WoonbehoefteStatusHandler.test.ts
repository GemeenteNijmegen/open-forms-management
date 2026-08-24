import { randomBytes } from 'crypto';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteStatusHandler } from '../WoonbehoefteStatusHandler';

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

describe('WoonbehoefteStatusHandler', () => {
  it('rejects INADMISSIBLE on the regular status route: only confirmInadmissible may set it', async () => {
    const caseRepository = { getCase: jest.fn(), changeStatus: jest.fn(), proposeInadmissible: jest.fn() };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteStatusHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleChangeStatus(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', status: 'INADMISSIBLE', csrfToken }), false,
    );

    expect(response.statusCode).toBe(400);
    expect(caseRepository.getCase).not.toHaveBeenCalled();
  });

  it('routes a change to PROPOSED_INADMISSIBLE through proposeInadmissible, not changeStatus', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', status: 'IN_PROGRESS', version: 3 }),
      changeStatus: jest.fn(),
      proposeInadmissible: jest.fn().mockResolvedValue('OK'),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteStatusHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    await handler.handleChangeStatus(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader,
      form({ expectedVersion: '3', status: 'PROPOSED_INADMISSIBLE', motivering: 'Geen geldige overeenkomst aangetoond', csrfToken }), false,
    );

    expect(caseRepository.proposeInadmissible).toHaveBeenCalledWith('OF-1', 'medewerker', 3, 'IN_PROGRESS', 'Geen geldige overeenkomst aangetoond');
    expect(caseRepository.changeStatus).not.toHaveBeenCalled();
  });

  it('rejects PROPOSED_INADMISSIBLE without a motivering: it must be directly attached to the action', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', status: 'IN_PROGRESS', version: 3 }),
      proposeInadmissible: jest.fn(),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteStatusHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleChangeStatus(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '3', status: 'PROPOSED_INADMISSIBLE', csrfToken }), false,
    );

    expect(response.statusCode).toBe(400);
    expect(caseRepository.proposeInadmissible).not.toHaveBeenCalled();
  });

  it('reopens freely between working statuses with no transition matrix', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', status: 'READY_FOR_RANKING', version: 5 }),
      changeStatus: jest.fn().mockResolvedValue('OK'),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteStatusHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    await handler.handleChangeStatus({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '5', status: 'IN_PROGRESS', csrfToken }), false);

    expect(caseRepository.changeStatus).toHaveBeenCalledWith('OF-1', 'medewerker', 5, 'READY_FOR_RANKING', 'IN_PROGRESS');
  });

  it('confirmInadmissible refuses (409) unless the case is currently PROPOSED_INADMISSIBLE', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', status: 'IN_PROGRESS', version: 2 }),
      confirmInadmissible: jest.fn(),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteStatusHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleConfirmInadmissible({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '2', csrfToken }), false);

    expect(response.statusCode).toBe(409);
    expect(caseRepository.confirmInadmissible).not.toHaveBeenCalled();
  });

  it('confirmInadmissible succeeds from PROPOSED_INADMISSIBLE, no other actor required, and closes an open check', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', status: 'PROPOSED_INADMISSIBLE', version: 4, check: { requested: true } }),
      confirmInadmissible: jest.fn().mockResolvedValue('OK'),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteStatusHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleConfirmInadmissible({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '4', csrfToken }), false);

    expect(caseRepository.confirmInadmissible).toHaveBeenCalledWith('OF-1', 'medewerker', 4, true);
    expect(response.statusCode).toBe(303);
  });
});
