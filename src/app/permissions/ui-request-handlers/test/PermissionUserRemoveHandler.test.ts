import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { CSRF_COOKIE_NAME, CSRF_FORM_FIELD, issueCsrfToken } from '../../../../shared/security/csrf/CsrfProtection';
import { PermissionAdministrationPolicy } from '../../administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from '../../administration/PermissionAdministrationService';
import { PermissionCatalog } from '../../catalog/PermissionCatalog';
import { FakePermissionAdministrationRepository } from '../../store/test/FakePermissionAdministrationRepository';
import { PermissionUserRemoveHandler } from '../PermissionUserRemoveHandler';

const catalog = new PermissionCatalog([
  { resource: 'sport', label: 'Sport', actions: [{ action: 'view', label: 'Bekijken' }], scopes: [] },
  { resource: 'app2', label: 'App2', actions: [{ action: 'view', label: 'Bekijken' }], scopes: [] },
]);

function newHandler() {
  const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));
  const permissionAdministrationRepository = new FakePermissionAdministrationRepository();
  const auditTrail = new FakeAuditTrail();
  const permissionRepository = new FakePermissionRepository();
  const authorizationService = new AuthorizationService(permissionRepository, auditTrail);
  const handler = new PermissionUserRemoveHandler(
    authorizationService, administrationService, catalog, permissionAdministrationRepository, auditTrail,
  );
  return { handler, permissionRepository, permissionAdministrationRepository, auditTrail };
}

function csrfBody(fields: Record<string, string>) {
  const token = issueCsrfToken();
  const form = new URLSearchParams({ ...fields, [CSRF_FORM_FIELD]: token.value });
  return { cookieHeader: `${CSRF_COOKIE_NAME}=${token.value}`, body: form.toString() };
}

describe('PermissionUserRemoveHandler', () => {
  it('removes a Sport-only user entirely: no grants, no subject, audited as PERMISSION_SUBJECT_REMOVED', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository, auditTrail } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    permissionAdministrationRepository.seedUsers({ email: 'medewerker@nijmegen.nl', hasSubject: true, grants: [{ resource: 'sport', actions: ['view'] }] });
    const { cookieHeader, body } = csrfBody({ targetEmail: 'medewerker@nijmegen.nl', resource: 'sport', confirmed: '1' });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(303);
    expect(await permissionAdministrationRepository.listAllUsers()).toEqual([]);
    expect(auditTrail.events).toContainEqual(expect.objectContaining({
      eventType: 'PERMISSION_SUBJECT_REMOVED', targetEmail: 'medewerker@nijmegen.nl', resource: 'sport', actorEmail: 'sportadmin@nijmegen.nl',
    }));
  });

  it('removes only Sport from a Sport+App2 user, keeping the subject and app2, audited as PERMISSION_RESOURCE_REMOVED', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository, auditTrail } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    permissionAdministrationRepository.seedUsers({
      email: 'medewerker@nijmegen.nl', hasSubject: true, grants: [{ resource: 'sport', actions: ['view'] }, { resource: 'app2', actions: ['view'] }],
    });
    const { cookieHeader, body } = csrfBody({ targetEmail: 'medewerker@nijmegen.nl', resource: 'sport', confirmed: '1' });

    await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    const users = await permissionAdministrationRepository.listAllUsers();
    expect(users).toEqual([{ email: 'medewerker@nijmegen.nl', hasSubject: true, grants: [{ resource: 'app2', actions: ['view'] }] }]);
    expect(auditTrail.events).toContainEqual(expect.objectContaining({ eventType: 'PERMISSION_RESOURCE_REMOVED', targetEmail: 'medewerker@nijmegen.nl' }));
  });

  it('renders a confirmation page without removing anything when confirmed is not set yet', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository, auditTrail } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    permissionAdministrationRepository.seedUsers({ email: 'medewerker@nijmegen.nl', hasSubject: true, grants: [{ resource: 'sport', actions: ['view'] }] });
    const { cookieHeader, body } = csrfBody({ targetEmail: 'medewerker@nijmegen.nl', resource: 'sport' });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('medewerker@nijmegen.nl');
    expect(response.body).toContain('Sport');
    expect(response.body).not.toContain('App2'); // resource isolation holds even in the confirmation text
    expect(response.cookies?.[0]).toContain('__Host-csrf=');
    expect((await permissionAdministrationRepository.listAllUsers())[0].grants).toEqual([{ resource: 'sport', actions: ['view'] }]);
    expect(auditTrail.events).toEqual([]);
  });

  it('denies and writes nothing when a sport admin tampers the resource field to app2', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    permissionAdministrationRepository.seedUsers({ email: 'medewerker@nijmegen.nl', hasSubject: true, grants: [{ resource: 'app2', actions: ['view'] }] });
    const { cookieHeader, body } = csrfBody({ targetEmail: 'medewerker@nijmegen.nl', resource: 'app2' });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(403);
    expect(await permissionAdministrationRepository.listAllUsers()).toEqual([{ email: 'medewerker@nijmegen.nl', hasSubject: true, grants: [{ resource: 'app2', actions: ['view'] }] }]);
  });
});
