import { DynamoDBDocumentClient, BatchGetCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  CachedSportSubmission, isCachedSportSubmission, isFailureMarker, SPORT_CACHE_VERSION, SportCacheFailureMarker, SportCacheItem,
} from './SportCacheItem';
import { SportRefreshState, SportRefreshStatus, SPORT_REFRESH_STALE_AFTER_MS } from './SportRefreshState';
import { logger } from '../../../observability/Logger';

const PARTITION_KEY = 'SPORT#SUBMISSIONS';
const STATE_SORT_KEY = 'STATE';
const OBJECT_SORT_KEY_PREFIX = 'OBJECT#';
const BATCH_GET_CHUNK_SIZE = 100;

function objectSortKey(objectUuid: string): string {
  return `${OBJECT_SORT_KEY_PREFIX}${objectUuid}`;
}

// DynamoDB can only store plain strings/numbers, not a JS Date object. submittedAt goes in as an ISO
// string and comes back out as a Date, so the rest of the app keeps working with a real Date value.
function toStorableItem(submission: CachedSportSubmission): Record<string, unknown> {
  return { ...submission, data: { ...submission.data, submittedAt: submission.data.submittedAt.toISOString() } };
}

function fromStorableItem(item: SportCacheItem): SportCacheItem {
  if (!isCachedSportSubmission(item)) {
    return item;
  }
  const submittedAt = item.data.submittedAt as unknown as string;
  return { ...item, data: { ...item.data, submittedAt: new Date(submittedAt) } };
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sport-specific store for one dedicated cache table: submission items and one singleton refresh state,
 * all in the `SPORT#SUBMISSIONS` partition (see `SportCacheTable`). No generic cache abstraction; every
 * method here is a real operation the refresh/read flow needs.
 */
export class SportCacheStore {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  /** An objectUuid missing from the result map is a cache miss (never seen, or evicted by TTL). */
  async getItems(objectUuids: string[]): Promise<Map<string, SportCacheItem>> {
    const result = new Map<string, SportCacheItem>();
    for (const batch of chunk(objectUuids, BATCH_GET_CHUNK_SIZE)) {
      if (batch.length === 0) {
        continue;
      }
      const response = await this.documentClient.send(new BatchGetCommand({
        RequestItems: {
          [this.tableName]: { Keys: batch.map((objectUuid) => ({ pk: PARTITION_KEY, sk: objectSortKey(objectUuid) })) },
        },
      }));
      for (const item of (response.Responses?.[this.tableName] ?? [])) {
        const cacheItem = fromStorableItem(item as SportCacheItem);
        result.set(cacheItem.objectUuid, cacheItem);
      }
    }
    return result;
  }

  /** Idempotent: a duplicate worker delivery for the same objectUuid safely overwrites the same READY item. */
  async putReady(submission: CachedSportSubmission): Promise<void> {
    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: PARTITION_KEY, sk: objectSortKey(submission.objectUuid), ...toStorableItem(submission) },
    }));
  }

  async putFailed(marker: SportCacheFailureMarker): Promise<void> {
    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: PARTITION_KEY, sk: objectSortKey(marker.objectUuid), ...marker },
    }));
  }

  /**
   * Every non-expired item across the whole partition, split into READY submissions on the current cache
   * version and FAILED markers, in one Query pass. No GSI: volumes are small enough that one Query plus
   * in-memory filter/sort is simpler, the same reasoning the Sport reporter already applies to its own table.
   */
  async readActiveItems(now: Date = new Date()): Promise<{ submissions: CachedSportSubmission[]; failedMarkers: SportCacheFailureMarker[] }> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const submissions: CachedSportSubmission[] = [];
    const failedMarkers: SportCacheFailureMarker[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.documentClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :objectPrefix)',
        ExpressionAttributeValues: { ':pk': PARTITION_KEY, ':objectPrefix': OBJECT_SORT_KEY_PREFIX },
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));

      for (const rawItem of (response.Items ?? [])) {
        const item = fromStorableItem(rawItem as SportCacheItem);
        if (item.expiresAt <= nowSeconds) {
          continue;
        }
        if (isCachedSportSubmission(item) && item.cacheVersion === SPORT_CACHE_VERSION) {
          submissions.push(item);
        } else if (isFailureMarker(item)) {
          failedMarkers.push(item);
        }
      }
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return { submissions, failedMarkers };
  }

  async getState(): Promise<SportRefreshState | undefined> {
    const result = await this.documentClient.send(new GetCommand({ TableName: this.tableName, Key: { pk: PARTITION_KEY, sk: STATE_SORT_KEY } }));
    return result.Item as SportRefreshState | undefined;
  }

  /**
   * Claims the refresh for `runId`: succeeds when there's no state yet, the previous refresh already
   * reached a final status, or the previous REFRESHING claim is stale. Loses the race, without error, when
   * another request just started a fresh REFRESHING run; that's an expected DEBUG-level outcome, not a failure.
   */
  async claimRefresh(runId: string, now: Date = new Date()): Promise<boolean> {
    const staleThreshold = new Date(now.getTime() - SPORT_REFRESH_STALE_AFTER_MS).toISOString();
    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: PARTITION_KEY, sk: STATE_SORT_KEY },
        UpdateExpression: 'SET runId = :runId, #status = :refreshing, startedAt = :startedAt REMOVE completedAt, failureReason, failedCount',
        ConditionExpression: 'attribute_not_exists(pk) OR #status <> :refreshing OR startedAt < :staleThreshold',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':refreshing': 'REFRESHING', ':runId': runId, ':startedAt': now.toISOString(), ':staleThreshold': staleThreshold,
        },
      }));
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        logger.debug('Sport cache refresh claim lost, a refresh is already active', { runId });
        return false;
      }
      throw error;
    }
  }

  /** Only finalizes the state if `runId` is still the active run; a superseded/reclaimed run is silently skipped. */
  async finalizeRefresh(
    runId: string,
    status: Exclude<SportRefreshStatus, 'REFRESHING'>,
    now: Date = new Date(),
    extra: { failureReason?: string; failedCount?: number } = {},
  ): Promise<boolean> {
    const updates: Record<string, unknown> = { status, completedAt: now.toISOString() };
    if (status !== 'FAILED') {
      updates.lastSuccessfulAt = now.toISOString();
    }
    if (extra.failureReason !== undefined) {
      updates.failureReason = extra.failureReason;
    }
    if (extra.failedCount !== undefined) {
      updates.failedCount = extra.failedCount;
    }

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':runId': runId };
    const setClauses: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      names[`#${key}`] = key;
      values[`:${key}`] = value;
      setClauses.push(`#${key} = :${key}`);
    }

    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: PARTITION_KEY, sk: STATE_SORT_KEY },
        UpdateExpression: `SET ${setClauses.join(', ')}`,
        ConditionExpression: 'runId = :runId',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        logger.debug('Sport cache refresh finalize skipped, runId no longer active', { runId });
        return false;
      }
      throw error;
    }
  }
}
