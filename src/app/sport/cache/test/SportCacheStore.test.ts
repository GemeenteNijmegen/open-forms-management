import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { CachedSportSubmission, SPORT_CACHE_VERSION } from '../SportCacheItem';
import { SportCacheStore } from '../SportCacheStore';

const documentMock = mockClient(DynamoDBDocumentClient);

function newStore(): SportCacheStore {
  return new SportCacheStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-sport-cache-table');
}

// A separate constant, not inlined into readySubmission()'s return: mixing literal keys with a same-shaped
// `...overrides` spread in one object literal makes TS flag every default field as "always overwritten".
const DEFAULT_READY_SUBMISSION: CachedSportSubmission = {
  status: 'READY',
  objectUuid: 'uuid-1',
  reference: 'OF-1',
  hasPdf: false,
  registrationAt: '2026-08-01T00:00:00.000Z',
  data: {} as CachedSportSubmission['data'],
  cachedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  cacheVersion: SPORT_CACHE_VERSION,
};

function readySubmission(overrides: Partial<CachedSportSubmission> = {}): CachedSportSubmission {
  return { ...DEFAULT_READY_SUBMISSION, ...overrides };
}

describe('SportCacheStore', () => {
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

  it('splits active items into READY submissions and FAILED markers, excluding expired items and wrong cache versions', async () => {
    const now = Date.now();
    documentMock.on(QueryCommand).resolves({
      Items: [
        readySubmission({ objectUuid: 'current' }),
        readySubmission({ objectUuid: 'expired', expiresAt: Math.floor(now / 1000) - 10 }),
        readySubmission({ objectUuid: 'old-version', cacheVersion: SPORT_CACHE_VERSION + 1 }),
        {
          status: 'FAILED',
          objectUuid: 'failed',
          failureReason: 'CSV_FETCH_ERROR',
          lastAttemptAt: new Date().toISOString(),
          expiresAt: Math.floor(now / 1000) + 3600,
        },
        {
          status: 'FAILED',
          objectUuid: 'expired-failed',
          failureReason: 'CSV_FETCH_ERROR',
          lastAttemptAt: new Date().toISOString(),
          expiresAt: Math.floor(now / 1000) - 10,
        },
      ],
    });

    const result = await newStore().readActiveItems(new Date(now));

    expect(result.submissions.map((s) => s.objectUuid)).toEqual(['current']);
    expect(result.failedMarkers.map((f) => f.objectUuid)).toEqual(['failed']);
  });

  it('looks up cache items in a batch, leaving unknown objectUuid\'s absent from the result', async () => {
    documentMock.on(BatchGetCommand).resolves({
      Responses: { 'test-sport-cache-table': [readySubmission({ objectUuid: 'known' })] },
    });

    const result = await newStore().getItems(['known', 'unknown']);

    expect(result.has('known')).toBe(true);
    expect(result.has('unknown')).toBe(false);
  });

  it('writes a READY submission and a FAILED marker under the same key shape', async () => {
    documentMock.on(PutCommand).resolves({});

    await newStore().putReady(readySubmission());
    await newStore().putFailed({
      status: 'FAILED', objectUuid: 'uuid-2', failureReason: 'CSV_PARSE_ERROR', lastAttemptAt: new Date().toISOString(), expiresAt: 1,
    });

    const calls = documentMock.commandCalls(PutCommand);
    expect(calls[0].args[0].input.Item).toMatchObject({ pk: 'SPORT#SUBMISSIONS', sk: 'OBJECT#uuid-1', status: 'READY' });
    expect(calls[1].args[0].input.Item).toMatchObject({ pk: 'SPORT#SUBMISSIONS', sk: 'OBJECT#uuid-2', status: 'FAILED' });
  });

  it('reads and returns undefined state when nothing has ever refreshed', async () => {
    documentMock.on(GetCommand).resolves({});

    await expect(newStore().getState()).resolves.toBeUndefined();
  });
});
