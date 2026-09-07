import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { AdditionalEvidenceRepository, AdditionalEvidenceWorkItem } from '../AdditionalEvidenceRepository';

const documentMock = mockClient(DynamoDBDocumentClient);

function newRepository(): AdditionalEvidenceRepository {
  return new AdditionalEvidenceRepository(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-woonbehoefte-cases-table');
}

function conditionalCheckFailed(): Error {
  return Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
}

const workItem: AdditionalEvidenceWorkItem = {
  objectUuid: 'uuid-1',
  submissionReference: 'OF-EXTRA01',
  status: 'NEW',
  createdAt: '2026-09-07T18:00:00.000Z',
  createdBy: 'additional-evidence-sync-worker',
};

describe('AdditionalEvidenceRepository', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('creates a workitem under the fixed workitem partition, never under a CASE# partition, without any CSV content', async () => {
    documentMock.on(PutCommand).resolves({});

    const created = await newRepository().createWorkItemIfMissing('uuid-1', 'OF-EXTRA01', 'additional-evidence-sync-worker', new Date('2026-09-07T18:00:00.000Z'));

    expect(created).toBe(true);
    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input.Item).toEqual({
      pk: 'ADDITIONAL_EVIDENCE#WORKITEMS', sk: 'WORKITEM#uuid-1', ...workItem,
    });
    expect(call.args[0].input.ConditionExpression).toBe('attribute_not_exists(pk)');
  });

  it('never overwrites an existing workitem, regardless of its current status', async () => {
    documentMock.on(PutCommand).rejects(conditionalCheckFailed());

    const created = await newRepository().createWorkItemIfMissing('uuid-1', 'OF-EXTRA01', 'additional-evidence-sync-worker');

    expect(created).toBe(false);
  });

  it('reads back a single workitem by objectUuid', async () => {
    documentMock.on(GetCommand).resolves({ Item: workItem });

    const found = await newRepository().getWorkItem('uuid-1');

    expect(found).toEqual(workItem);
    const call = documentMock.commandCalls(GetCommand)[0];
    expect(call.args[0].input.Key).toEqual({ pk: 'ADDITIONAL_EVIDENCE#WORKITEMS', sk: 'WORKITEM#uuid-1' });
  });

  it('lists every workitem under the fixed partition in one query', async () => {
    documentMock.on(QueryCommand).resolves({ Items: [workItem] });

    const workItems = await newRepository().listWorkItems();

    expect(workItems).toEqual([workItem]);
    const call = documentMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({
      ':pk': 'ADDITIONAL_EVIDENCE#WORKITEMS', ':workItemPrefix': 'WORKITEM#',
    });
  });

  describe('changeStatus', () => {
    it('moves NEW to UNKNOWN, guarded by a status <> LINKED condition on the write itself', async () => {
      documentMock.on(GetCommand).resolves({ Item: workItem });
      documentMock.on(UpdateCommand).resolves({});

      const outcome = await newRepository().changeStatus('uuid-1', 'UNKNOWN');

      expect(outcome).toEqual({ result: 'OK', fromStatus: 'NEW', submissionReference: 'OF-EXTRA01' });
      const call = documentMock.commandCalls(UpdateCommand)[0];
      expect(call.args[0].input.Key).toEqual({ pk: 'ADDITIONAL_EVIDENCE#WORKITEMS', sk: 'WORKITEM#uuid-1' });
      expect(call.args[0].input.ConditionExpression).toBe('#status <> :linked');
      expect(call.args[0].input.ExpressionAttributeValues).toEqual({ ':targetStatus': 'UNKNOWN', ':linked': 'LINKED' });
    });

    it('is a no-op, without writing, when the target equals the current status', async () => {
      documentMock.on(GetCommand).resolves({ Item: workItem });

      const outcome = await newRepository().changeStatus('uuid-1', 'NEW');

      expect(outcome).toEqual({ result: 'NOOP', fromStatus: 'NEW', submissionReference: 'OF-EXTRA01' });
      expect(documentMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('refuses to move an already-LINKED workitem back, without writing', async () => {
      documentMock.on(GetCommand).resolves({ Item: { ...workItem, status: 'LINKED' } });

      const outcome = await newRepository().changeStatus('uuid-1', 'UNKNOWN');

      expect(outcome).toEqual({ result: 'LINKED', fromStatus: 'LINKED', submissionReference: 'OF-EXTRA01' });
      expect(documentMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('reports LINKED when the write races against a concurrent link action (condition failure)', async () => {
      documentMock.on(GetCommand).resolves({ Item: workItem });
      documentMock.on(UpdateCommand).rejects(conditionalCheckFailed());

      const outcome = await newRepository().changeStatus('uuid-1', 'UNKNOWN');

      expect(outcome).toEqual({ result: 'LINKED', fromStatus: 'NEW', submissionReference: 'OF-EXTRA01' });
    });

    it('reports NOT_FOUND for an unknown objectUuid', async () => {
      documentMock.on(GetCommand).resolves({});

      const outcome = await newRepository().changeStatus('uuid-missing', 'UNKNOWN');

      expect(outcome).toEqual({ result: 'NOT_FOUND' });
    });
  });
});
