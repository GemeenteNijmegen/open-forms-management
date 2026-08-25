import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionGrant } from '../../../../shared/authorization/PermissionGrant';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { PermissionAdministrationPolicy } from '../../administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from '../../administration/PermissionAdministrationService';
import { PermissionCatalog } from '../../catalog/PermissionCatalog';
import { FakePermissionAdministrationRepository } from '../../store/test/FakePermissionAdministrationRepository';
import { PermissionsOverviewHandler } from '../PermissionsOverviewHandler';

// Two resources with different scope keys, so a passing test proves the handler stays generic end to end.
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

function newHandler(repository: FakePermissionAdministrationRepository) {
  const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));
  const authorizationService = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
  return new PermissionsOverviewHandler(authorizationService, administrationService, repository);
}

function seedActorGrants(email: string, grants: PermissionGrant[]): AuthorizationService {
  const repository = new FakePermissionRepository();
  repository.seedGrants(email, grants);
  return new AuthorizationService(repository, new FakeAuditTrail());
}

describe('PermissionsOverviewHandler', () => {
  it('denies a medewerker who cannot manage any registered resource', async () => {
    const handler = newHandler(new FakePermissionAdministrationRepository());

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    expect(response.statusCode).toBe(403);
  });

  it('shows a superadmin every subject, including a subject-only one, with Sport and App2 generically projected', async () => {
    const repository = new FakePermissionAdministrationRepository();
    repository.seedUsers(
      { email: 'subject-only@nijmegen.nl', hasSubject: true, grants: [] },
      {
        email: 'multi@nijmegen.nl',
        hasSubject: true,
        grants: [
          { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } },
          { resource: 'app2', actions: ['edit'], scopes: { organisations: ['organisatie-a'] } },
        ],
      },
    );
    const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));
    const authorizationService = seedActorGrants('superadmin@nijmegen.nl', [{ resource: '*', actions: ['*'] }]);
    const handler = new PermissionsOverviewHandler(authorizationService, administrationService, repository);

    const response = await handler.handleRequest({ principalId: 'superadmin-1', email: 'superadmin@nijmegen.nl' });
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    // Mustache HTML-escapes `/` and `=` in interpolated attribute values; browsers decode entities in attributes fine.
    expect(body).toContain('href="&#x2F;permissions&#x2F;users&#x2F;new?resource&#x3D;sport"');
    expect(body).toContain('Gebruiker toevoegen voor Sport');
    expect(body).toContain('href="&#x2F;permissions&#x2F;users&#x2F;new?resource&#x3D;app2"');
    expect(body).toContain('Gebruiker toevoegen voor App2');
    expect(body).toContain('subject-only@nijmegen.nl');
    expect(body).toContain('Geen rechten');
    expect(body).toContain('multi@nijmegen.nl');
    expect(body).toContain('Sport');
    expect(body).toContain('Dukenburg');
    expect(body).toContain('App2');
    expect(body).toContain('Organisatie A');
  });

  it('shows a single plain "Gebruiker toevoegen" link for an actor who manages only one resource, no resource picker needed', async () => {
    const repository = new FakePermissionAdministrationRepository();
    const authorizationService = seedActorGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));
    const handler = new PermissionsOverviewHandler(authorizationService, administrationService, repository);

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' });
    const body = response.body ?? '';

    expect(body).toContain('href="&#x2F;permissions&#x2F;users&#x2F;new"');
    expect(body).not.toContain('?resource');
  });

  it('lets a superadmin see another superadmin read-only, without an edit action, while a regular user still gets one', async () => {
    const repository = new FakePermissionAdministrationRepository();
    repository.seedUsers(
      { email: 'andere-superadmin@nijmegen.nl', hasSubject: true, grants: [{ resource: '*', actions: ['*'] }] },
      { email: 'multi@nijmegen.nl', hasSubject: true, grants: [{ resource: 'sport', actions: ['view'] }] },
    );
    const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));
    const authorizationService = seedActorGrants('superadmin@nijmegen.nl', [{ resource: '*', actions: ['*'] }]);
    const handler = new PermissionsOverviewHandler(authorizationService, administrationService, repository);

    const response = await handler.handleRequest({ principalId: 'superadmin-1', email: 'superadmin@nijmegen.nl' });
    const body = response.body ?? '';

    expect(body).toContain('andere-superadmin@nijmegen.nl');
    expect(body).toContain('Superadmin');
    expect(body).toContain('value="multi@nijmegen.nl"');
    expect(body).not.toContain('value="andere-superadmin@nijmegen.nl"');
  });

  it('shows a flash message after a redirect from create/update/remove', async () => {
    const authorizationService = seedActorGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));
    const handler = new PermissionsOverviewHandler(authorizationService, administrationService, new FakePermissionAdministrationRepository());

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, { status: 'created' });

    expect(response.body ?? '').toContain('Gebruiker en rechten opgeslagen.');
  });

  it('never shows a sport admin an app2-only user', async () => {
    const repository = new FakePermissionAdministrationRepository();
    repository.seedUsers({ email: 'app2-only@nijmegen.nl', hasSubject: true, grants: [{ resource: 'app2', actions: ['edit'] }] });
    const authorizationService = seedActorGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    const handler = new PermissionsOverviewHandler(
      authorizationService, new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog)), repository,
    );

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' });

    expect(response.body ?? '').not.toContain('app2-only@nijmegen.nl');
  });

  it('shows a sport admin a sport+app2 user with only sport data, in both the summary and the expanded details', async () => {
    const repository = new FakePermissionAdministrationRepository();
    repository.seedUsers({
      email: 'multi@nijmegen.nl',
      hasSubject: true,
      grants: [
        { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } },
        { resource: 'app2', actions: ['edit'], scopes: { organisations: ['organisatie-a'] } },
      ],
    });
    const authorizationService = seedActorGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    const handler = new PermissionsOverviewHandler(
      authorizationService, new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog)), repository,
    );

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' });
    const body = response.body ?? '';

    expect(body).toContain('multi@nijmegen.nl');
    expect(body).toContain('Dukenburg');
    expect(body).not.toContain('App2');
    expect(body).not.toContain('Organisatie A');
  });

  it('never shows a sport admin a global superadmin merely because *:* implies access to sport', async () => {
    const repository = new FakePermissionAdministrationRepository();
    repository.seedUsers({ email: 'superadmin@nijmegen.nl', hasSubject: true, grants: [{ resource: '*', actions: ['*'] }] });
    const authorizationService = seedActorGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    const handler = new PermissionsOverviewHandler(
      authorizationService, new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog)), repository,
    );

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' });

    expect(response.body ?? '').not.toContain('superadmin@nijmegen.nl');
  });
});
