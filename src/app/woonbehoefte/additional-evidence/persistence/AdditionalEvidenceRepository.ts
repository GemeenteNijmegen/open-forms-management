import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const PARTITION_KEY = 'ADDITIONAL_EVIDENCE#WORKITEMS';
const WORKITEM_SORT_KEY_PREFIX = 'WORKITEM#';

function workItemSortKey(objectUuid: string): string {
  return `${WORKITEM_SORT_KEY_PREFIX}${objectUuid}`;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

export type AdditionalEvidenceWorkItemStatus = 'NEW' | 'UNKNOWN' | 'LINKED';

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
