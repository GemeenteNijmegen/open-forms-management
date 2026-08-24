import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsClientStub, mockClient } from 'aws-sdk-client-mock';
import { FakeAuditTrail } from '../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { DynamoDbPermissionRepository } from '../../shared/authorization/DynamoDbPermissionRepository';
import { CSRF_COOKIE_NAME, CSRF_FORM_FIELD, issueCsrfToken } from '../../shared/security/csrf/CsrfProtection';
import { PermissionAdministrationPolicy } from '../permissions/administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from '../permissions/administration/PermissionAdministrationService';
import { PermissionCatalog } from '../permissions/catalog/PermissionCatalog';
import { DynamoDbPermissionAdministrationRepository } from '../permissions/store/DynamoDbPermissionAdministrationRepository';
import { PermissionUserCreateHandler } from '../permissions/ui-request-handlers/PermissionUserCreateHandler';
import { PermissionUserRemoveHandler } from '../permissions/ui-request-handlers/PermissionUserRemoveHandler';
import { PermissionUserUpdateHandler } from '../permissions/ui-request-handlers/PermissionUserUpdateHandler';

/**
 * Minimal in-memory Get/Query/Scan/Put/Delete/TransactWrite simulation of the permissions table, just enough to
 * prove the administration repository's writes are readable by the runtime repository through the real item
 * shape (PermissionTableItem.ts) - not two independent fakes that trivially agree with each other.
 */
class InMemoryPermissionsTable {
  private readonly items = new Map<string, Record<string, any>>();

  private key(pk: string, sk: string): string {
    return `${pk}#${sk}`;
  }

  wireInto(documentMock: AwsClientStub<DynamoDBDocumentClient>): void {
    documentMock.on(GetCommand).callsFake((input) => ({ Item: this.items.get(this.key(input.Key.pk, input.Key.sk)) }));
    documentMock.on(PutCommand).callsFake((input) => {
      this.items.set(this.key(input.Item.pk, input.Item.sk), input.Item);
      return {};
    });
    documentMock.on(DeleteCommand).callsFake((input) => {
      this.items.delete(this.key(input.Key.pk, input.Key.sk));
      return {};
    });
    documentMock.on(QueryCommand).callsFake((input) => {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      const forPk = [...this.items.values()].filter((item) => item.pk === pk);
      return { Items: prefix ? forPk.filter((item) => typeof item.sk === 'string' && item.sk.startsWith(prefix)) : forPk };
    });
    documentMock.on(ScanCommand).callsFake(() => ({ Items: [...this.items.values()] }));
    documentMock.on(TransactWriteCommand).callsFake((input) => {
      for (const transactItem of input.TransactItems) {
        if (transactItem.Put) {
          this.items.set(this.key(transactItem.Put.Item.pk, transactItem.Put.Item.sk), transactItem.Put.Item);
        }
        if (transactItem.Delete) {
          this.items.delete(this.key(transactItem.Delete.Key.pk, transactItem.Delete.Key.sk));
        }
      }
      return {};
    });
  }
}

// app2 is registered so scenario D exercises the policy denial, not just an unregistered-resource parser rejection.
const catalog = new PermissionCatalog([
  {
    resource: 'sport',
    label: 'Sport',
    actions: [{ action: 'view', label: 'Bekijken' }],
    scopes: [{ key: 'districts', label: 'Wijken', values: [{ value: 'dukenburg', label: 'Dukenburg' }, { value: 'lindenholt', label: 'Lindenholt' }] }],
  },
  { resource: 'app2', label: 'App2', actions: [{ action: 'view', label: 'Bekijken' }], scopes: [] },
]);
const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));

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

const documentMock = mockClient(DynamoDBDocumentClient);

