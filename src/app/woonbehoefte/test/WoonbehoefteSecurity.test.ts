import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { PermissionGrant } from '../../../shared/authorization/PermissionGrant';
import { PermissionRepository } from '../../../shared/authorization/PermissionRepository';

function fakeRepository(grants: PermissionGrant[]): PermissionRepository {
  return { getGrants: jest.fn().mockResolvedValue(grants) };
}

function fakeAuditTrail(): AuditTrail {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditTrail;
}

/**
 * End-to-end through the real `AuthorizationService`/`PermissionEvaluator`, not a mocked authorization
 * gate: proves the actual view/manage distinction every Woonbehoefte handler relies on.
 */
describe('Woonbehoefte server-side authorization', () => {
  it('denies woonbehoefte:manage for a medewerker who only has woonbehoefte:view', async () => {
    const service = new AuthorizationService(fakeRepository([{ resource: 'woonbehoefte', actions: ['view'] }]), fakeAuditTrail());
    const context = await service.loadContext({ principalId: 'p1', email: 'kijker@example.nl' });

    const denied = await service.requireAuthorization(context, { resource: 'woonbehoefte', action: 'manage' });

    expect(denied?.statusCode).toBe(403);
  });

  it('allows woonbehoefte:manage for a medewerker with that exact grant', async () => {
    const service = new AuthorizationService(fakeRepository([{ resource: 'woonbehoefte', actions: ['view', 'manage'] }]), fakeAuditTrail());
    const context = await service.loadContext({ principalId: 'p2', email: 'behandelaar@example.nl' });

    const denied = await service.requireAuthorization(context, { resource: 'woonbehoefte', action: 'manage' });

    expect(denied).toBeUndefined();
  });

  it('denies woonbehoefte:view for a medewerker with grants on a different resource only', async () => {
    const service = new AuthorizationService(fakeRepository([{ resource: 'sport', actions: ['view'] }]), fakeAuditTrail());
    const context = await service.loadContext({ principalId: 'p3', email: 'sportmedewerker@example.nl' });

    const denied = await service.requireAuthorization(context, { resource: 'woonbehoefte', action: 'view' });

    expect(denied?.statusCode).toBe(403);
  });

  it('allows everything via the woonbehoefte:* resource-admin wildcard, without a fake manage grant', async () => {
    const service = new AuthorizationService(fakeRepository([{ resource: 'woonbehoefte', actions: ['*'] }]), fakeAuditTrail());
    const context = await service.loadContext({ principalId: 'p4', email: 'admin@example.nl' });

    expect(await service.requireAuthorization(context, { resource: 'woonbehoefte', action: 'view' })).toBeUndefined();
    expect(await service.requireAuthorization(context, { resource: 'woonbehoefte', action: 'manage' })).toBeUndefined();
  });

  it('denies a medewerker with no grants at all', async () => {
    const service = new AuthorizationService(fakeRepository([]), fakeAuditTrail());
    const context = await service.loadContext({ principalId: 'p5', email: 'niemand@example.nl' });

    expect((await service.requireAuthorization(context, { resource: 'woonbehoefte', action: 'view' }))?.statusCode).toBe(403);
  });
});
