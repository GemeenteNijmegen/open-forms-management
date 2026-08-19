import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDbPermissionRepository } from '../DynamoDbPermissionRepository';

const documentMock = mockClient(DynamoDBDocumentClient);

function newRepository() {
  return new DynamoDbPermissionRepository(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-permissions-table');
}

describe('DynamoDbPermissionRepository', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('queries on the email partition key and maps every grant item', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [
        { pk: 'medewerker@nijmegen.nl', sk: '*#1', resource: '*', actions: ['*'] },
        {
          pk: 'medewerker@nijmegen.nl',
          sk: 'testresource#2',
          resource: 'testresource',
          actions: ['view'],
          scopes: { districts: ['dukenburg'] },
        },
      ],
    });

    const grants = await newRepository().getGrants('medewerker@nijmegen.nl');

    expect(grants).toEqual([
      { resource: '*', actions: ['*'] },
      { resource: 'testresource', actions: ['view'], scopes: { districts: ['dukenburg'] } },
    ]);

    const call = documentMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input).toMatchObject({
      TableName: 'test-permissions-table',
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'medewerker@nijmegen.nl' },
    });
  });

  it('returns an empty array when the employee has no grants', async () => {
    documentMock.on(QueryCommand).resolves({ Items: [] });

    const grants = await newRepository().getGrants('zonder-rechten@nijmegen.nl');

    expect(grants).toEqual([]);
  });

  it('drops a grant with a missing resource instead of granting extra access', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [{ pk: 'medewerker@nijmegen.nl', sk: 'testresource#1', actions: ['view'] }],
    });

    const grants = await newRepository().getGrants('medewerker@nijmegen.nl');

    expect(grants).toEqual([]);
  });

  it('drops a grant with non-string actions instead of granting extra access', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [{ pk: 'medewerker@nijmegen.nl', sk: 'testresource#1', resource: 'testresource', actions: ['view', 42] }],
    });

    const grants = await newRepository().getGrants('medewerker@nijmegen.nl');

    expect(grants).toEqual([]);
  });

  it('drops a grant with malformed scopes instead of granting extra access', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [{
        pk: 'medewerker@nijmegen.nl',
        sk: 'testresource#1',
        resource: 'testresource',
        actions: ['view'],
        scopes: { districts: 'dukenburg' },
      }],
    });

    const grants = await newRepository().getGrants('medewerker@nijmegen.nl');

    expect(grants).toEqual([]);
  });

  it('drops a grant whose scopes value is not an object instead of granting extra access', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [{ pk: 'medewerker@nijmegen.nl', sk: 'testresource#1', resource: 'testresource', actions: ['view'], scopes: ['dukenburg'] }],
    });

    const grants = await newRepository().getGrants('medewerker@nijmegen.nl');

    expect(grants).toEqual([]);
  });

  it('keeps the valid grants in a query result and drops only the invalid one', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [
        { pk: 'medewerker@nijmegen.nl', sk: 'testresource#1', resource: 'testresource', actions: ['view'] },
        { pk: 'medewerker@nijmegen.nl', sk: 'testresource#2', resource: 'testresource' },
      ],
    });

    const grants = await newRepository().getGrants('medewerker@nijmegen.nl');

    expect(grants).toEqual([{ resource: 'testresource', actions: ['view'] }]);
  });

  it('writes a grant with a resource-prefixed sk and a conditional write guarding against overwriting an existing item', async () => {
    documentMock.on(PutCommand).resolves({});

    await newRepository().putGrant('medewerker@nijmegen.nl', { resource: 'testresource', actions: ['view'] }, 'beheerder@nijmegen.nl');

    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input).toMatchObject({
      TableName: 'test-permissions-table',
      ConditionExpression: 'attribute_not_exists(sk)',
      Item: expect.objectContaining({
        pk: 'medewerker@nijmegen.nl',
        resource: 'testresource',
        actions: ['view'],
        createdBy: 'beheerder@nijmegen.nl',
      }),
    });
    expect(call.args[0].input.Item?.sk).toMatch(/^testresource#/);
    expect(call.args[0].input.Item?.createdAt).toEqual(expect.any(String));
  });

  it('writes a grant without createdBy when none is given', async () => {
    documentMock.on(PutCommand).resolves({});

    await newRepository().putGrant('medewerker@nijmegen.nl', { resource: 'testresource', actions: ['view'] });

    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input.Item).not.toHaveProperty('createdBy');
  });

  it('propagates a conditional check failure when the generated sk somehow already exists', async () => {
    const conditionalCheckFailed = Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
    documentMock.on(PutCommand).rejects(conditionalCheckFailed);

    await expect(newRepository().putGrant('medewerker@nijmegen.nl', { resource: 'testresource', actions: ['view'] }))
      .rejects.toThrow('The conditional request failed');
  });

  it('rejects a grant with an empty resource instead of writing an item that getGrants would silently ignore later', async () => {
    await expect(newRepository().putGrant('medewerker@nijmegen.nl', { resource: '', actions: ['view'] }))
      .rejects.toThrow('Cannot write a permission grant with an empty resource');

    expect(documentMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('rejects a grant with no actions instead of writing an item that getGrants would silently ignore later', async () => {
    await expect(newRepository().putGrant('medewerker@nijmegen.nl', { resource: 'testresource', actions: [] }))
      .rejects.toThrow('Cannot write a permission grant with no actions');

    expect(documentMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});
