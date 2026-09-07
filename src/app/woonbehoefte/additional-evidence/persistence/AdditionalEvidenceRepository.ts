import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const PARTITION_KEY = 'ADDITIONAL_EVIDENCE#WORKITEMS';
const WORKITEM_SORT_KEY_PREFIX = 'WORKITEM#';

function workItemSortKey(objectUuid: string): string {
  return `${WORKITEM_SORT_KEY_PREFIX}${objectUuid}`;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

export type AdditionalEvidenceWorkItemStatus = 'NEW' | 'UNKNOWN' | 'LINKED';

/** Only these two are ever reachable through a manual status change; `LINKED` only ever comes from the link action itself. */
export type AdditionalEvidenceChangeableStatus = 'NEW' | 'UNKNOWN';

export type AdditionalEvidenceStatusChangeResult = 'OK' | 'NOOP' | 'LINKED' | 'NOT_FOUND';

export type AdditionalEvidenceStatusChangeOutcome =
  | { result: 'NOT_FOUND' }
  | { result: 'OK' | 'NOOP' | 'LINKED'; fromStatus: AdditionalEvidenceWorkItemStatus; submissionReference: string };

/**
 * Durable extra-bewijzen identity/status record. Deliberately lean: no CSV-derived content
 * (projectnaam/origineleKenmerk/contactgegevens) lives here. Those come from
 * `AdditionalEvidenceSourceCacheStore`, read fresh on every render, the same case+source separation the
 * primary Woonbehoefte case/source already uses. `createWorkItemIfMissing` is a conditional create only
 * (no `UpdateItem`), so embedding CSV content here would freeze it forever on the very first sync attempt
 * (e.g. a transient CSV fetch failure) with no way to ever heal it on a later successful refresh.
 */
export interface AdditionalEvidenceWorkItem {
  objectUuid: string;
  submissionReference: string;
  status: AdditionalEvidenceWorkItemStatus;
  createdAt: string;
  createdBy: string;
}

/**
 * Owns every read/write on Additional Evidence workitems, stored in the same Cases table as primary
 * cases under one fixed partition (`ADDITIONAL_EVIDENCE#WORKITEMS`), never under a `CASE#<reference>`
 * partition. The sync worker only ever calls `createWorkItemIfMissing` (a conditional `PutItem`, no
 * `UpdateItem`), so it can never overwrite a workitem a medewerker already moved to UNKNOWN/LINKED.
 */
export class AdditionalEvidenceRepository {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  /** Initializes a workitem the first time its Object is seen. Never overwrites an existing one, regardless of its current status. */
  async createWorkItemIfMissing(objectUuid: string, submissionReference: string, createdBy: string, now: Date = new Date()): Promise<boolean> {
    const workItem: AdditionalEvidenceWorkItem = { objectUuid, submissionReference, status: 'NEW', createdAt: now.toISOString(), createdBy };
    try {
      await this.documentClient.send(new PutCommand({
        TableName: this.tableName,
        Item: { pk: PARTITION_KEY, sk: workItemSortKey(objectUuid), ...workItem },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return false;
      }
      throw error;
    }
  }

  async getWorkItem(objectUuid: string): Promise<AdditionalEvidenceWorkItem | undefined> {
    const result = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: PARTITION_KEY, sk: workItemSortKey(objectUuid) },
    }));
    return result.Item as AdditionalEvidenceWorkItem | undefined;
  }

  /**
   * NEW <-> UNKNOWN only. Reads the current status first purely to short-circuit a same-status resave as a
   * no-op and to report `fromStatus` for the audit event; the actual concurrency guard is the write's own
   * `status <> LINKED` condition, so a request that raced against a just-completed link action can never
   * pull a workitem back out of LINKED.
   */
  async changeStatus(objectUuid: string, targetStatus: AdditionalEvidenceChangeableStatus): Promise<AdditionalEvidenceStatusChangeOutcome> {
    const workItem = await this.getWorkItem(objectUuid);
    if (!workItem) {
      return { result: 'NOT_FOUND' };
    }
    if (workItem.status === 'LINKED') {
      return { result: 'LINKED', fromStatus: workItem.status, submissionReference: workItem.submissionReference };
    }
    if (workItem.status === targetStatus) {
      return { result: 'NOOP', fromStatus: workItem.status, submissionReference: workItem.submissionReference };
    }

    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: PARTITION_KEY, sk: workItemSortKey(objectUuid) },
        UpdateExpression: 'SET #status = :targetStatus',
        ConditionExpression: '#status <> :linked',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':targetStatus': targetStatus, ':linked': 'LINKED' },
      }));
      return { result: 'OK', fromStatus: workItem.status, submissionReference: workItem.submissionReference };
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return { result: 'LINKED', fromStatus: workItem.status, submissionReference: workItem.submissionReference };
      }
      throw error;
    }
  }

  /** Every workitem in one Query pass; used by the overview. */
  async listWorkItems(): Promise<AdditionalEvidenceWorkItem[]> {
    const workItems: AdditionalEvidenceWorkItem[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.documentClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :workItemPrefix)',
        ExpressionAttributeValues: { ':pk': PARTITION_KEY, ':workItemPrefix': WORKITEM_SORT_KEY_PREFIX },
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));
      workItems.push(...(response.Items ?? []) as AdditionalEvidenceWorkItem[]);
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return workItems;
  }
}
