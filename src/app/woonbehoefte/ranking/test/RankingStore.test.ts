import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { RankingStore } from '../RankingStore';

const documentMock = mockClient(DynamoDBDocumentClient);

function newStore(): RankingStore {
  return new RankingStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-woonbehoefte-cases-table');
}

function conditionalCheckFailed(): Error {
  return Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
}

const NOW = new Date('2026-09-26T10:00:00.000Z');

describe('RankingStore', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('initializes the ranking item once, revision 1', async () => {
    documentMock.on(PutCommand).resolves({});

    const result = await newStore().initialize(['OF-1', 'OF-2'], 'ranking-import', NOW);

    expect(result).toBe('OK');
    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input.Item).toMatchObject({
      pk: 'RANKING', sk: 'CURRENT', orderedCaseReferences: ['OF-1', 'OF-2'], revision: 1, updatedBy: 'ranking-import',
    });
    expect(call.args[0].input.ConditionExpression).toBe('attribute_not_exists(pk)');
  });

  it('never overwrites an existing ranking item on a repeated import', async () => {
    documentMock.on(PutCommand).rejects(conditionalCheckFailed());

    const result = await newStore().initialize(['OF-1'], 'ranking-import', NOW);

    expect(result).toBe('ALREADY_INITIALIZED');
  });

  it('inserts an unranked case at the requested position and bumps the revision', async () => {
    documentMock.on(GetCommand).resolves({ Item: { orderedCaseReferences: ['OF-1', 'OF-2'], revision: 3 } });
    documentMock.on(PutCommand).resolves({});

    const result = await newStore().insert('OF-NEW', 2, 'medewerker@example.invalid', 3, NOW);

    expect(result).toBe('OK');
    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input.Item).toMatchObject({ orderedCaseReferences: ['OF-1', 'OF-NEW', 'OF-2'], revision: 4 });
    expect(call.args[0].input.ConditionExpression).toBe('#revision = :expectedRevision');
    expect(call.args[0].input.ExpressionAttributeValues).toEqual({ ':expectedRevision': 3 });
  });

  it('moves a ranked case to a new position', async () => {
    documentMock.on(GetCommand).resolves({ Item: { orderedCaseReferences: ['OF-1', 'OF-2', 'OF-3'], revision: 1 } });
    documentMock.on(PutCommand).resolves({});

    const result = await newStore().move('OF-3', 1, 'medewerker@example.invalid', 1, NOW);

    expect(result).toBe('OK');
    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input.Item).toMatchObject({ orderedCaseReferences: ['OF-3', 'OF-1', 'OF-2'], revision: 2 });
  });

  it('is a no-op when moved to its current position: no write, revision unchanged', async () => {
    documentMock.on(GetCommand).resolves({ Item: { orderedCaseReferences: ['OF-1', 'OF-2', 'OF-3'], revision: 5 } });

    const result = await newStore().move('OF-2', 2, 'medewerker@example.invalid', 5, NOW);

    expect(result).toBe('OK');
    expect(documentMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('removes a ranked case, shifting successors up', async () => {
    documentMock.on(GetCommand).resolves({ Item: { orderedCaseReferences: ['OF-1', 'OF-2', 'OF-3'], revision: 1 } });
    documentMock.on(PutCommand).resolves({});

    const result = await newStore().remove('OF-1', 'medewerker@example.invalid', 1, NOW);

    expect(result).toBe('OK');
    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input.Item).toMatchObject({ orderedCaseReferences: ['OF-2', 'OF-3'], revision: 2 });
  });

  it('reports NOT_INITIALIZED when there is no ranking item yet', async () => {
    documentMock.on(GetCommand).resolves({});

    const result = await newStore().insert('OF-1', 1, 'medewerker@example.invalid', 1, NOW);

    expect(result).toBe('NOT_INITIALIZED');
    expect(documentMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('rejects a stale revision before even reading the list contents into a write', async () => {
    documentMock.on(GetCommand).resolves({ Item: { orderedCaseReferences: ['OF-1', 'OF-2'], revision: 4 } });

    const result = await newStore().remove('OF-1', 'medewerker@example.invalid', 3, NOW);

    expect(result).toBe('STALE_REVISION');
    expect(documentMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('reports STALE_REVISION when a concurrent write wins the race at the final conditional PutItem', async () => {
    documentMock.on(GetCommand).resolves({ Item: { orderedCaseReferences: ['OF-1', 'OF-2'], revision: 1 } });
    documentMock.on(PutCommand).rejects(conditionalCheckFailed());

    const result = await newStore().remove('OF-1', 'medewerker@example.invalid', 1, NOW);

    expect(result).toBe('STALE_REVISION');
  });
});
