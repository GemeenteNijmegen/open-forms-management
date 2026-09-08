import { randomUUID } from 'crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { NOTE_CATEGORY_LABELS } from '../domain/CaseLabels';
import { CaseStatus } from '../domain/CaseStatus';
import {
  CaseActivity, CaseActivityType, CaseAssessment, CaseCheck, CaseNote, CaseNoteCategory, CaseSourceLink, CaseSourceRelation, WoonbehoefteCase,
} from '../domain/WoonbehoefteCase';

/** Exported so `AdditionalEvidenceLinkRepository` can put items into a case's partition in its own cross-partition transaction. */
export function casePartitionKey(caseReference: string): string {
  return `CASE#${caseReference}`;
}

export const CASE_SORT_KEY = 'CASE';

export function sourceLinkSortKey(relation: CaseSourceRelation, objectUuid?: string): string {
  return relation === 'PRIMARY' ? 'SOURCE#PRIMARY' : `SOURCE#ADDITIONAL#${objectUuid}`;
}

export function noteSortKey(createdAt: string, noteId: string): string {
  return `NOTE#${createdAt}#${noteId}`;
}

export function activitySortKey(occurredAt: string, activityId: string): string {
  return `ACTIVITY#${occurredAt}#${activityId}`;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

function isTransactionCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'TransactionCanceledException';
}

export type CreatePrimarySourceLinkResult = 'CREATED' | 'ALREADY_LINKED' | 'CONFLICT';

export interface WoonbehoefteCaseItems {
  woonbehoefteCase?: WoonbehoefteCase;
  sourceLinks: CaseSourceLink[];
  notes: CaseNote[];
  activities: CaseActivity[];
}

export type CaseMutationResult = 'OK' | 'STALE_VERSION';

interface CaseFieldMutation {
  set?: Record<string, unknown>;
  remove?: string[];
}

interface CaseActivityInput {
  type: CaseActivityType;
  summary: string;
  changes?: CaseActivity['changes'];
}

function fieldReference(path: string, names: Record<string, string>): string {
  return path.split('.').map((segment) => {
    names[`#${segment}`] = segment;
    return `#${segment}`;
  }).join('.');
}

/**
 * Claim state guard for `claim`/`release`/`take-over`: enforced as an extra DynamoDB condition on the
 * same transaction as the version check, so a claim/release/takeover can never be posted straight to a
 * case in the wrong claim state, regardless of what the UI offers.
 */
type CaseGuard = 'CLAIM_FREE' | 'OWN_CLAIM' | 'CLAIMED_BY_OTHER';

function guardConditionExpression(guard: CaseGuard, actor: string, names: Record<string, string>, values: Record<string, unknown>): string {
  names['#claimedBy'] = 'claimedBy';
  if (guard === 'CLAIM_FREE') {
    return 'attribute_not_exists(#claimedBy)';
  }
  values[':guardActor'] = actor;
  return guard === 'OWN_CLAIM' ? '#claimedBy = :guardActor' : 'attribute_exists(#claimedBy) AND #claimedBy <> :guardActor';
}

/**
 * Owns every read/write on the Cases table. Both the page Lambda (full access) and the sync worker
 * (conditional-create only, enforced by IAM, see `WoonbehoefteCasesTable.grantWorkerAccess`) share this
 * class; only the methods a caller's IAM role actually allows will succeed at runtime.
 */
