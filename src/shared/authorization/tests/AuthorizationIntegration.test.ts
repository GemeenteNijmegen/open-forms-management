import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { AuthorizationService } from '../AuthorizationService';
import { DynamoDbPermissionRepository } from '../DynamoDbPermissionRepository';
import { FakePermissionRepository } from './FakePermissionRepository';

/**
 * End-to-end use-case tests over the generic grant model, ahead of Sport
 * building concrete resources on top of it: global admin, resource admin,
 * exact-action grants, scopes, no grants, and a malformed stored record.
 */

const documentMock = mockClient(DynamoDBDocumentClient);

describe('authorization end to end, admin/resource-admin/action/scope semantics', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('allows a global admin across multiple unrelated example resources', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('admin@nijmegen.nl', [{ resource: '*', actions: ['*'] }]);
    const service = new AuthorizationService(repository);
    const context = await service.loadContext({ principalId: 'admin-1', email: 'admin@nijmegen.nl' });

    expect(service.requireAuthorization(context, { resource: 'testresource-a', action: 'view' })).toBeUndefined();
    expect(service.requireAuthorization(context, { resource: 'testresource-b', action: 'delete' })).toBeUndefined();
  });

  it('allows a resource admin on their own resource and denies every other resource', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('beheerder@nijmegen.nl', [{ resource: 'testresource', actions: ['*'] }]);
    const service = new AuthorizationService(repository);
    const context = await service.loadContext({ principalId: 'beheerder-1', email: 'beheerder@nijmegen.nl' });

    expect(service.requireAuthorization(context, { resource: 'testresource', action: 'delete' })).toBeUndefined();

    const denied = service.requireAuthorization(context, { resource: 'other-testresource', action: 'view' });
    expect(denied?.statusCode).toBe(403);
  });

  it('allows an action grant only for its exact action, denying every other action on the same resource', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'testresource', actions: ['view'] }]);
    const service = new AuthorizationService(repository);
    const context = await service.loadContext({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    expect(service.requireAuthorization(context, { resource: 'testresource', action: 'view' })).toBeUndefined();

    const denied = service.requireAuthorization(context, { resource: 'testresource', action: 'delete' });
    expect(denied?.statusCode).toBe(403);
  });

  it('enforces the scope on a scoped grant: matching scope allows, non-matching scope denies', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{
      resource: 'testresource',
      actions: ['view'],
      scopes: { districts: ['dukenburg'] },
    }]);
    const service = new AuthorizationService(repository);
    const context = await service.loadContext({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    expect(service.requireAuthorization(context, {
      resource: 'testresource', action: 'view', scope: { districts: 'dukenburg' },
    })).toBeUndefined();

    const denied = service.requireAuthorization(context, {
      resource: 'testresource', action: 'view', scope: { districts: 'lindenholt' },
    });
    expect(denied?.statusCode).toBe(403);
  });

  it('denies a medewerker with no grants at all', async () => {
    const repository = new FakePermissionRepository();
    const service = new AuthorizationService(repository);
    const context = await service.loadContext({ principalId: 'employee-1', email: 'zonder-rechten@nijmegen.nl' });

    const denied = service.requireAuthorization(context, { resource: 'testresource', action: 'view' });
    expect(denied?.statusCode).toBe(403);
  });

  it('fails closed when the stored grant record is malformed, through the real DynamoDB repository', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [{ pk: 'medewerker@nijmegen.nl', sk: 'testresource#1', resource: 'testresource' /* actions missing */ }],
    });

    const repository = new DynamoDbPermissionRepository(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-permissions-table');
    const service = new AuthorizationService(repository);
    const context = await service.loadContext({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    const denied = service.requireAuthorization(context, { resource: 'testresource', action: 'view' });
    expect(denied?.statusCode).toBe(403);
  });
});
