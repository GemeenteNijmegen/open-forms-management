import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
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
});
