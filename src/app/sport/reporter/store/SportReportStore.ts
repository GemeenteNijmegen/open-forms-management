import { randomUUID } from 'crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { canonicalDistricts, isReportAvailable, SPORT_REPORT_ACTIVE_STATUSES, SportReport, SportReportStatus } from './SportReport';
import { logger } from '../../../../observability/Logger';
import { SportDistrict } from '../../sportdata/SportDistrictAuthorization';

const RETENTION_SECONDS = 30 * 24 * 60 * 60;

// QUEUED has no heartbeat, so this only needs to cover how long an async worker invocation can realistically
// take to start. BUILDING's threshold must stay above the worker Lambda's 15-minute hard timeout (see
// SportExcelWorkerFunction), otherwise a still-running worker between touchBuilding() calls could be failed here.
const QUEUED_STALE_AFTER_MS = 10 * 60 * 1000;
const BUILDING_STALE_AFTER_MS = 20 * 60 * 1000;

export interface CreateQueuedReportInput {
  districts: SportDistrict[];
  from: string;
  to: string;
  requestedBy: string;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

export class SportReportStore {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  async createQueued(input: CreateQueuedReportInput): Promise<SportReport> {
    const now = new Date();
    const report: SportReport = {
      reportId: randomUUID(),
      districts: canonicalDistricts(input.districts),
      from: input.from,
      to: input.to,
      status: 'QUEUED',
      requestedBy: input.requestedBy,
      requestedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: Math.floor(now.getTime() / 1000) + RETENTION_SECONDS,
    };

