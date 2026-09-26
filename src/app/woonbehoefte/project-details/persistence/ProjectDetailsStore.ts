import { randomUUID } from 'crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  FacilityLine, HousingLine, KovaLine, ProjectDetailsAttempt, ProjectDetailsAttemptStatus, ProjectDetailsBatchState, ProjectDetailsHistoryAction,
  ProjectDetailsLineCategory, ProjectDetailsWorkVersion,
} from '../domain/ProjectDetails';
import { ProjectLocationIssueCode, ProjectPolygon } from '../location/ProjectLocation';

function partitionKey(caseReference: string): string {
  return `CASE#${caseReference}`;
}

const WORK_VERSION_SORT_KEY = 'WORKVERSION';
const ATTEMPT_SORT_KEY = 'ATTEMPT';
const BATCH_PARTITION_KEY = 'PROJECTDETAILSBATCH';
const BATCH_STATE_SORT_KEY = 'STATE';

function historySortKey(occurredAt: string, historyId: string): string {
  return `HISTORY#${occurredAt}#${historyId}`;
}

const LINE_CATEGORY_ATTRIBUTES: Record<ProjectDetailsLineCategory, string> = {
  WONEN: 'housingLines',
  VOORZIENING: 'collectiveFacilityLines',
  KOVA: 'kovaLines',
};

/**
 * TransactionCanceledException can mean our own condition failed, but also a throughput error or a
 * conflict on the other item (the history write) in the same transaction. Only the cancellation reason
 * at itemIndex tells us it was really our condition; anything else should still bubble up as an error.
 */
function isConditionFailureAt(error: unknown, itemIndex: number): boolean {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') {
    return false;
  }
  const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
  return reasons?.[itemIndex]?.Code === 'ConditionalCheckFailed';
}

export type CreateWorkVersionResult = 'CREATED' | 'SKIPPED';
export type LineMutationResult = 'OK' | 'NOT_FOUND';

export interface NewWorkVersionInput {
  readableProjectName: string;
  projectDescription: string;
  additionalInformation: string;
  projectWideNotes: string;
  housingLines: Record<string, HousingLine>;
  collectiveFacilityLines: Record<string, FacilityLine>;
  kovaLines: Record<string, KovaLine>;
  sourceLocationPolygon?: ProjectPolygon;
  sourceLocationIssue?: ProjectLocationIssueCode;
}

/**
 * Alle reads en writes op de projectdetails-tabel lopen hier doorheen. Regelgroepen (wonen, voorzieningen,
 * KOVA) staan als Map op de werkversie, niet als array: een mutatie op één regel is dus een gerichte
 * SET/REMOVE op die ene entry, geen read-modify-write van de hele lijst.
 */
