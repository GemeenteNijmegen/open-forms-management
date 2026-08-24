import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { WOONBEHOEFTE_SOURCE_CACHE_VERSION, WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../WoonbehoefteSourceCacheStore';

const documentMock = mockClient(DynamoDBDocumentClient);

function newStore(): WoonbehoefteSourceCacheStore {
  return new WoonbehoefteSourceCacheStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-woonbehoefte-source-cache-table');
}

const DEFAULT_READY_RECORD: WoonbehoefteSourceRecord = {
  status: 'READY',
  cacheVersion: WOONBEHOEFTE_SOURCE_CACHE_VERSION,
  objectUuid: 'uuid-1',
  submissionId: 'uuid-1',
  submissionType: 'PRIMARY_APPLICATION',
  reference: 'OF-1',
  caseReference: 'OF-1',
  formName: 'Aanmelden stroomaansluiting woningbouw',
  registrationAt: '2026-08-01T00:00:00.000Z',
  applicantType: 'UNKNOWN',
  attachments: [],
  cachedAt: '2026-08-01T00:00:00.000Z',
};

function readyRecord(overrides: Partial<WoonbehoefteSourceRecord> = {}): WoonbehoefteSourceRecord {
  return { ...DEFAULT_READY_RECORD, ...overrides };
}

describe('WoonbehoefteSourceCacheStore', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('lets the first refresh claim the run, but a concurrent second start loses the race', async () => {
    documentMock.on(UpdateCommand).resolvesOnce({}).rejectsOnce(
      Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }),
    );

    const store = newStore();
    await expect(store.claimRefresh('run-1')).resolves.toBe(true);
    await expect(store.claimRefresh('run-2')).resolves.toBe(false);
  });

  it('reclaims a stale REFRESHING state older than the safe margin', async () => {
    documentMock.on(UpdateCommand).resolves({});

    await newStore().claimRefresh('run-2', new Date('2026-08-20T12:00:00Z'));

    const call = documentMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({
      ':staleThreshold': '2026-08-20T11:40:00.000Z',
    });
  });

  it('finalizes state only for the runId that is still active; a superseded/old runId is rejected', async () => {
    documentMock.on(UpdateCommand).resolvesOnce({}).rejectsOnce(
      Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }),
    );

    const store = newStore();
    await expect(store.finalizeRefresh('run-1', 'READY')).resolves.toBe(true);
    await expect(store.finalizeRefresh('run-0-stale', 'READY_WITH_ERRORS', undefined, { failedCount: 1 })).resolves.toBe(false);
  });

  it('splits submissions into READY records on the current cache version and FAILED markers', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [
        readyRecord({ objectUuid: 'current' }),
        readyRecord({ objectUuid: 'old-version', cacheVersion: WOONBEHOEFTE_SOURCE_CACHE_VERSION + 1 }),
        { status: 'FAILED', objectUuid: 'failed', failureReasonCode: 'CSV_FETCH_ERROR', lastAttemptAt: new Date().toISOString() },
      ],
    });

    const result = await newStore().readReadySubmissions();

    expect(result.submissions.map((s) => s.objectUuid)).toEqual(['current']);
    expect(result.failedMarkers.map((f) => f.objectUuid)).toEqual(['failed']);
  });

  it('looks up cache items in a batch, leaving unknown objectUuid\'s absent from the result', async () => {
    documentMock.on(BatchGetCommand).resolves({
      Responses: { 'test-woonbehoefte-source-cache-table': [readyRecord({ objectUuid: 'known' })] },
    });

    const result = await newStore().getItems(['known', 'unknown']);

    expect(result.has('known')).toBe(true);
    expect(result.has('unknown')).toBe(false);
  });

  it('writes a READY record and a FAILED marker under the SUBMISSION# key prefix', async () => {
    documentMock.on(PutCommand).resolves({});

    await newStore().putReady(readyRecord());
    await newStore().putFailed({ status: 'FAILED', objectUuid: 'uuid-2', failureReasonCode: 'CSV_PARSE_ERROR', lastAttemptAt: new Date().toISOString() });

    const calls = documentMock.commandCalls(PutCommand);
    expect(calls[0].args[0].input.Item).toMatchObject({ pk: 'WOONBEHOEFTE#SUBMISSIONS', sk: 'SUBMISSION#uuid-1', status: 'READY' });
    expect(calls[1].args[0].input.Item).toMatchObject({ pk: 'WOONBEHOEFTE#SUBMISSIONS', sk: 'SUBMISSION#uuid-2', status: 'FAILED' });
  });

  it('reads and returns undefined state when nothing has ever refreshed', async () => {
    documentMock.on(GetCommand).resolves({});

    await expect(newStore().getState()).resolves.toBeUndefined();
  });
});
