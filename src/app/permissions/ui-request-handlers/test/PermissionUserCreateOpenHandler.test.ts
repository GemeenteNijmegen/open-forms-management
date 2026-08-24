import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { PermissionAdministrationPolicy } from '../../administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from '../../administration/PermissionAdministrationService';
import { PermissionCatalog } from '../../catalog/PermissionCatalog';
import { PermissionUserCreateOpenHandler } from '../PermissionUserCreateOpenHandler';

const catalog = new PermissionCatalog([
  {
    resource: 'sport',
    label: 'Sport',
    actions: [{ action: 'view', label: 'Bekijken' }],
    scopes: [{ key: 'districts', label: 'Wijken', values: [{ value: 'dukenburg', label: 'Dukenburg' }] }],
  },
]);

function newHandler() {
  const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));
  const permissionRepository = new FakePermissionRepository();
  const authorizationService = new AuthorizationService(permissionRepository, new FakeAuditTrail());
  return { handler: new PermissionUserCreateOpenHandler(authorizationService, administrationService), permissionRepository };
}

describe('PermissionUserCreateOpenHandler', () => {
  it('renders the Sport create form with an email field, scope checkboxes, a CSRF field and cookie', async () => {
    const { handler, permissionRepository } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Nieuwe gebruiker voor Sport');
    expect(response.body).toContain('name="targetEmail"');
    // Blank create form: the district checkbox itself has no `checked`, unlike the default "specific rights" radio.
    expect(response.body).toContain('id="scope-districts-dukenburg" name="districts" value="dukenburg">');
    expect(response.cookies?.[0]).toContain('__Host-csrf=');
  });

  it('shows the invalid-input alert after a redirect from a rejected submission', async () => {
    const { handler, permissionRepository } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, { status: 'invalid' });

    expect(response.body).toContain('Controleer het e-mailadres en de gekozen rechten.');
  });

  it('denies a medewerker who cannot manage any resource', async () => {
    const { handler } = newHandler();

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    expect(response.statusCode).toBe(403);
  });
});
