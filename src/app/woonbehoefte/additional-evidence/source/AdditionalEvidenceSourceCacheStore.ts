import { DynamoDBDocumentClient, BatchGetCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  ADDITIONAL_EVIDENCE_REFRESH_STALE_AFTER_MS, AdditionalEvidenceRefreshState, AdditionalEvidenceRefreshStatus,
} from './AdditionalEvidenceRefreshState';
import { logger } from '../../../../observability/Logger';
import {
  ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceFailure, AdditionalEvidenceSourceItem, AdditionalEvidenceSourceRecord,
  isFailedAdditionalEvidenceSource, isReadyAdditionalEvidenceSource,
} from '../domain/AdditionalEvidenceSource';

const PARTITION_KEY = 'ADDITIONAL_EVIDENCE#SUBMISSIONS';
const STATE_SORT_KEY = 'STATE';
const SUBMISSION_SORT_KEY_PREFIX = 'SUBMISSION#';
const BATCH_GET_CHUNK_SIZE = 100;

function submissionSortKey(objectUuid: string): string {
  return `${SUBMISSION_SORT_KEY_PREFIX}${objectUuid}`;
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
 * Additional Evidence's own partition (`ADDITIONAL_EVIDENCE#SUBMISSIONS`) in the shared Woonbehoefte
 * source-cache table: same table as the primary cache, own partition key, own singleton refresh state.
 * The primary `WOONBEHOEFTE#SUBMISSIONS` partition and its `WoonbehoefteSourceCacheStore` class are never
 * read or written from here.
 */
export class AdditionalEvidenceSourceCacheStore {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  /** An objectUuid missing from the result map has never been cached. */
  async getItems(objectUuids: string[]): Promise<Map<string, AdditionalEvidenceSourceItem>> {
    const result = new Map<string, AdditionalEvidenceSourceItem>();
    for (const batch of chunk(objectUuids, BATCH_GET_CHUNK_SIZE)) {
      if (batch.length === 0) {
        continue;
      }
      const response = await this.documentClient.send(new BatchGetCommand({
        RequestItems: {
          [this.tableName]: { Keys: batch.map((objectUuid) => ({ pk: PARTITION_KEY, sk: submissionSortKey(objectUuid) })) },
        },
      }));
      for (const item of (response.Responses?.[this.tableName] ?? [])) {
        const cacheItem = item as AdditionalEvidenceSourceItem;
        result.set(cacheItem.objectUuid, cacheItem);
      }
    }
    return result;
  }

  /** Idempotent: a duplicate worker delivery for the same objectUuid safely overwrites the same READY item. */
  async putReady(record: AdditionalEvidenceSourceRecord): Promise<void> {
    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: PARTITION_KEY, sk: submissionSortKey(record.objectUuid), ...record },
    }));
  }

  async putFailed(marker: AdditionalEvidenceSourceFailure): Promise<void> {
    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: PARTITION_KEY, sk: submissionSortKey(marker.objectUuid), ...marker },
    }));
  }

  /** Every submission item in one Query pass, split into READY records on the current cache version and FAILED markers. */
  async readReadySubmissions(): Promise<{ submissions: AdditionalEvidenceSourceRecord[]; failedMarkers: AdditionalEvidenceSourceFailure[] }> {
    const submissions: AdditionalEvidenceSourceRecord[] = [];
    const failedMarkers: AdditionalEvidenceSourceFailure[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.documentClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :submissionPrefix)',
        ExpressionAttributeValues: { ':pk': PARTITION_KEY, ':submissionPrefix': SUBMISSION_SORT_KEY_PREFIX },
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));

      for (const rawItem of (response.Items ?? [])) {
        const item = rawItem as AdditionalEvidenceSourceItem;
        if (isReadyAdditionalEvidenceSource(item) && item.cacheVersion === ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION) {
          submissions.push(item);
        } else if (isFailedAdditionalEvidenceSource(item)) {
          failedMarkers.push(item);
        }
      }
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return { submissions, failedMarkers };
  }

  async getState(): Promise<AdditionalEvidenceRefreshState | undefined> {
    const result = await this.documentClient.send(new GetCommand({ TableName: this.tableName, Key: { pk: PARTITION_KEY, sk: STATE_SORT_KEY } }));
    return result.Item as AdditionalEvidenceRefreshState | undefined;
  }

  /**
   * Claims the refresh for `runId`: succeeds when there's no state yet, the previous refresh already
   * reached a final status, or the previous REFRESHING claim is stale. Loses the race, without error,
   * when another request just started a fresh REFRESHING run.
   */
  async claimRefresh(runId: string, now: Date = new Date()): Promise<boolean> {
    const staleThreshold = new Date(now.getTime() - ADDITIONAL_EVIDENCE_REFRESH_STALE_AFTER_MS).toISOString();
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
        logger.debug('Additional Evidence source refresh claim lost, a refresh is already active', { runId });
        return false;
      }
      throw error;
    }
  }

  /** Only finalizes the state if `runId` is still the active run; a superseded/reclaimed run is silently skipped. */
  async finalizeRefresh(
    runId: string,
    status: Exclude<AdditionalEvidenceRefreshStatus, 'REFRESHING'>,
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
        logger.debug('Additional Evidence source refresh finalize skipped, runId no longer active', { runId });
        return false;
      }
      throw error;
    }
  }
}
