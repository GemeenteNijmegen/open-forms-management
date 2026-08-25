import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { PermissionAdministrationPolicy } from '../../administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from '../../administration/PermissionAdministrationService';
import { PermissionCatalog } from '../../catalog/PermissionCatalog';
import { PermissionUserCreateOpenHandler } from '../PermissionUserCreateOpenHandler';

const sportOnlyCatalog = new PermissionCatalog([
  {
    resource: 'sport',
    label: 'Sport',
    actions: [{ action: 'view', label: 'Bekijken' }],
    scopes: [{ key: 'districts', label: 'Wijken', values: [{ value: 'dukenburg', label: 'Dukenburg' }] }],
  },
]);

const woonbehoefteOnlyCatalog = new PermissionCatalog([
  { resource: 'woonbehoefte', label: 'Woonbehoefte', actions: [{ action: 'view', label: 'Bekijken' }], scopes: [] },
]);

const bothCatalog = new PermissionCatalog([
  {
    resource: 'sport',
    label: 'Sport',
    actions: [{ action: 'view', label: 'Bekijken' }],
    scopes: [{ key: 'districts', label: 'Wijken', values: [{ value: 'dukenburg', label: 'Dukenburg' }] }],
  },
  { resource: 'woonbehoefte', label: 'Woonbehoefte', actions: [{ action: 'view', label: 'Bekijken' }], scopes: [] },
]);

function newHandler(catalog: PermissionCatalog) {
  const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));
  const permissionRepository = new FakePermissionRepository();
  const authorizationService = new AuthorizationService(permissionRepository, new FakeAuditTrail());
  return { handler: new PermissionUserCreateOpenHandler(authorizationService, administrationService), permissionRepository };
}

describe('PermissionUserCreateOpenHandler', () => {
  it('auto-picks the only manageable resource: Sport-only', async () => {
    const { handler, permissionRepository } = newHandler(sportOnlyCatalog);
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Nieuwe gebruiker voor Sport');
    expect(response.body).toContain('name="targetEmail"');
    // Blank create form: the district checkbox itself has no `checked`, unlike the default "specific rights" radio.
    expect(response.body).toContain('id="scope-districts-dukenburg" name="districts" value="dukenburg">');
    expect(response.cookies?.[0]).toContain('__Host-csrf=');
  });

  it('auto-picks the only manageable resource: Woonbehoefte-only', async () => {
    const { handler, permissionRepository } = newHandler(woonbehoefteOnlyCatalog);
    permissionRepository.seedGrants('wbadmin@nijmegen.nl', [{ resource: 'woonbehoefte', actions: ['*'] }]);

    const response = await handler.handleRequest({ principalId: 'wbadmin-1', email: 'wbadmin@nijmegen.nl' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Nieuwe gebruiker voor Woonbehoefte');
  });

  it('picks Sport when both are manageable and ?resource=sport is given', async () => {
    const { handler, permissionRepository } = newHandler(bothCatalog);
    permissionRepository.seedGrants('admin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }, { resource: 'woonbehoefte', actions: ['*'] }]);

    const response = await handler.handleRequest({ principalId: 'admin-1', email: 'admin@nijmegen.nl' }, { resource: 'sport' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Nieuwe gebruiker voor Sport');
  });

  it('picks Woonbehoefte when both are manageable and ?resource=woonbehoefte is given', async () => {
    const { handler, permissionRepository } = newHandler(bothCatalog);
    permissionRepository.seedGrants('admin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }, { resource: 'woonbehoefte', actions: ['*'] }]);

    const response = await handler.handleRequest({ principalId: 'admin-1', email: 'admin@nijmegen.nl' }, { resource: 'woonbehoefte' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Nieuwe gebruiker voor Woonbehoefte');
  });

  it('never silently defaults to the first resource when both are manageable and no ?resource= is given', async () => {
    const { handler, permissionRepository } = newHandler(bothCatalog);
    permissionRepository.seedGrants('admin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }, { resource: 'woonbehoefte', actions: ['*'] }]);

    const response = await handler.handleRequest({ principalId: 'admin-1', email: 'admin@nijmegen.nl' });

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/permissions');
  });

  it('refuses a spoofed ?resource= the actor cannot manage: redirects, never renders that resource\'s form', async () => {
    const { handler, permissionRepository } = newHandler(bothCatalog);
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, { resource: 'woonbehoefte' });

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/permissions');
  });

  it('shows the invalid-input alert after a redirect from a rejected submission, resource preserved', async () => {
    const { handler, permissionRepository } = newHandler(bothCatalog);
    permissionRepository.seedGrants('admin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }, { resource: 'woonbehoefte', actions: ['*'] }]);

    const response = await handler.handleRequest(
      { principalId: 'admin-1', email: 'admin@nijmegen.nl' }, { status: 'invalid', resource: 'woonbehoefte' },
    );

    expect(response.body).toContain('Controleer het e-mailadres en de gekozen rechten.');
    expect(response.body).toContain('Nieuwe gebruiker voor Woonbehoefte');
  });

  it('denies a medewerker who cannot manage any resource', async () => {
    const { handler } = newHandler(bothCatalog);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    expect(response.statusCode).toBe(403);
  });
});