    // reportId is a fresh randomUUID(); this only guards the astronomically unlikely collision case.
    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: report,
      ConditionExpression: 'attribute_not_exists(reportId)',
    }));

    logger.debug('Sport report queued', { reportId: report.reportId });
    return report;
  }

  async get(reportId: string): Promise<SportReport | undefined> {
    const result = await this.documentClient.send(new GetCommand({ TableName: this.tableName, Key: { reportId } }));
    return result.Item as SportReport | undefined;
  }

  // Report volume and retention are small; one Scan plus an in-memory sort is simpler than a GSI for this.
  async listRecent(limit = 50): Promise<SportReport[]> {
    const reports = await this.scanAll();
    return reports
      .filter((report) => isReportAvailable(report))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .slice(0, limit);
  }

  async findMatchingActive(districts: SportDistrict[], from: string, to: string): Promise<SportReport | undefined> {
    // Set comparison, not positional: this only relies on "the same districts", not on how a stored report's own array happens to be ordered.
    const canonical = new Set(canonicalDistricts(districts));
    const reports = await this.scanAll();
    return reports.find((report) => isReportAvailable(report)
      && SPORT_REPORT_ACTIVE_STATUSES.includes(report.status)
      && report.from === from
      && report.to === to
      && report.districts.length === canonical.size
      && report.districts.every((district) => canonical.has(district)));
  }

  // Only a report still QUEUED can be claimed, so a duplicate async delivery of the same invocation loses this race.
  async claimForBuilding(reportId: string): Promise<boolean> {
    return this.transition(reportId, 'QUEUED', { status: 'BUILDING', startedAt: new Date().toISOString() });
  }

  // Best-effort heartbeat: if the report already reached a final status, silently skip it instead of throwing.
  async touchBuilding(reportId: string, submissionCount?: number): Promise<void> {
    await this.transition(reportId, 'BUILDING', submissionCount !== undefined ? { submissionCount } : {});
  }

  async markReady(reportId: string, storageKey: string, submissionCount: number): Promise<boolean> {
    return this.transition(reportId, 'BUILDING', { status: 'READY', storageKey, submissionCount, completedAt: new Date().toISOString() });
  }

  // Always the same reason: TOO_LARGE only happens through the worker's own time cutoff.
  async markTooLarge(reportId: string): Promise<boolean> {
    return this.transition(reportId, 'BUILDING', { status: 'TOO_LARGE', failureReason: 'TIME_LIMIT_REACHED', completedAt: new Date().toISOString() });
  }

  async markFailed(reportId: string, failureReason: string): Promise<boolean> {
    return this.transition(reportId, 'BUILDING', { status: 'FAILED', failureReason, completedAt: new Date().toISOString() });
  }

  // For a worker invocation that fails before the worker ever claims the report, so it's still QUEUED.
  async markQueuedFailed(reportId: string, failureReason: string): Promise<boolean> {
    return this.transition(reportId, 'QUEUED', { status: 'FAILED', failureReason, completedAt: new Date().toISOString() });
  }

  // Idempotent: deleting an already-DELETED report is a no-op, not an error.
  async markDeleted(reportId: string): Promise<boolean> {
    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { reportId },
        UpdateExpression: 'SET #status = :deleted, updatedAt = :now',
        ConditionExpression: 'attribute_exists(reportId) AND #status <> :deleted',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':deleted': 'DELETED', ':now': new Date().toISOString() },
      }));
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return false;
      }
      throw error;
    }
  }

  // `guard.updatedAt`, when given, adds `AND updatedAt = <value just read>` to the condition, so a transition
  // decided from a stale read (e.g. cleanup) is silently skipped if the report changed in the meantime.
  private async transition(
    reportId: string, requiredStatus: SportReportStatus, changes: Partial<SportReport>, guard: { updatedAt?: string } = {},
  ): Promise<boolean> {
    const updates: Record<string, unknown> = { ...changes, updatedAt: new Date().toISOString() };
    const names: Record<string, string> = { '#status': 'status' };
    const values: Record<string, unknown> = { ':requiredStatus': requiredStatus };
    const setClauses: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
      names[`#${key}`] = key;
      values[`:${key}`] = value;
      setClauses.push(`#${key} = :${key}`);
    }

    let conditionExpression = '#status = :requiredStatus';
    if (guard.updatedAt !== undefined) {
      names['#updatedAt'] = 'updatedAt';
      values[':expectedUpdatedAt'] = guard.updatedAt;
      conditionExpression += ' AND #updatedAt = :expectedUpdatedAt';
    }

    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { reportId },
        UpdateExpression: `SET ${setClauses.join(', ')}`,
        ConditionExpression: conditionExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        logger.debug('Sport report transition skipped, status no longer matched', { reportId, requiredStatus });
        return false;
      }
      throw error;
    }
  }

  // The one place both listRecent() and findMatchingActive() read reports from, so a report whose worker
  // stopped without reaching a final status can't block a new request forever. Guarded by the exact
  // updatedAt just read, so a worker that's still alive in the meantime is never overwritten.
  private async failStaleReports(reports: SportReport[]): Promise<SportReport[]> {
    const now = Date.now();
    return Promise.all(reports.map(async (report) => {
      if (report.status === 'QUEUED' && now - new Date(report.updatedAt).getTime() > QUEUED_STALE_AFTER_MS) {
        const failed = await this.transition(
          report.reportId, 'QUEUED', { status: 'FAILED', failureReason: 'WORKER_NOT_STARTED', completedAt: new Date().toISOString() },
          { updatedAt: report.updatedAt },
        );
        if (failed) {
          return { ...report, status: 'FAILED' as const, failureReason: 'WORKER_NOT_STARTED' };
        }
      }
      if (report.status === 'BUILDING' && now - new Date(report.updatedAt).getTime() > BUILDING_STALE_AFTER_MS) {
        const failed = await this.transition(
          report.reportId, 'BUILDING', { status: 'FAILED', failureReason: 'WORKER_STALLED', completedAt: new Date().toISOString() },
          { updatedAt: report.updatedAt },
        );
        if (failed) {
          return { ...report, status: 'FAILED' as const, failureReason: 'WORKER_STALLED' };
        }
      }
      return report;
    }));
  }

  private async scanAll(): Promise<SportReport[]> {
    const items: SportReport[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.documentClient.send(new ScanCommand({
        TableName: this.tableName,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));
      items.push(...(result.Items ?? []) as SportReport[]);
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return this.failStaleReports(items);
  }
}
