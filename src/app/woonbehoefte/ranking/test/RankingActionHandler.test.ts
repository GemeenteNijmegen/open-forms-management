import { randomBytes } from 'crypto';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../shared/security/csrf/CsrfProtection';
import { RankingActionHandler } from '../RankingActionHandler';
import { RankingStore } from '../RankingStore';

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
  return new URLSearchParams({ csrfToken, expectedRevision: '3', back: '', ...fields }).toString();
}

describe('RankingActionHandler', () => {
  it('inserts a case, records one audit event and redirects to #rangschikking with a saved marker', async () => {
    const rankingStore = { insert: jest.fn().mockResolvedValue('OK') } as unknown as RankingStore;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new RankingActionHandler(makeAuthorizationService(), rankingStore, auditTrail);

    const response = await handler.handleInsert(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ position: '5' }), false,
    );

    expect(rankingStore.insert).toHaveBeenCalledWith('OF-1', 5, 'medewerker', 3);
    expect(auditTrail.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'WOONBEHOEFTE_RANKING_INSERTED' }));
    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toContain('rankingSaved=insert');
    expect(response.headers?.Location).toContain('#rangschikking');
  });

  it('redirects with a stale marker and records no audit event when the revision no longer matches', async () => {
    const rankingStore = { move: jest.fn().mockResolvedValue('STALE_REVISION'), getCurrentList: jest.fn().mockResolvedValue(undefined) } as unknown as RankingStore;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const handler = new RankingActionHandler(makeAuthorizationService(), rankingStore, auditTrail);

    const response = await handler.handleMove(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ position: '2' }), false,
    );

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toContain('rankingStatus=stale');
    expect(auditTrail.record).not.toHaveBeenCalled();
  });
});
