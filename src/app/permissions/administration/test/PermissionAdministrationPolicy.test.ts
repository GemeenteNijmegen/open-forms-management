import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { PermissionGrant } from '../../../../shared/authorization/PermissionGrant';
import { PermissionCatalog } from '../../catalog/PermissionCatalog';
import { PermissionAdministrationPolicy } from '../PermissionAdministrationPolicy';

function evaluatorFor(...grants: PermissionGrant[]): PermissionEvaluator {
  return new PermissionEvaluator(grants);
}

describe('PermissionAdministrationPolicy', () => {
  // Real catalog: only `sport` is registered, so an "app2" resource here is deliberately unknown to the catalog.
  const policy = new PermissionAdministrationPolicy(new PermissionCatalog());

  it.each([
    ['superadmin manages the registered sport resource', evaluatorFor({ resource: '*', actions: ['*'] }), 'sport', true],
    ['sport admin manages sport', evaluatorFor({ resource: 'sport', actions: ['*'] }), 'sport', true],
    ['sport admin cannot manage an unregistered resource by requesting it directly', evaluatorFor({ resource: 'sport', actions: ['*'] }), 'app2', false],
    ['a regular sport grant without the wildcard is not resource-admin', evaluatorFor({ resource: 'sport', actions: ['view'] }), 'sport', false],
    ['superadmin cannot manage an unregistered resource either, deny by default beats *:*', evaluatorFor({ resource: '*', actions: ['*'] }), 'app2', false],
    ['a user with no grants manages nothing', evaluatorFor(), 'sport', false],
  ])('%s', (_name, actor, resource, expected) => {
    expect(policy.canManageResource(actor, resource)).toBe(expected);
  });

  it.each([
    ['a global admin may grant *:*', evaluatorFor({ resource: '*', actions: ['*'] }), true],
    ['a sport admin may never grant *:*, even though they can manage sport', evaluatorFor({ resource: 'sport', actions: ['*'] }), false],
    ['a regular sport user may never grant *:*', evaluatorFor({ resource: 'sport', actions: ['view'] }), false],
  ])('%s', (_name, actor, expected) => {
    expect(policy.canGrantGlobalAdmin(actor)).toBe(expected);
  });

  it('lets a sport admin give and take away sport:* on someone else, since managing sport includes its own wildcard grant', () => {
    const sportAdmin = evaluatorFor({ resource: 'sport', actions: ['*'] });

    // canManageResource() is the single gate a write handler checks before writing any grant for that resource,
    // including the resource's own <resource>:* wildcard — there's no separate "may grant the wildcard" rule.
    expect(policy.canManageResource(sportAdmin, 'sport')).toBe(true);
  });
});
