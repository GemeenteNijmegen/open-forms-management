import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { PermissionGrant } from '../../../../shared/authorization/PermissionGrant';
import { PermissionCatalog } from '../../catalog/PermissionCatalog';
import { PermissionAdministrationPolicy } from '../PermissionAdministrationPolicy';
import { PermissionAdministrationService } from '../PermissionAdministrationService';

// Two resources with two different scope keys, so a passing test actually proves the projection is generic
// instead of secretly relying on Sport-shaped data.
const catalog = new PermissionCatalog([
  {
    resource: 'sport',
    label: 'Sport',
    actions: [{ action: 'view', label: 'Bekijken' }],
    scopes: [{ key: 'districts', label: 'Wijken', values: [{ value: 'dukenburg', label: 'Dukenburg' }] }],
  },
  {
    resource: 'app2',
    label: 'App2',
    actions: [{ action: 'edit', label: 'Wijzigen' }],
    scopes: [{ key: 'organisations', label: 'Organisaties', values: [{ value: 'organisatie-a', label: 'Organisatie A' }] }],
  },
]);
const policy = new PermissionAdministrationPolicy(catalog);
const service = new PermissionAdministrationService(catalog, policy);

function evaluatorFor(...grants: PermissionGrant[]): PermissionEvaluator {
  return new PermissionEvaluator(grants);
}

describe('PermissionAdministrationService', () => {
  it('gives a superadmin both registered resources and the general Superadmin grant, across two different scope keys', () => {
    const superadmin = evaluatorFor({ resource: '*', actions: ['*'] });
    const target: PermissionGrant[] = [
      { resource: '*', actions: ['*'] },
      { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } },
      { resource: 'app2', actions: ['edit'], scopes: { organisations: ['organisatie-a'] } },
    ];

    const viewModel = service.projectUser(superadmin, target);

    expect(viewModel.generalGrants).toEqual([{ actions: [{ value: '*', label: 'Superadmin' }], scopes: [] }]);
    expect(viewModel.resources).toEqual([
      {
        resource: 'sport',
        label: 'Sport',
        grants: [{ actions: [{ value: 'view', label: 'Bekijken' }], scopes: [{ key: 'districts', label: 'Wijken', values: [{ value: 'dukenburg', label: 'Dukenburg' }] }] }],
      },
      {
        resource: 'app2',
        label: 'App2',
        grants: [{ actions: [{ value: 'edit', label: 'Wijzigen' }], scopes: [{ key: 'organisations', label: 'Organisaties', values: [{ value: 'organisatie-a', label: 'Organisatie A' }] }] }],
      },
    ]);
  });

  it('gives a sport admin only sport, hiding the target\'s app2 grants and global admin grant entirely', () => {
    const sportAdmin = evaluatorFor({ resource: 'sport', actions: ['*'] });
    const target: PermissionGrant[] = [
      { resource: '*', actions: ['*'] },
      { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } },
      { resource: 'app2', actions: ['*'] },
    ];

    const viewModel = service.projectUser(sportAdmin, target);

    expect(viewModel.generalGrants).toEqual([]);
    expect(viewModel.resources).toEqual([
      {
        resource: 'sport',
        label: 'Sport',
        grants: [{ actions: [{ value: 'view', label: 'Bekijken' }], scopes: [{ key: 'districts', label: 'Wijken', values: [{ value: 'dukenburg', label: 'Dukenburg' }] }] }],
      },
    ]);
  });

  it('gives a user with no admin grants nothing to manage', () => {
    const noAdmin = evaluatorFor({ resource: 'sport', actions: ['view'] });

    const viewModel = service.projectUser(noAdmin, [{ resource: 'sport', actions: ['view'] }]);

    expect(viewModel).toEqual({ generalGrants: [], resources: [] });
    expect(service.manageableResources(noAdmin)).toEqual([]);
  });

  it('projects a resource-admin grant as a single "Beheerder van <resource>" entry instead of leaking its raw scopes', () => {
    const superadmin = evaluatorFor({ resource: '*', actions: ['*'] });

    const viewModel = service.projectUser(superadmin, [{ resource: 'sport', actions: ['*'], scopes: { districts: ['dukenburg'] } }]);

    expect(viewModel.resources[0].grants).toEqual([{ actions: [{ value: '*', label: 'Beheerder van Sport' }], scopes: [] }]);
  });
});
