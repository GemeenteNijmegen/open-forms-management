import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { CSRF_COOKIE_NAME, CSRF_FORM_FIELD, issueCsrfToken } from '../../../../shared/security/csrf/CsrfProtection';
import { PermissionAdministrationPolicy } from '../../administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from '../../administration/PermissionAdministrationService';
import { PermissionCatalog } from '../../catalog/PermissionCatalog';
import { FakePermissionAdministrationRepository } from '../../store/test/FakePermissionAdministrationRepository';
import { PermissionUserCreateHandler } from '../PermissionUserCreateHandler';

// app2 is registered too, so a sport admin targeting it exercises the policy check, not just the catalog check.
const catalog = new PermissionCatalog([
  {
    resource: 'sport',
    label: 'Sport',
    actions: [{ action: 'view', label: 'Bekijken' }],
    scopes: [{ key: 'districts', label: 'Wijken', values: [{ value: 'dukenburg', label: 'Dukenburg' }] }],
  },
  { resource: 'app2', label: 'App2', actions: [{ action: 'view', label: 'Bekijken' }], scopes: [] },
]);

function newHandler() {
  const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));
  const permissionAdministrationRepository = new FakePermissionAdministrationRepository();
  const auditTrail = new FakeAuditTrail();
  const permissionRepository = new FakePermissionRepository();
  const authorizationService = new AuthorizationService(permissionRepository, auditTrail);
  const handler = new PermissionUserCreateHandler(
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

describe('PermissionUserCreateHandler', () => {
  it('creates a subject and Sport grant for a brand new Sport user, audited as PERMISSION_SUBJECT_CREATED', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository, auditTrail } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    const { cookieHeader, body } = csrfBody({
      targetEmail: 'nieuw@nijmegen.nl', resource: 'sport', action: 'view', districts: 'dukenburg',
    });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(303);
    const users = await permissionAdministrationRepository.listAllUsers();
    expect(users).toContainEqual({
      email: 'nieuw@nijmegen.nl', hasSubject: true, grants: [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }],
    });
    expect(auditTrail.events).toContainEqual(expect.objectContaining({
      eventType: 'PERMISSION_SUBJECT_CREATED', targetEmail: 'nieuw@nijmegen.nl', actorEmail: 'sportadmin@nijmegen.nl', resource: 'sport',
    }));
  });

  it('only adds Sport to a subject that already exists for another resource, audited as PERMISSION_RESOURCE_ADDED', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository, auditTrail } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    permissionAdministrationRepository.seedUsers({ email: 'bestaat-al@nijmegen.nl', hasSubject: true, grants: [{ resource: 'app2', actions: ['view'] }] });
    const { cookieHeader, body } = csrfBody({ targetEmail: 'bestaat-al@nijmegen.nl', resource: 'sport', accessMode: 'admin' });

    await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    const users = await permissionAdministrationRepository.listAllUsers();
    const target = users.find((user) => user.email === 'bestaat-al@nijmegen.nl');
    expect(target?.grants).toEqual(expect.arrayContaining([{ resource: 'app2', actions: ['view'] }, { resource: 'sport', actions: ['*'] }]));
    expect(auditTrail.events).toContainEqual(expect.objectContaining({ eventType: 'PERMISSION_RESOURCE_ADDED', targetEmail: 'bestaat-al@nijmegen.nl' }));
  });

  it('rejects a privilege-escalation POST for a registered resource the actor does not manage, without writing anything', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository, auditTrail } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    // app2 is a real catalog resource; only the policy check (not the catalog check) can deny this.
    const { cookieHeader, body } = csrfBody({ targetEmail: 'target@nijmegen.nl', resource: 'app2', action: 'view' });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(403);
    expect(await permissionAdministrationRepository.listAllUsers()).toEqual([]);
    expect(auditTrail.events).toContainEqual(expect.objectContaining({ eventType: 'ACCESS_DENIED', resource: 'app2' }));
  });

  it('redirects an invalid submission back with the submitted resource preserved, so the create form re-renders for the right resource', async () => {
    const { handler, permissionRepository } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    const { cookieHeader, body } = csrfBody({ targetEmail: 'niet-een-email-adres', resource: 'sport', action: 'view' });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/permissions/users/new?status=invalid&resource=sport');
  });

  it('rejects a mismatched CSRF token without writing anything', async () => {
    const { handler, permissionRepository, permissionAdministrationRepository } = newHandler();
    permissionRepository.seedGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }]);
    const form = new URLSearchParams({ targetEmail: 'target@nijmegen.nl', resource: 'sport', action: 'view', [CSRF_FORM_FIELD]: 'wrong-token' });

    const response = await handler.handleRequest(
      { principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, `${CSRF_COOKIE_NAME}=actual-token`, form.toString(), false,
    );

    expect(response.statusCode).toBe(403);
    expect(await permissionAdministrationRepository.listAllUsers()).toEqual([]);
  });
});