export class WoonbehoefteCaseRepository {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  /**
   * Initializes a case the first time its primary submission is seen. Never overwrites an existing case:
   * a refresh must not touch a case a medewerker is already processing.
   */
  async createCaseIfMissing(caseReference: string, createdBy: string, now: Date = new Date()): Promise<boolean> {
    const nowIso = now.toISOString();
    const newCase: WoonbehoefteCase = {
      caseReference,
      status: 'NEW',
      statusChangedAt: nowIso,
      assessment: {},
      check: { requested: false },
      version: 1,
      createdAt: nowIso,
      createdBy,
      updatedAt: nowIso,
      updatedBy: createdBy,
    };

    try {
      await this.documentClient.send(new PutCommand({
        TableName: this.tableName,
        Item: { pk: casePartitionKey(caseReference), sk: CASE_SORT_KEY, ...newCase },
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

  /**
   * Conditionally links a primary submission to its case. If a SOURCE#PRIMARY link already exists for a
   * *different* submissionId, this is a genuine data conflict that is never overwritten; the caller logs
   * it and keeps the case's existing link intact.
   */
  async createPrimarySourceLinkIfMissing(
    caseReference: string, submissionId: string, submissionReference: string, now: Date = new Date(),
  ): Promise<CreatePrimarySourceLinkResult> {
    const link: CaseSourceLink = { caseReference, submissionId, submissionReference, relation: 'PRIMARY', linkedAt: now.toISOString() };

    try {
      await this.documentClient.send(new PutCommand({
        TableName: this.tableName,
        Item: { pk: casePartitionKey(caseReference), sk: sourceLinkSortKey('PRIMARY'), ...link },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return 'CREATED';
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      const existing = await this.documentClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { pk: casePartitionKey(caseReference), sk: sourceLinkSortKey('PRIMARY') },
      }));
      const existingLink = existing.Item as CaseSourceLink | undefined;
      return existingLink?.submissionId === submissionId ? 'ALREADY_LINKED' : 'CONFLICT';
    }
  }

  async getCase(caseReference: string): Promise<WoonbehoefteCase | undefined> {
    const result = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: casePartitionKey(caseReference), sk: CASE_SORT_KEY },
    }));
    return result.Item as WoonbehoefteCase | undefined;
  }

  /**
   * Every item under one case's partition (the case itself, its source links, notes and activities), in
   * one Query, split by `sk` prefix. Used by the detail page, which always needs all of it together.
   */
  async getCaseItems(caseReference: string): Promise<WoonbehoefteCaseItems> {
    const result: WoonbehoefteCaseItems = { sourceLinks: [], notes: [], activities: [] };
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.documentClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': casePartitionKey(caseReference) },
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));