describe('Permissions integration: administration write -> runtime read', () => {
  let adminRepository: DynamoDbPermissionAdministrationRepository;
  let runtimeRepository: DynamoDbPermissionRepository;
  let authorizationService: AuthorizationService;
  let auditTrail: FakeAuditTrail;

  beforeEach(async () => {
    documentMock.reset();
    new InMemoryPermissionsTable().wireInto(documentMock);
    const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    adminRepository = new DynamoDbPermissionAdministrationRepository(documentClient, 'test-permissions-table');
    runtimeRepository = new DynamoDbPermissionRepository(documentClient, 'test-permissions-table');
    auditTrail = new FakeAuditTrail();
    authorizationService = new AuthorizationService(runtimeRepository, auditTrail);

    await adminRepository.addResourceGrants('sportadmin@nijmegen.nl', [{ resource: 'sport', actions: ['*'] }], 'bootstrap');
  });

  it('scenario A: a Sport admin creates a new Dukenburg user, who immediately has Sport access', async () => {
    const handler = new PermissionUserCreateHandler(authorizationService, administrationService, catalog, adminRepository, auditTrail);
    const { cookieHeader, body } = csrfBody({ targetEmail: 'nieuw@nijmegen.nl', resource: 'sport', action: 'view', districts: 'dukenburg' });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(303);
    const newUserContext = await authorizationService.loadContext({ principalId: 'new-1', email: 'nieuw@nijmegen.nl' });
    expect(newUserContext.evaluator.evaluate({ resource: 'sport', action: 'view', scope: { districts: 'dukenburg' } })).toBe('ALLOW');
  });

  it('scenario B: an added scope is visible on the very next request, no session-side permission caching', async () => {
    await adminRepository.addResourceGrants(
      'medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }], 'sportadmin@nijmegen.nl',
    );
    const before = await authorizationService.loadContext({ principalId: 'medewerker-1', email: 'medewerker@nijmegen.nl' });
    expect(before.evaluator.evaluate({ resource: 'sport', action: 'view', scope: { districts: 'lindenholt' } })).toBe('DENY');

    const handler = new PermissionUserUpdateHandler(authorizationService, administrationService, catalog, adminRepository, auditTrail);
    const { cookieHeader, body } = csrfBody({ targetEmail: 'medewerker@nijmegen.nl', resource: 'sport', action: 'view', districts: ['dukenburg', 'lindenholt'] });
    await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    const after = await authorizationService.loadContext({ principalId: 'medewerker-1', email: 'medewerker@nijmegen.nl' });
    expect(after.evaluator.evaluate({ resource: 'sport', action: 'view', scope: { districts: 'lindenholt' } })).toBe('ALLOW');
  });

  it('scenario C: removing a Sport-only user leaves them with no Sport access at all', async () => {
    await adminRepository.addResourceGrants(
      'medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }], 'sportadmin@nijmegen.nl',
    );
    const handler = new PermissionUserRemoveHandler(authorizationService, administrationService, catalog, adminRepository, auditTrail);
    const { cookieHeader, body } = csrfBody({ targetEmail: 'medewerker@nijmegen.nl', resource: 'sport', confirmed: '1' });

    await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    const after = await authorizationService.loadContext({ principalId: 'medewerker-1', email: 'medewerker@nijmegen.nl' });
    expect(after.evaluator.evaluate({ resource: 'sport', action: 'view', scope: { districts: 'dukenburg' } })).toBe('DENY');
  });

  it('scenario D: tampering the resource field to app2 is denied end to end and writes nothing', async () => {
    const handler = new PermissionUserUpdateHandler(authorizationService, administrationService, catalog, adminRepository, auditTrail);
    const { cookieHeader, body } = csrfBody({ targetEmail: 'target@nijmegen.nl', resource: 'app2', action: 'view' });

    const response = await handler.handleRequest({ principalId: 'sportadmin-1', email: 'sportadmin@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(403);
    const targetContext = await authorizationService.loadContext({ principalId: 'target-1', email: 'target@nijmegen.nl' });
    expect(targetContext.evaluator.evaluate({ resource: 'app2', action: 'view' })).toBe('DENY');
  });
});
