import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { PermissionAdministrationPolicy } from '../../administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from '../../administration/PermissionAdministrationService';
import { PermissionCatalog } from '../../catalog/PermissionCatalog';
import { FakePermissionAdministrationRepository } from '../../store/test/FakePermissionAdministrationRepository';
import { PermissionUserEditOpenHandler } from '../PermissionUserEditOpenHandler';

const catalog = new PermissionCatalog([
  {
    resource: 'sport',
    label: 'Sport',
    actions: [{ action: 'view', label: 'Bekijken' }],
    scopes: [{ key: 'districts', label: 'Wijken', values: [{ value: 'dukenburg', label: 'Dukenburg' }, { value: 'lindenholt', label: 'Lindenholt' }] }],
  },
  { resource: 'app2', label: 'App2', actions: [{ action: 'view', label: 'Bekijken' }], scopes: [] },
]);

function newHandler() {
  const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));
  const administrationRepository = new FakePermissionAdministrationRepository();
  const permissionRepository = new FakePermissionRepository();
  const authorizationService = new AuthorizationService(permissionRepository, new FakeAuditTrail());
  return {
    handler: new PermissionUserEditOpenHandler(authorizationService, administrationService, administrationRepository),
    administrationRepository,
    permissionRepository,
  };
}

describe('PermissionUserEditOpenHandler', () => {
  it('renders the edit form for a sport admin: checked districts, no app2 section, a CSRF field and cookie', async () => {
    const { handler, administrationRepository, permissionRepository } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    administrationRepository.seedUsers({
      email: 'medewerker@nijmegen.nl',
      hasSubject: true,
      grants: [
        { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } },
        { resource: 'app2', actions: ['view'] },
      ],
    });
    const form = new URLSearchParams({ targetEmail: 'medewerker@nijmegen.nl' });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, form.toString(), false);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Rechten van medewerker@nijmegen.nl');
    expect(response.body).toContain('id="scope-sport-districts-dukenburg" name="districts" value="dukenburg" checked');
    expect(response.body).not.toContain('id="scope-sport-districts-lindenholt" name="districts" value="lindenholt" checked');
    expect(response.body).not.toContain('App2');
    expect(response.cookies?.[0]).toContain('__Host-csrf=');
  });

  it('redirects instead of leaking whether a target exists when it only has a resource the actor cannot manage', async () => {
    const { handler, administrationRepository, permissionRepository } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    administrationRepository.seedUsers({ email: 'app2-only@nijmegen.nl', hasSubject: true, grants: [{ resource: 'app2', actions: ['view'] }] });
    const form = new URLSearchParams({ targetEmail: 'app2-only@nijmegen.nl' });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, form.toString(), false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/permissions?status=invalid');
  });
});
