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
 * Durable extra-bewijzen submission record. `originalCaseReference`/`submittedAt`/the CSV-derived fields
 * are absent for a minimal workitem created when the Object envelope was valid but its CSV could not be
 * read: the submission still exists and is visible, just without CSV content until a later refresh heals it.
 */
export interface AdditionalEvidenceWorkItem {
  objectUuid: string;
  submissionReference: string;
  status: AdditionalEvidenceWorkItemStatus;
  originalCaseReference?: string;
  submittedAt?: string;
  submittedProjectName?: string;
  contactEmail?: string;
  contactPhone?: string;
  evidenceDescription?: string;
  remarks?: string;
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
  async createWorkItemIfMissing(workItem: AdditionalEvidenceWorkItem): Promise<boolean> {
    try {
      await this.documentClient.send(new PutCommand({
        TableName: this.tableName,
        Item: { pk: PARTITION_KEY, sk: workItemSortKey(workItem.objectUuid), ...workItem },
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