export class ProjectDetailsStore {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  async getWorkVersion(caseReference: string): Promise<ProjectDetailsWorkVersion | undefined> {
    const result = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: partitionKey(caseReference), sk: WORK_VERSION_SORT_KEY },
    }));
    return result.Item as ProjectDetailsWorkVersion | undefined;
  }

  async getAttempt(caseReference: string): Promise<ProjectDetailsAttempt | undefined> {
    const result = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: partitionKey(caseReference), sk: ATTEMPT_SORT_KEY },
    }));
    return result.Item as ProjectDetailsAttempt | undefined;
  }

  async getBatchState(): Promise<ProjectDetailsBatchState | undefined> {
    const result = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: BATCH_PARTITION_KEY, sk: BATCH_STATE_SORT_KEY },
    }));
    return result.Item as ProjectDetailsBatchState | undefined;
  }

  /** Ongeconditioneerd: er is bewust geen claim/lock op de batch zelf, dus dit item beschrijft altijd alleen de laatste run. */
  async recordBatchState(state: ProjectDetailsBatchState): Promise<void> {
    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: BATCH_PARTITION_KEY, sk: BATCH_STATE_SORT_KEY, ...state },
    }));
  }

  /**
   * Nooit een bestaande werkversie overschrijven: een batch- of detail-retry na een eerdere succesvolle
   * (of handmatig aangepaste) werkversie mag hier niets aan veranderen.
   */
  async createWorkVersionIfMissing(
    caseReference: string, input: NewWorkVersionInput, actor: string, now: Date = new Date(),
  ): Promise<CreateWorkVersionResult> {
    return this.putWorkVersionIfMissing(caseReference, input, actor, 'INITIALIZED', now);
  }

  /** Voor een dossier met een blijvend kapotte bron: dezelfde conditionele creatie, maar met lege velden en een eigen history-actie. */
  async startEmptyWorkVersion(caseReference: string, actor: string, now: Date = new Date()): Promise<CreateWorkVersionResult> {
    const emptyInput: NewWorkVersionInput = {
      readableProjectName: '',
      projectDescription: '',
      additionalInformation: '',
      projectWideNotes: '',
      housingLines: {},
      collectiveFacilityLines: {},
      kovaLines: {},
    };
    return this.putWorkVersionIfMissing(caseReference, emptyInput, actor, 'MANUALLY_STARTED', now);
  }

  private async putWorkVersionIfMissing(
    caseReference: string, input: NewWorkVersionInput, actor: string, action: ProjectDetailsHistoryAction, now: Date,
  ): Promise<CreateWorkVersionResult> {
    const nowIso = now.toISOString();
    const workVersion: ProjectDetailsWorkVersion = {
      caseReference,
      ...input,
      createdAt: nowIso,
      createdBy: actor,
      updatedAt: nowIso,
      updatedBy: actor,
    };
    const historyEntry = { historyId: randomUUID(), caseReference, actor, occurredAt: nowIso, action };

    try {
      await this.documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: { pk: partitionKey(caseReference), sk: WORK_VERSION_SORT_KEY, ...workVersion },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { pk: partitionKey(caseReference), sk: historySortKey(nowIso, historyEntry.historyId), ...historyEntry },
            },
          },
        ],
      }));
      return 'CREATED';
    } catch (error) {
      if (isConditionFailureAt(error, 0)) {
        return 'SKIPPED';
      }
      throw error;
    }
  }

  /**
   * Overschrijft ongeconditioneerd: de pogingstatus is operationele bookkeeping, geen medewerkerinvoer,
   * en een werkversie heeft er sowieso altijd voorrang op (zie `deriveProjectDetailsStatus`).
   */
  async setAttempt(
    caseReference: string, status: ProjectDetailsAttemptStatus, failureReasonCode: string | undefined, now: Date = new Date(),
  ): Promise<void> {
    const attempt: ProjectDetailsAttempt = {
      caseReference, status, attemptedAt: now.toISOString(), ...(failureReasonCode ? { failureReasonCode } : {}),
    };
    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: partitionKey(caseReference), sk: ATTEMPT_SORT_KEY, ...attempt },
    }));
  }

  /** Schrijft alleen als er al een werkversie is; een POST tegen een NEW/PENDING/FAILED dossier raakt niets. */
  async updateProject(
    caseReference: string, readableProjectName: string, projectDescription: string, actor: string, now: Date = new Date(),
  ): Promise<LineMutationResult> {
    return this.updateWorkVersionFields(
      caseReference, { readableProjectName, projectDescription }, 'PROJECT_UPDATED', actor, now,
    );
  }

  /** additionalInformation en mijnAansluitingKenmerk komen uit hetzelfde formulier en worden dus in één transactie samen bijgewerkt. */
  async updateAdditionalInformation(
    caseReference: string, additionalInformation: string, mijnAansluitingKenmerk: string, actor: string, now: Date = new Date(),
  ): Promise<LineMutationResult> {
    return this.updateWorkVersionFields(caseReference, { additionalInformation, mijnAansluitingKenmerk }, 'ADDITIONAL_INFO_UPDATED', actor, now);
  }

  async updateProjectWideNotes(caseReference: string, projectWideNotes: string, actor: string, now: Date = new Date()): Promise<LineMutationResult> {
    return this.updateWorkVersionFields(caseReference, { projectWideNotes }, 'PROJECT_WIDE_NOTES_UPDATED', actor, now);
  }

  /**
   * isNew bepaalt de action (LOCATION_ADDED vs LOCATION_REPLACED) op basis van of er al een handmatige
   * polygon stond, niet van of er een bronpolygon was: die laatste blijft in sourceLocationPolygon staan
   * en wordt door deze write niet aangeraakt.
   */
  async setManualLocation(
    caseReference: string, polygon: ProjectPolygon, isNew: boolean, actor: string, now: Date = new Date(),
  ): Promise<LineMutationResult> {
    const nowIso = now.toISOString();
    const names: Record<string, string> = {
      '#manualLocationPolygon': 'manualLocationPolygon',
      '#manualLocationSetAt': 'manualLocationSetAt',
      '#manualLocationSetBy': 'manualLocationSetBy',
      '#updatedAt': 'updatedAt',
      '#updatedBy': 'updatedBy',
    };
    const values: Record<string, unknown> = {
      ':manualLocationPolygon': polygon, ':manualLocationSetAt': nowIso, ':manualLocationSetBy': actor, ':updatedAt': nowIso, ':updatedBy': actor,
    };
    const setExpressionBody = '#manualLocationPolygon = :manualLocationPolygon, #manualLocationSetAt = :manualLocationSetAt, '
      + '#manualLocationSetBy = :manualLocationSetBy, #updatedAt = :updatedAt, #updatedBy = :updatedBy';
    const action: ProjectDetailsHistoryAction = isNew ? 'LOCATION_ADDED' : 'LOCATION_REPLACED';
    const historyEntry = { historyId: randomUUID(), caseReference, actor, occurredAt: nowIso, action };

    return this.transactUpdateWorkVersion(caseReference, setExpressionBody, names, values, 'attribute_exists(pk)', historyEntry);
  }

  private async updateWorkVersionFields(
    caseReference: string, fields: Record<string, string>, action: ProjectDetailsHistoryAction, actor: string, now: Date,
  ): Promise<LineMutationResult> {
    const nowIso = now.toISOString();
    const names: Record<string, string> = { '#updatedAt': 'updatedAt', '#updatedBy': 'updatedBy' };
    const values: Record<string, unknown> = { ':updatedAt': nowIso, ':updatedBy': actor };
    const setClauses = ['#updatedAt = :updatedAt', '#updatedBy = :updatedBy'];
    Object.entries(fields).forEach(([field, value], index) => {
      names[`#f${index}`] = field;
      values[`:f${index}`] = value;
      setClauses.push(`#f${index} = :f${index}`);
    });
    const historyEntry = { historyId: randomUUID(), caseReference, actor, occurredAt: nowIso, action };

    return this.transactUpdateWorkVersion(caseReference, setClauses.join(', '), names, values, 'attribute_exists(pk)', historyEntry);
  }

  /** isNew bepaalt de conditie: een nieuwe regel mag de lineId nog niet gebruiken, een bewerking moet 'm juist al vinden. */
  async upsertLine(
    caseReference: string, category: ProjectDetailsLineCategory, line: HousingLine | FacilityLine | KovaLine, isNew: boolean,
    actor: string, now: Date = new Date(),
  ): Promise<LineMutationResult> {
    const nowIso = now.toISOString();
    const attribute = LINE_CATEGORY_ATTRIBUTES[category];
    const names: Record<string, string> = { '#category': attribute, '#lineId': line.lineId, '#updatedAt': 'updatedAt', '#updatedBy': 'updatedBy' };
    const values: Record<string, unknown> = { ':line': line, ':updatedAt': nowIso, ':updatedBy': actor };
    const setExpressionBody = '#category.#lineId = :line, #updatedAt = :updatedAt, #updatedBy = :updatedBy';
    const condition = isNew ? 'attribute_exists(pk) AND attribute_not_exists(#category.#lineId)' : 'attribute_exists(#category.#lineId)';
    const historyEntry = {
      historyId: randomUUID(),
      caseReference,
      actor,
      occurredAt: nowIso,
      action: (isNew ? 'LINE_CREATED' : 'LINE_UPDATED') as ProjectDetailsHistoryAction,
      category,
      lineId: line.lineId,
    };

    return this.transactUpdateWorkVersion(caseReference, setExpressionBody, names, values, condition, historyEntry);
  }

  async deleteLine(
    caseReference: string, category: ProjectDetailsLineCategory, lineId: string, actor: string, now: Date = new Date(),
  ): Promise<LineMutationResult> {
    const nowIso = now.toISOString();
    const attribute = LINE_CATEGORY_ATTRIBUTES[category];
    const names: Record<string, string> = { '#category': attribute, '#lineId': lineId, '#updatedAt': 'updatedAt', '#updatedBy': 'updatedBy' };
    const values: Record<string, unknown> = { ':updatedAt': nowIso, ':updatedBy': actor };
    const historyEntry = {
      historyId: randomUUID(), caseReference, actor, occurredAt: nowIso, action: 'LINE_DELETED' as ProjectDetailsHistoryAction, category, lineId,
    };

    try {
      await this.documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk: partitionKey(caseReference), sk: WORK_VERSION_SORT_KEY },
              UpdateExpression: 'REMOVE #category.#lineId SET #updatedAt = :updatedAt, #updatedBy = :updatedBy',
              ConditionExpression: 'attribute_exists(#category.#lineId)',
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { pk: partitionKey(caseReference), sk: historySortKey(nowIso, historyEntry.historyId), ...historyEntry },
            },
          },
        ],
      }));
      return 'OK';
    } catch (error) {
      if (isConditionFailureAt(error, 0)) {
        return 'NOT_FOUND';
      }
      throw error;
    }
  }

  /**
   * Elke mutatie op de werkversie gaat door hier: de conditionele update en het history-item zitten in
   * dezelfde transactie, dus of allebei of geen van beide.
   */
  private async transactUpdateWorkVersion(
    caseReference: string, setExpressionBody: string, names: Record<string, string>, values: Record<string, unknown>,
    condition: string, historyEntry: { historyId: string; occurredAt: string; [key: string]: unknown },
  ): Promise<LineMutationResult> {
    try {
      await this.documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk: partitionKey(caseReference), sk: WORK_VERSION_SORT_KEY },
              UpdateExpression: `SET ${setExpressionBody}`,
              ConditionExpression: condition,
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { pk: partitionKey(caseReference), sk: historySortKey(historyEntry.occurredAt, historyEntry.historyId), ...historyEntry },
            },
          },
        ],
      }));
      return 'OK';
    } catch (error) {
      if (isConditionFailureAt(error, 0)) {
        return 'NOT_FOUND';
      }
      throw error;
    }
  }
}
