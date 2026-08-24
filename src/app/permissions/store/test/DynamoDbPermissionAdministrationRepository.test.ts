import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDbPermissionAdministrationRepository } from '../DynamoDbPermissionAdministrationRepository';

const documentMock = mockClient(DynamoDBDocumentClient);

function newRepository() {
  return new DynamoDbPermissionAdministrationRepository(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-permissions-table');
}

describe('DynamoDbPermissionAdministrationRepository', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('pages through LastEvaluatedKey and combines items from every scan page', async () => {
    documentMock.on(ScanCommand)
      .resolvesOnce({
        Items: [{ pk: 'piet@nijmegen.nl', sk: '_subject', createdAt: '2026-08-22T20:00:00.000Z' }],
        LastEvaluatedKey: { pk: 'piet@nijmegen.nl', sk: '_subject' },
      })
      .resolvesOnce({
        Items: [{ pk: 'piet@nijmegen.nl', sk: 'sport#1', resource: 'sport', actions: ['view'] }],
      });

    const users = await newRepository().listAllUsers();

    expect(documentMock.commandCalls(ScanCommand)).toHaveLength(2);
    expect(documentMock.commandCalls(ScanCommand)[1].args[0].input.ExclusiveStartKey).toEqual({ pk: 'piet@nijmegen.nl', sk: '_subject' });
    expect(users).toEqual([{ email: 'piet@nijmegen.nl', hasSubject: true, grants: [{ resource: 'sport', actions: ['view'] }] }]);
  });

  it('aggregates a subject-only user, a single-resource user and a multi-resource user for the superadmin overview', async () => {
    documentMock.on(ScanCommand).resolves({
      Items: [
        { pk: 'subject-only@nijmegen.nl', sk: '_subject', createdAt: '2026-08-22T20:00:00.000Z' },
        { pk: 'sport-admin@nijmegen.nl', sk: 'sport#1', resource: 'sport', actions: ['*'] },
        { pk: 'multi@nijmegen.nl', sk: 'sport#2', resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } },
        { pk: 'multi@nijmegen.nl', sk: 'app2#3', resource: 'app2', actions: ['view'] },
      ],
    });

    const users = await newRepository().listAllUsers();

    expect(users).toEqual([
      { email: 'subject-only@nijmegen.nl', hasSubject: true, grants: [] },
      { email: 'sport-admin@nijmegen.nl', hasSubject: false, grants: [{ resource: 'sport', actions: ['*'] }] },
      {
        email: 'multi@nijmegen.nl',
        hasSubject: false,
        grants: [
          { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } },
          { resource: 'app2', actions: ['view'] },
        ],
      },
    ]);
  });

  it('scopes the resource overview to users with an explicit grant for that resource, without leaking other resources', async () => {
    documentMock.on(ScanCommand).resolves({
      Items: [
        { pk: 'subject-only@nijmegen.nl', sk: '_subject', createdAt: '2026-08-22T20:00:00.000Z' },
        { pk: 'sport-only@nijmegen.nl', sk: 'sport#1', resource: 'sport', actions: ['view'] },
        { pk: 'multi@nijmegen.nl', sk: 'sport#2', resource: 'sport', actions: ['view'] },
        { pk: 'multi@nijmegen.nl', sk: 'app2#3', resource: 'app2', actions: ['*'] },
        { pk: 'app2-only@nijmegen.nl', sk: 'app2#4', resource: 'app2', actions: ['view'] },
        // A global superadmin does not implicitly show up in a resource-specific admin list.
        { pk: 'superadmin@nijmegen.nl', sk: '*#5', resource: '*', actions: ['*'] },
      ],
    });

    const users = await newRepository().listUsersForResource('sport');

    expect(users).toEqual([
      { email: 'sport-only@nijmegen.nl', hasSubject: false, grants: [{ resource: 'sport', actions: ['view'] }] },
      { email: 'multi@nijmegen.nl', hasSubject: false, grants: [{ resource: 'sport', actions: ['view'] }] },
    ]);
  });

  it('creates a fresh subject and the Sport grant atomically when the subject does not exist yet', async () => {
    documentMock.on(GetCommand).resolves({ Item: undefined });
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newRepository().addResourceGrants('nieuw@nijmegen.nl', [{ resource: 'sport', actions: ['view'] }], 'beheerder@nijmegen.nl');

    expect(result).toEqual({ subjectCreated: true });
    const transactItems = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(transactItems).toHaveLength(2);
    expect(transactItems[0].Put?.Item).toMatchObject({ pk: 'nieuw@nijmegen.nl', sk: '_subject', createdBy: 'beheerder@nijmegen.nl' });
    expect(transactItems[1].Put?.Item).toMatchObject({ pk: 'nieuw@nijmegen.nl', resource: 'sport', actions: ['view'], createdBy: 'beheerder@nijmegen.nl' });
  });

  it('only adds the grant, reusing an existing subject silently, when the subject already has another resource', async () => {
    documentMock.on(GetCommand).resolves({ Item: { pk: 'piet@nijmegen.nl', sk: '_subject' } });
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newRepository().addResourceGrants('piet@nijmegen.nl', [{ resource: 'sport', actions: ['view'] }], 'beheerder@nijmegen.nl');

    expect(result).toEqual({ subjectCreated: false });
    const transactItems = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(transactItems).toHaveLength(1);
    expect(transactItems[0].Put?.Item).toMatchObject({ resource: 'sport' });
  });

  it('replaces only the target resource\'s grants, deleting the old sport items and leaving app2 keys untouched', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [{ pk: 'piet@nijmegen.nl', sk: 'sport#old-1' }, { pk: 'piet@nijmegen.nl', sk: 'sport#old-2' }],
    });
    documentMock.on(TransactWriteCommand).resolves({});

    await newRepository().replaceResourceGrants(
      'piet@nijmegen.nl', 'sport', [{ resource: 'sport', actions: ['*'] }], 'beheerder@nijmegen.nl',
    );

    expect(documentMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': 'piet@nijmegen.nl', ':prefix': 'sport#' },
    });
    const transactItems = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(transactItems).toEqual([
      { Delete: { TableName: 'test-permissions-table', Key: { pk: 'piet@nijmegen.nl', sk: 'sport#old-1' } } },
      { Delete: { TableName: 'test-permissions-table', Key: { pk: 'piet@nijmegen.nl', sk: 'sport#old-2' } } },
      expect.objectContaining({ Put: expect.objectContaining({ Item: expect.objectContaining({ resource: 'sport', actions: ['*'] }) }) }),
    ]);
  });

  it('removes every Sport grant and the subject for a Sport-only user, including when there are several Sport grants', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [
        { pk: 'piet@nijmegen.nl', sk: '_subject', createdAt: '2026-08-22T20:00:00.000Z' },
        { pk: 'piet@nijmegen.nl', sk: 'sport#1', resource: 'sport', actions: ['view'] },
        { pk: 'piet@nijmegen.nl', sk: 'sport#2', resource: 'sport', actions: ['view'], scopes: { districts: ['lindenholt'] } },
      ],
    });
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newRepository().removeResourceGrants('piet@nijmegen.nl', 'sport');

    expect(result).toEqual({ subjectRemoved: true });
    const transactItems = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(transactItems).toEqual(expect.arrayContaining([
      { Delete: { TableName: 'test-permissions-table', Key: { pk: 'piet@nijmegen.nl', sk: 'sport#1' } } },
      { Delete: { TableName: 'test-permissions-table', Key: { pk: 'piet@nijmegen.nl', sk: 'sport#2' } } },
      { Delete: { TableName: 'test-permissions-table', Key: { pk: 'piet@nijmegen.nl', sk: '_subject' } } },
    ]));
    expect(transactItems).toHaveLength(3);
  });

  it('removes only the Sport grant and keeps the subject and app2 items when app2 remains', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [
        { pk: 'piet@nijmegen.nl', sk: '_subject', createdAt: '2026-08-22T20:00:00.000Z' },
        { pk: 'piet@nijmegen.nl', sk: 'sport#1', resource: 'sport', actions: ['view'] },
        { pk: 'piet@nijmegen.nl', sk: 'app2#1', resource: 'app2', actions: ['view'] },
      ],
    });
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newRepository().removeResourceGrants('piet@nijmegen.nl', 'sport');

    expect(result).toEqual({ subjectRemoved: false });
    const transactItems = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(transactItems).toEqual([{ Delete: { TableName: 'test-permissions-table', Key: { pk: 'piet@nijmegen.nl', sk: 'sport#1' } } }]);
  });
});
