import { randomBytes } from 'crypto';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteAssessmentHandler } from '../WoonbehoefteAssessmentHandler';

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

describe('WoonbehoefteAssessmentHandler', () => {
  it('combines month+year fields into one YYYYMM assessedStartPeriod', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', version: 1, assessment: {} }),
      updateAssessment: jest.fn().mockResolvedValue('OK'),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteAssessmentHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail,
    );

    await handler.handleRequest(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader,
      form({ expectedVersion: '1', assessedStartMonth: '9', assessedStartYear: '2028', csrfToken }), false,
    );

    expect(caseRepository.updateAssessment).toHaveBeenCalledWith(
      'OF-1', 'medewerker', 1, { set: { assessedStartPeriod: 202809 }, remove: [] }, expect.any(Array),
    );
  });

  it('resubmitting the same ternary value is a no-op: nothing to write', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', version: 1, assessment: { applicationComplete: 'YES' } }),
      updateAssessment: jest.fn().mockResolvedValue('OK'),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteAssessmentHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail,
    );

    await handler.handleRequest(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', applicationComplete: 'YES', csrfToken }), false,
    );

    expect(caseRepository.updateAssessment).not.toHaveBeenCalled();
  });

  it('an empty ternary select ("Nog niet beoordeeld") never becomes Ja: an unset field stays unset when nothing is submitted for it', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', version: 1, assessment: {} }),
      updateAssessment: jest.fn(),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteAssessmentHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail,
    );

    await handler.handleRequest(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', assessedStartMonth: '9', assessedStartYear: '2028', csrfToken }), false,
    );

    expect(caseRepository.updateAssessment).toHaveBeenCalledWith(
      'OF-1', 'medewerker', 1, { set: { assessedStartPeriod: 202809 }, remove: [] }, expect.any(Array),
    );
  });

  it('explicitly clearing a previously assessed ternary field removes it instead of leaving it as-is', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', version: 1, assessment: { applicationComplete: 'YES' } }),
      updateAssessment: jest.fn().mockResolvedValue('OK'),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteAssessmentHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail,
    );

    await handler.handleRequest(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', applicationComplete: '', csrfToken }), false,
    );

    expect(caseRepository.updateAssessment).toHaveBeenCalledWith(
      'OF-1', 'medewerker', 1, { set: {}, remove: ['applicationComplete'] }, expect.any(Array),
    );
  });

  it('clearing a vastgestelde period (both month and year emptied) removes it', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', version: 1, assessment: { assessedStartPeriod: 202809 } }),
      updateAssessment: jest.fn().mockResolvedValue('OK'),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteAssessmentHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail,
    );

    await handler.handleRequest(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', assessedStartMonth: '', assessedStartYear: '', csrfToken }), false,
    );

    expect(caseRepository.updateAssessment).toHaveBeenCalledWith(
      'OF-1', 'medewerker', 1, { set: {}, remove: ['assessedStartPeriod'] }, expect.any(Array),
    );
  });

  it('a period field entirely absent from this submission (the other form) never clears it', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', version: 1, assessment: { assessedStartPeriod: 202809 } }),
      updateAssessment: jest.fn(),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteAssessmentHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail,
    );

    // The beoordeling form doesn't include assessedStartMonth/Year at all - only the planning form does.
    await handler.handleRequest(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', applicationComplete: 'YES', csrfToken }), false,
    );

    expect(caseRepository.updateAssessment).toHaveBeenCalledWith(
      'OF-1', 'medewerker', 1, { set: { applicationComplete: 'YES' }, remove: [] }, expect.any(Array),
    );
  });

  it('first set of a ternary field: the activity change has no `from` property at all (not even undefined)', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', version: 1, assessment: {} }),
      updateAssessment: jest.fn().mockResolvedValue('OK'),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteAssessmentHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail,
    );

    await handler.handleRequest(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', applicationComplete: 'YES', csrfToken }), false,
    );

    const changes = caseRepository.updateAssessment.mock.calls[0][4];
    expect(changes).toEqual([{ field: 'assessment.applicationComplete', to: 'YES' }]);
    expect(changes[0].hasOwnProperty('from')).toBe(false);
  });

  it('clearing an existing ternary field: the activity change has no `to` property at all (not even undefined)', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', version: 1, assessment: { applicationComplete: 'YES' } }),
      updateAssessment: jest.fn().mockResolvedValue('OK'),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteAssessmentHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail,
    );

    await handler.handleRequest(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', applicationComplete: '', csrfToken }), false,
    );

    const changes = caseRepository.updateAssessment.mock.calls[0][4];
    expect(changes).toEqual([{ field: 'assessment.applicationComplete', from: 'YES' }]);
    expect(changes[0].hasOwnProperty('to')).toBe(false);
  });

  it('short-circuits without a repository call when nothing actually changed', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', version: 1, assessment: {} }),
      updateAssessment: jest.fn(),
    };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteAssessmentHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail,
    );

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ expectedVersion: '1', csrfToken }), false,
    );

    expect(caseRepository.updateAssessment).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(303);
  });
});
