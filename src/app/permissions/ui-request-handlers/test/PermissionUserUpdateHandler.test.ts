import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { CSRF_COOKIE_NAME, CSRF_FORM_FIELD, issueCsrfToken } from '../../../../shared/security/csrf/CsrfProtection';
import { PermissionAdministrationPolicy } from '../../administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from '../../administration/PermissionAdministrationService';
import { PermissionCatalog } from '../../catalog/PermissionCatalog';
import { FakePermissionAdministrationRepository } from '../../store/test/FakePermissionAdministrationRepository';
import { PermissionUserUpdateHandler } from '../PermissionUserUpdateHandler';

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
  const permissionAdministrationRepository = new FakePermissionAdministrationRepository();
  const auditTrail = new FakeAuditTrail();
  const permissionRepository = new FakePermissionRepository();
  const authorizationService = new AuthorizationService(permissionRepository, auditTrail);
  const handler = new PermissionUserUpdateHandler(
    authorizationService, administrationService, catalog, permissionAdministrationRepository, auditTrail,
  );
  return { handler, permissionRepository, permissionAdministrationRepository, auditTrail };
}

function csrfBody(fields: Record<string, string | string[]>) {
  const token = issueCsrfToken();
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      form.append(key, v);
    }
  }
  form.set(CSRF_FORM_FIELD, token.value);
  return { cookieHeader: `${CSRF_COOKIE_NAME}=${token.value}`, body: form.toString() };
}

describe('PermissionUserUpdateHandler', () => {
  it('replaces the Sport scope selection, leaving the target\'s app2 grant exactly intact', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository, auditTrail } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    permissionAdministrationRepository.seedUsers({
      email: 'medewerker@nijmegen.nl',
      hasSubject: true,
      grants: [
        { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } },
        { resource: 'app2', actions: ['view'] },
      ],
    });
    const { cookieHeader, body } = csrfBody({
      targetEmail: 'medewerker@nijmegen.nl', resource: 'sport', action: 'view', districts: ['dukenburg', 'lindenholt'],
    });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(303);
    const users = await permissionAdministrationRepository.listAllUsers();
    const target = users.find((user) => user.email === 'medewerker@nijmegen.nl');
    expect(target?.grants).toEqual(expect.arrayContaining([
      { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg', 'lindenholt'] } },
      { resource: 'app2', actions: ['view'] },
    ]));
    expect(auditTrail.events).toContainEqual(expect.objectContaining({
      eventType: 'PERMISSION_RESOURCE_CHANGED', targetEmail: 'medewerker@nijmegen.nl', resource: 'sport', actorEmail: 'sportadmin@nijmegen.nl',
    }));
  });

  it('toggles sport:* on and back off again via two separate updates', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    permissionAdministrationRepository.seedUsers({
      email: 'medewerker@nijmegen.nl', hasSubject: true, grants: [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }],
    });
    const identity = { principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' };

    const grantAdmin = csrfBody({ targetEmail: 'medewerker@nijmegen.nl', resource: 'sport', accessMode: 'admin' });
    await handler.handleRequest(identity, grantAdmin.cookieHeader, grantAdmin.body, false);
    let target = (await permissionAdministrationRepository.listAllUsers()).find((user) => user.email === 'medewerker@nijmegen.nl');
    expect(target?.grants).toEqual([{ resource: 'sport', actions: ['*'] }]);

    const revokeAdmin = csrfBody({ targetEmail: 'medewerker@nijmegen.nl', resource: 'sport', action: 'view', districts: 'dukenburg' });
    await handler.handleRequest(identity, revokeAdmin.cookieHeader, revokeAdmin.body, false);
    target = (await permissionAdministrationRepository.listAllUsers()).find((user) => user.email === 'medewerker@nijmegen.nl');
    expect(target?.grants).toEqual([{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
  });

  it('denies and writes nothing when a sport admin tampers the resource field to app2', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    permissionAdministrationRepository.seedUsers({
      email: 'medewerker@nijmegen.nl', hasSubject: true, grants: [{ resource: 'app2', actions: ['view'] }],
    });
    const { cookieHeader, body } = csrfBody({ targetEmail: 'medewerker@nijmegen.nl', resource: 'app2', action: 'view' });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(403);
    const target = (await permissionAdministrationRepository.listAllUsers()).find((user) => user.email === 'medewerker@nijmegen.nl');
    expect(target?.grants).toEqual([{ resource: 'app2', actions: ['view'] }]);
  });
});
