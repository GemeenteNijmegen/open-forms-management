import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { logger } from '../../../observability/Logger';
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

  it('ignores a _subject item in the same partition without logging a warning', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    documentMock.on(QueryCommand).resolves({
      Items: [
        { pk: 'medewerker@nijmegen.nl', sk: '_subject', createdAt: '2026-08-22T20:00:00.000Z', createdBy: 'beheerder@nijmegen.nl' },
        { pk: 'medewerker@nijmegen.nl', sk: 'testresource#1', resource: 'testresource', actions: ['view'] },
      ],
    });

    const grants = await newRepository().getGrants('medewerker@nijmegen.nl');

    expect(grants).toEqual([{ resource: 'testresource', actions: ['view'] }]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
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
});
