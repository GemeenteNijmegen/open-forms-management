import { randomUUID } from 'crypto';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { activitySortKey, casePartitionKey, CASE_SORT_KEY, noteSortKey, sourceLinkSortKey } from '../../cases/WoonbehoefteCaseRepository';
import { CaseActivity, CaseNote, CaseSourceLink } from '../../domain/WoonbehoefteCase';
import { ADDITIONAL_EVIDENCE_WORKITEM_PARTITION_KEY, workItemSortKey } from '../persistence/AdditionalEvidenceRepository';

export type AdditionalEvidenceLinkResult = 'OK' | 'CONFLICT';

function isTransactionCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'TransactionCanceledException';
}

/**
 * Owns the one atomic mutation for koppelen. A `TransactWriteCommand` spans two partitions in the same
 * Cases table: the target case's own partition (new `SOURCE#ADDITIONAL` link, note, activity) and the
 * workitem's fixed partition (its `LINKED` state). Either all of it commits or none of it does.
 *
 * The workitem's own `status <> LINKED` condition is the only concurrency guard needed: a second, racing
 * link attempt for the same workitem can only ever see that condition fail, regardless of which target
 * case it was aimed at, so the same submission can never end up linked to two different cases.
 */
export class AdditionalEvidenceLinkRepository {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  async link(
    objectUuid: string, submissionReference: string, caseReference: string, noteText: string, actorEmail: string, now: Date = new Date(),
  ): Promise<AdditionalEvidenceLinkResult> {
    const nowIso = now.toISOString();
    const noteId = randomUUID();
    const activityId = randomUUID();

    const sourceLink: CaseSourceLink = {
      caseReference, submissionId: objectUuid, submissionReference, relation: 'ADDITIONAL', linkedAt: nowIso, linkedBy: actorEmail,
    };
    const note: CaseNote = {
      noteId, caseReference, category: 'ADDITIONAL_INFORMATION', text: noteText, createdAt: nowIso, createdBy: actorEmail,
    };
    const activity: CaseActivity = {
      activityId,
      caseReference,
      type: 'ADDITIONAL_EVIDENCE_LINKED',
      actor: actorEmail,
      occurredAt: nowIso,
      summary: `Extra bewijzen ${submissionReference} gekoppeld`,
    };

    try {
      await this.documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: this.tableName,
              Key: { pk: casePartitionKey(caseReference), sk: CASE_SORT_KEY },
              ConditionExpression: 'attribute_exists(pk)',
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: { pk: ADDITIONAL_EVIDENCE_WORKITEM_PARTITION_KEY, sk: workItemSortKey(objectUuid) },
              UpdateExpression: 'SET #status = :linked, linkedCaseReference = :caseReference, linkedAt = :linkedAt, linkedBy = :actorEmail',
              ConditionExpression: 'attribute_exists(pk) AND #status <> :linked',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: { ':linked': 'LINKED', ':caseReference': caseReference, ':linkedAt': nowIso, ':actorEmail': actorEmail },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { pk: casePartitionKey(caseReference), sk: sourceLinkSortKey('ADDITIONAL', objectUuid), ...sourceLink },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { pk: casePartitionKey(caseReference), sk: noteSortKey(nowIso, noteId), ...note },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { pk: casePartitionKey(caseReference), sk: activitySortKey(nowIso, activityId), ...activity },
            },
          },
        ],
      }));
      return 'OK';
    } catch (error) {
      if (isTransactionCancelled(error)) {
        return 'CONFLICT';
      }
      throw error;
    }
  }
}