      for (const item of (response.Items ?? [])) {
        const sk = item.sk as string;
        if (sk === CASE_SORT_KEY) {
          result.woonbehoefteCase = item as WoonbehoefteCase;
        } else if (sk.startsWith('SOURCE#')) {
          result.sourceLinks.push(item as CaseSourceLink);
        } else if (sk.startsWith('NOTE#')) {
          result.notes.push(item as CaseNote);
        } else if (sk.startsWith('ACTIVITY#')) {
          result.activities.push(item as CaseActivity);
        }
      }
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return result;
  }

  /**
   * Every case in the table, `SK = CASE` only (never a note/activity/source-link item). A paginated Scan,
   * not a Query: the Cases table has one partition per case, so there is no shared partition to query
   * across. Acceptable for this dataset size and lifespan; no GSI until that changes.
   */
  async listCases(): Promise<WoonbehoefteCase[]> {
    const cases: WoonbehoefteCase[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.documentClient.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'sk = :sk',
        ExpressionAttributeValues: { ':sk': CASE_SORT_KEY },
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));
      cases.push(...(response.Items ?? []) as WoonbehoefteCase[]);
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return cases;
  }

  /**
   * Every main-case mutation goes through here: a conditional `version = :expectedVersion` update plus an
   * immutable ACTIVITY item, in one `TransactWriteCommand`. A stale form (the case changed since the
   * medewerker loaded the page, by anyone, for any reason) fails the whole transaction and neither write
   * happens. An optional claim-state `guard` extends the same condition, and an optional `noteToAdd` puts
   * an immutable note in the same transaction so a note can never survive a mutation that itself failed.
   */
  private async mutateCase(
    caseReference: string, expectedVersion: number, mutation: CaseFieldMutation, activityInput: CaseActivityInput, actor: string, now: Date,
    extra?: { guard?: CaseGuard; noteToAdd?: CaseNote },
  ): Promise<CaseMutationResult> {
    const nowIso = now.toISOString();
    const names: Record<string, string> = { '#version': 'version', '#updatedAt': 'updatedAt', '#updatedBy': 'updatedBy' };
    const values: Record<string, unknown> = {
      ':expectedVersion': expectedVersion, ':newVersion': expectedVersion + 1, ':updatedAt': nowIso, ':updatedBy': actor,
    };
    const setClauses = ['#version = :newVersion', '#updatedAt = :updatedAt', '#updatedBy = :updatedBy'];

    Object.entries(mutation.set ?? {}).forEach(([path, value], index) => {
      const valueKey = `:s${index}`;
      values[valueKey] = value;
      setClauses.push(`${fieldReference(path, names)} = ${valueKey}`);
    });
    const removeClauses = (mutation.remove ?? []).map((path) => fieldReference(path, names));

    const conditionExpression = extra?.guard
      ? `#version = :expectedVersion AND (${guardConditionExpression(extra.guard, actor, names, values)})`
      : '#version = :expectedVersion';

    const activityId = randomUUID();
    const activity: CaseActivity = {
      activityId,
      caseReference,
      actor,
      occurredAt: nowIso,
      type: activityInput.type,
      summary: activityInput.summary,
      ...(activityInput.changes ? { changes: activityInput.changes } : {}),
    };

    try {
      await this.documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk: casePartitionKey(caseReference), sk: CASE_SORT_KEY },
              UpdateExpression: `SET ${setClauses.join(', ')}${removeClauses.length ? ` REMOVE ${removeClauses.join(', ')}` : ''}`,
              ConditionExpression: conditionExpression,
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { pk: casePartitionKey(caseReference), sk: activitySortKey(nowIso, activityId), ...activity },
            },
          },
          ...(extra?.noteToAdd
            ? [{
              Put: {
                TableName: this.tableName,
                Item: { pk: casePartitionKey(caseReference), sk: noteSortKey(extra.noteToAdd.createdAt, extra.noteToAdd.noteId), ...extra.noteToAdd },
              },
            }]
            : []),
        ],
      }));
      return 'OK';
    } catch (error) {
      if (isTransactionCancelled(error)) {
        return 'STALE_VERSION';
      }
      throw error;
    }
  }

  /** First claim on a NEW case also moves it to IN_PROGRESS; pass the case's current status so the caller doesn't need a second round trip. */
  async claim(
    caseReference: string, actorEmail: string, expectedVersion: number, currentStatus: CaseStatus, now: Date = new Date(),
  ): Promise<CaseMutationResult> {
    const nowIso = now.toISOString();
    return this.mutateCase(
      caseReference, expectedVersion,
      {
        set: {
          claimedBy: actorEmail,
          claimedAt: nowIso,
          ...(currentStatus === 'NEW' ? { status: 'IN_PROGRESS', statusChangedAt: nowIso } : {}),
        },
      },
      { type: 'CASE_CLAIMED', summary: `Zaak opgepakt door ${actorEmail}` },
      actorEmail, now,
      { guard: 'CLAIM_FREE' },
    );
  }

  async release(caseReference: string, actorEmail: string, expectedVersion: number, now: Date = new Date()): Promise<CaseMutationResult> {
    return this.mutateCase(
      caseReference, expectedVersion,
      { remove: ['claimedBy', 'claimedAt'] },
      { type: 'CASE_RELEASED', summary: `Claim vrijgegeven door ${actorEmail}` },
      actorEmail, now,
      { guard: 'OWN_CLAIM' },
    );
  }

  async takeOver(
    caseReference: string, actorEmail: string, expectedVersion: number, previousAssignee: string | undefined, now: Date = new Date(),
  ): Promise<CaseMutationResult> {
    return this.mutateCase(
      caseReference, expectedVersion,
      { set: { claimedBy: actorEmail, claimedAt: now.toISOString() } },
      {
        type: 'CASE_TAKEN_OVER',
        summary: `Behandeling overgenomen door ${actorEmail}`,
        changes: [{ field: 'claimedBy', from: previousAssignee, to: actorEmail }],
      },
      actorEmail, now,
      { guard: 'CLAIMED_BY_OTHER' },
    );
  }

  /** Backend only validates the target is a known status; no transition matrix. `INADMISSIBLE` has its own dedicated method. */
  async changeStatus(
    caseReference: string, actorEmail: string, expectedVersion: number, fromStatus: CaseStatus, toStatus: CaseStatus, now: Date = new Date(),
  ): Promise<CaseMutationResult> {
    return this.mutateCase(
      caseReference, expectedVersion,
      { set: { status: toStatus, statusChangedAt: now.toISOString() } },
      { type: 'STATUS_CHANGED', summary: 'Status gewijzigd', changes: [{ field: 'status', from: fromStatus, to: toStatus }] },
      actorEmail, now,
    );
  }

  /**
   * First, non-exclusive step of the two-step inadmissibility flow: also opens a check, so collega's
   * can find it. The motivering is mandatory and stored as an immutable `ADMISSIBILITY` note in the same
   * transaction as the status change, so it can never end up saved without the status actually changing.
   */
  async proposeInadmissible(
    caseReference: string, actorEmail: string, expectedVersion: number, fromStatus: CaseStatus, motivering: string, now: Date = new Date(),
  ): Promise<CaseMutationResult> {
    const nowIso = now.toISOString();
    const noteToAdd: CaseNote = {
      noteId: randomUUID(), caseReference, category: 'ADMISSIBILITY', text: motivering, createdAt: nowIso, createdBy: actorEmail,
    };
    return this.mutateCase(
      caseReference, expectedVersion,
      {
        set: {
          'status': 'PROPOSED_INADMISSIBLE',
          'statusChangedAt': nowIso,
          'check.requested': true,
          'check.requestedAt': nowIso,
          'check.requestedBy': actorEmail,
        },
      },
      {
        type: 'STATUS_CHANGED',
        summary: 'Status gewijzigd naar voorgesteld niet-ontvankelijk',
        changes: [{ field: 'status', from: fromStatus, to: 'PROPOSED_INADMISSIBLE' }],
      },
      actorEmail, now,
      { noteToAdd },
    );
  }

  /**
   * Second, explicit step of the two-step inadmissibility flow: only succeeds from PROPOSED_INADMISSIBLE
   * (checked by the caller via expectedVersion + status guard upstream). Closes an open check without
   * pretending it was actually completed with an outcome.
   */
  async confirmInadmissible(
    caseReference: string, actorEmail: string, expectedVersion: number, checkRequested: boolean, now: Date = new Date(),
  ): Promise<CaseMutationResult> {
    return this.mutateCase(
      caseReference, expectedVersion,
      { set: { status: 'INADMISSIBLE', statusChangedAt: now.toISOString(), ...(checkRequested ? { 'check.requested': false } : {}) } },
      {
        type: 'STATUS_CHANGED',
        summary: 'Niet-ontvankelijk bevestigd',
        changes: [{ field: 'status', from: 'PROPOSED_INADMISSIBLE', to: 'INADMISSIBLE' }],
      },
      actorEmail, now,
    );
  }

  /**
   * `set`/`remove` are disjoint sets of `CaseAssessment` keys: `set` only contains fields that actually
   * changed to a new value, `remove` only fields explicitly cleared back to "nog niet vastgesteld"/"nog
   * niet beoordeeld". Never both for the same field.
   */
  async updateAssessment(
    caseReference: string, actorEmail: string, expectedVersion: number,
    updates: { set: Partial<CaseAssessment>; remove: (keyof CaseAssessment)[] },
    changes: CaseActivity['changes'], now: Date = new Date(),
  ): Promise<CaseMutationResult> {
    const set = Object.fromEntries(Object.entries(updates.set).map(([field, value]) => [`assessment.${field}`, value]));
    const remove = updates.remove.map((field) => `assessment.${field}`);
    return this.mutateCase(
      caseReference, expectedVersion, { set, remove },
      { type: 'ASSESSMENT_UPDATED', summary: 'Beoordeling bijgewerkt', ...(changes ? { changes } : {}) },
      actorEmail, now,
    );
  }

  /**
   * `noteText` is written in the same transaction as the check mutation, so a check request can never
   * leave behind a note without also opening the check (and vice versa).
   */
  async requestCheck(
    caseReference: string, actorEmail: string, expectedVersion: number, noteText: string | undefined, now: Date = new Date(),
  ): Promise<CaseMutationResult> {
    const nowIso = now.toISOString();
    const set: Record<string, unknown> = { 'check.requested': true, 'check.requestedAt': nowIso, 'check.requestedBy': actorEmail };
    const remove: string[] = [];
    const noteToAdd = noteText
      ? { noteId: randomUUID(), caseReference, category: 'CHECK' as const, text: noteText, createdAt: nowIso, createdBy: actorEmail }
      : undefined;
    if (noteToAdd) {
      set['check.requestNoteId'] = noteToAdd.noteId;
    } else {
      // A request without a toelichting never leaves a stale requestNoteId from an earlier check cycle pointing at it.
      remove.push('check.requestNoteId');
    }
    return this.mutateCase(
      caseReference, expectedVersion, { set, remove }, { type: 'CHECK_REQUESTED', summary: `Check gevraagd door ${actorEmail}` }, actorEmail, now,
      { noteToAdd },
    );
  }

  async completeCheck(
    caseReference: string, actorEmail: string, expectedVersion: number, outcome: CaseCheck['lastOutcome'], noteText: string | undefined,
    now: Date = new Date(),
  ): Promise<CaseMutationResult> {
    const nowIso = now.toISOString();
    const set = {
      'check.requested': false, 'check.lastCheckedAt': nowIso, 'check.lastCheckedBy': actorEmail, 'check.lastOutcome': outcome,
    };
    const noteToAdd = noteText
      ? { noteId: randomUUID(), caseReference, category: 'CHECK' as const, text: noteText, createdAt: nowIso, createdBy: actorEmail }
      : undefined;
    return this.mutateCase(
      caseReference, expectedVersion, { set },
      { type: 'CHECK_COMPLETED', summary: `Check afgerond door ${actorEmail}`, changes: [{ field: 'check.lastOutcome', to: outcome }] },
      actorEmail, now,
      { noteToAdd },
    );
  }

  /**
   * Immutable: Put-only, no update/delete path exists. Not part of `mutateCase`: a note has no `version`
   * field of its own to guard.
   */
  async addNote(caseReference: string, actorEmail: string, category: CaseNoteCategory, text: string, now: Date = new Date()): Promise<CaseNote> {
    const noteId = randomUUID();
    const nowIso = now.toISOString();
    const note: CaseNote = { noteId, caseReference, category, text, createdAt: nowIso, createdBy: actorEmail };
    const activity: CaseActivity = {
      activityId: randomUUID(),
      caseReference,
      actor: actorEmail,
      occurredAt: nowIso,
      type: 'NOTE_ADDED',
      summary: `Interne aantekening toegevoegd (${NOTE_CATEGORY_LABELS[category]})`,
    };

    await this.documentClient.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: this.tableName, Item: { pk: casePartitionKey(caseReference), sk: noteSortKey(nowIso, noteId), ...note } } },
        {
          Put: {
            TableName: this.tableName, Item: { pk: casePartitionKey(caseReference), sk: activitySortKey(nowIso, activity.activityId), ...activity },
          },
        },
      ],
    }));

    return note;
  }
}
