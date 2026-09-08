import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceRecord } from '../../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceSourceCacheStore } from '../AdditionalEvidenceSourceCacheStore';

const documentMock = mockClient(DynamoDBDocumentClient);

function newStore(): AdditionalEvidenceSourceCacheStore {
  // Same physical table as the primary Woonbehoefte source cache: own partition, not a separate table.
  return new AdditionalEvidenceSourceCacheStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-woonbehoefte-source-cache-table');
}

const readyRecord: AdditionalEvidenceSourceRecord = {
  status: 'READY',
  cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
  objectUuid: 'uuid-1',
  submissionId: 'uuid-1',
  reference: 'OF-EXTRA01',
  formName: 'Extra bewijzen stroomaansluiting woningbouw',
  submittedAt: '2026-09-07T17:54:04.702Z',
  originalCaseReference: 'OF-HOOFD01',
  attachments: [],
  cachedAt: '2026-09-07T18:00:00.000Z',
};

describe('AdditionalEvidenceSourceCacheStore', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('never uses the primary WOONBEHOEFTE#SUBMISSIONS partition for reads, writes or state', async () => {
    documentMock.on(PutCommand).resolves({});
    documentMock.on(GetCommand).resolves({});
    documentMock.on(UpdateCommand).resolves({});

    const store = newStore();
    await store.putReady(readyRecord);
    await store.getState();
    await store.claimRefresh('run-1');

    for (const call of documentMock.commandCalls(PutCommand)) {
      expect(call.args[0].input.Item?.pk).toBe('ADDITIONAL_EVIDENCE#SUBMISSIONS');
    }
    for (const call of documentMock.commandCalls(GetCommand)) {
      expect(call.args[0].input.Key?.pk).toBe('ADDITIONAL_EVIDENCE#SUBMISSIONS');
    }
    for (const call of documentMock.commandCalls(UpdateCommand)) {
      expect(call.args[0].input.Key?.pk).toBe('ADDITIONAL_EVIDENCE#SUBMISSIONS');
    }
  });

  it('lets the first refresh claim the run, but a concurrent second start loses the race', async () => {
    documentMock.on(UpdateCommand).resolvesOnce({}).rejectsOnce(
      Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }),
    );

    const store = newStore();
    await expect(store.claimRefresh('run-1')).resolves.toBe(true);
    await expect(store.claimRefresh('run-2')).resolves.toBe(false);
  });

  it('finalizes state only for the runId that is still active; a superseded/old runId is rejected', async () => {
    documentMock.on(UpdateCommand).resolvesOnce({}).rejectsOnce(
      Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }),
    );

    const store = newStore();
    await expect(store.finalizeRefresh('run-1', 'READY')).resolves.toBe(true);
    await expect(store.finalizeRefresh('run-2', 'READY')).resolves.toBe(false);
  });
});
