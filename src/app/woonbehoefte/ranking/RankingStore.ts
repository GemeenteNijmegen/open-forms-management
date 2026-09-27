import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { insertIntoOrder, moveWithinOrder, RANKING_PARTITION_KEY, RANKING_SORT_KEY, RankingList, removeFromOrder } from './domain/Ranking';

export type RankingMutationResult = 'OK' | 'STALE_REVISION' | 'NOT_INITIALIZED';
export type RankingInitializeResult = 'OK' | 'ALREADY_INITIALIZED';

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((reference, index) => reference === b[index]);
}

/**
 * Owns the single RANKING/CURRENT item in the shared WoonbehoefteCasesTable. No transaction and no
 * separate history item: the whole order is one item, so a conditional write on that one item is already
 * atomic. The revision field is only a stale-write guard, never a historical ranking version.
 */
export class RankingStore {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  async getCurrentList(): Promise<RankingList | undefined> {
    const result = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: RANKING_PARTITION_KEY, sk: RANKING_SORT_KEY },
    }));
    return result.Item as RankingList | undefined;
  }

  // One-time initialization (import): conditioned on the item not existing yet, never overwrites.
  async initialize(orderedCaseReferences: string[], actor: string, now: Date = new Date()): Promise<RankingInitializeResult> {
    const nowIso = now.toISOString();
    try {
      await this.documentClient.send(new PutCommand({
        TableName: this.tableName,
        Item: { pk: RANKING_PARTITION_KEY, sk: RANKING_SORT_KEY, orderedCaseReferences, revision: 1, updatedAt: nowIso, updatedBy: actor },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return 'OK';
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return 'ALREADY_INITIALIZED';
      }
      throw error;
    }
  }

  async insert(
    caseReference: string, position: number, actor: string, expectedRevision: number, now: Date = new Date(),
  ): Promise<RankingMutationResult> {
    return this.mutate(expectedRevision, (current) => insertIntoOrder(current, caseReference, position), actor, now);
  }

  async move(
    caseReference: string, position: number, actor: string, expectedRevision: number, now: Date = new Date(),
  ): Promise<RankingMutationResult> {
    return this.mutate(expectedRevision, (current) => moveWithinOrder(current, caseReference, position), actor, now);
  }

  async remove(caseReference: string, actor: string, expectedRevision: number, now: Date = new Date()): Promise<RankingMutationResult> {
    return this.mutate(expectedRevision, (current) => removeFromOrder(current, caseReference), actor, now);
  }

  /**
   * Reads the current list, applies computeNext and writes it back conditioned on expectedRevision, so a
   * form submitted against a since-changed list never silently overwrites the newer change. A no-op
   * result (e.g. moving to the position a case is already at) leaves the list and revision untouched.
   */
  private async mutate(
    expectedRevision: number, computeNext: (current: string[]) => string[], actor: string, now: Date,
  ): Promise<RankingMutationResult> {
    const current = await this.getCurrentList();
    if (!current) {
      return 'NOT_INITIALIZED';
    }
    if (current.revision !== expectedRevision) {
      return 'STALE_REVISION';
    }

    const next = computeNext(current.orderedCaseReferences);
    if (sameOrder(next, current.orderedCaseReferences)) {
      return 'OK';
    }

    const nowIso = now.toISOString();
    try {
      await this.documentClient.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: RANKING_PARTITION_KEY,
          sk: RANKING_SORT_KEY,
          orderedCaseReferences: next,
          revision: expectedRevision + 1,
          updatedAt: nowIso,
          updatedBy: actor,
        },
        ConditionExpression: '#revision = :expectedRevision',
        ExpressionAttributeNames: { '#revision': 'revision' },
        ExpressionAttributeValues: { ':expectedRevision': expectedRevision },
      }));
      return 'OK';
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return 'STALE_REVISION';
      }
      throw error;
    }
  }
}
