import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { AdditionalEvidenceLinkRepository } from '../AdditionalEvidenceLinkRepository';

const documentMock = mockClient(DynamoDBDocumentClient);

function newRepository(): AdditionalEvidenceLinkRepository {
  return new AdditionalEvidenceLinkRepository(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-woonbehoefte-cases-table');
}

function transactionCancelled(): Error {
  return Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException' });
}

describe('AdditionalEvidenceLinkRepository', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('commits the target-case existence check, the workitem LINKED update, the source link, the note and the activity in one transaction', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newRepository().link(
      'uuid-1', 'OF-EXTRA01', 'OF-HOOFD01', 'Automatisch toegevoegd vanuit extra-bewijzeninzending OF-EXTRA01.', 'medewerker@example.invalid',
      new Date('2026-09-09T10:32:00.000Z'),
    );

    expect(result).toBe('OK');
    const items = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
    expect(items).toHaveLength(5);

    expect(items?.[0].ConditionCheck).toMatchObject({
      Key: { pk: 'CASE#OF-HOOFD01', sk: 'CASE' }, ConditionExpression: 'attribute_exists(pk)',
    });

    expect(items?.[1].Update).toMatchObject({
      Key: { pk: 'ADDITIONAL_EVIDENCE#WORKITEMS', sk: 'WORKITEM#uuid-1' },
      ConditionExpression: 'attribute_exists(pk) AND #status <> :linked',
      ExpressionAttributeValues: { ':linked': 'LINKED', ':caseReference': 'OF-HOOFD01', ':linkedAt': '2026-09-09T10:32:00.000Z', ':actorEmail': 'medewerker@example.invalid' },
    });

    expect(items?.[2].Put).toMatchObject({
      Item: {
        pk: 'CASE#OF-HOOFD01',
        sk: 'SOURCE#ADDITIONAL#uuid-1',
        relation: 'ADDITIONAL',
        submissionId: 'uuid-1',
        submissionReference: 'OF-EXTRA01',
        linkedBy: 'medewerker@example.invalid',
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    });

    expect(items?.[3].Put?.Item).toMatchObject({
      pk: 'CASE#OF-HOOFD01',
      category: 'ADDITIONAL_INFORMATION',
      createdBy: 'medewerker@example.invalid',
      text: 'Automatisch toegevoegd vanuit extra-bewijzeninzending OF-EXTRA01.',
    });
    expect((items?.[3].Put?.Item?.sk as string)).toMatch(/^NOTE#/);

    expect(items?.[4].Put?.Item).toMatchObject({
      pk: 'CASE#OF-HOOFD01', type: 'ADDITIONAL_EVIDENCE_LINKED', actor: 'medewerker@example.invalid', summary: 'Extra bewijzen OF-EXTRA01 gekoppeld',
    });
    expect((items?.[4].Put?.Item?.sk as string)).toMatch(/^ACTIVITY#/);
  });

  it('reports CONFLICT without throwing when the transaction is cancelled (target gone, already LINKED, or a racing concurrent link)', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled());

    const result = await newRepository().link('uuid-1', 'OF-EXTRA01', 'OF-HOOFD01', 'note text', 'medewerker@example.invalid');

    expect(result).toBe('CONFLICT');
  });

  it('rethrows an unrelated error, never silently swallowing it as a conflict', async () => {
    documentMock.on(TransactWriteCommand).rejects(new Error('DynamoDB unavailable'));

    await expect(newRepository().link('uuid-1', 'OF-EXTRA01', 'OF-HOOFD01', 'note text', 'medewerker@example.invalid')).rejects.toThrow('DynamoDB unavailable');
  });
});
