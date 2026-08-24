import { randomBytes } from 'crypto';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteNoteHandler } from '../WoonbehoefteNoteHandler';

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

describe('WoonbehoefteNoteHandler', () => {
  it('adds a note and audits only caseReference/category/noteId, never the free text', async () => {
    const caseRepository = {
      getCase: jest.fn().mockResolvedValue({ caseReference: 'OF-1', version: 1 }),
      addNote: jest.fn().mockResolvedValue({ noteId: 'note-1', caseReference: 'OF-1', category: 'CONTACT', text: 'Vertrouwelijke inhoud', createdAt: '2026-08-24T10:00:00.000Z', createdBy: 'medewerker' }),
    };
    const record = jest.fn().mockResolvedValue(undefined);
    const auditTrail = { record } as unknown as AuditTrail;
    const handler = new WoonbehoefteNoteHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ category: 'CONTACT', text: 'Vertrouwelijke inhoud', csrfToken }), false,
    );

    expect(response.statusCode).toBe(303);
    expect(caseRepository.addNote).toHaveBeenCalledWith('OF-1', 'medewerker', 'CONTACT', 'Vertrouwelijke inhoud');
    const auditCall = record.mock.calls[0][0];
    expect(auditCall.metadata).toEqual({ caseReference: 'OF-1', category: 'CONTACT', noteId: 'note-1' });
    expect(JSON.stringify(auditCall)).not.toContain('Vertrouwelijke inhoud');
  });

  it('rejects an empty note text or an unknown category', async () => {
    const caseRepository = { getCase: jest.fn(), addNote: jest.fn() };
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new WoonbehoefteNoteHandler(makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, auditTrail);

    const emptyText = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ category: 'GENERAL', text: '  ', csrfToken }), false);
    expect(emptyText.statusCode).toBe(400);

    const badCategory = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ category: 'NOT_A_CATEGORY', text: 'iets', csrfToken }), false);
    expect(badCategory.statusCode).toBe(400);

    expect(caseRepository.addNote).not.toHaveBeenCalled();
  });
});
