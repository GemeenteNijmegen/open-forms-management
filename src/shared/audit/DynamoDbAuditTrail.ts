import { randomUUID } from 'crypto';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { AuditEvent, AuditOutcome, RecordAuditEventInput } from './AuditEvent';
import { AuditDateRange, AuditTrail } from './AuditTrail';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';

const OUTCOMES: AuditOutcome[] = ['SUCCESS', 'FAILURE', 'DENIED'];

// Fixed pk shared by every event, so every query here runs against one partition instead of scanning the table.
const PARTITION_KEY = 'AUDIT';

const DEFAULT_LIMIT = 100;

// sk is `<occurredAt>#<eventId>`, so a plain occurredAt as upper bound would exclude events at that exact
// timestamp (their sk is longer). U+FFFF sorts after any eventId, so appending it keeps the date-based range correct.
const HIGH_SORT_SUFFIX = '#\uFFFF';

function isOutcome(value: unknown): value is AuditOutcome {
  return typeof value === 'string' && OUTCOMES.includes(value as AuditOutcome);
}

function isMetadata(value: unknown): value is Record<string, string | number | boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => ['string', 'number', 'boolean'].includes(typeof entry));
}

function skRangeCondition(range?: AuditDateRange): { expression: string; values: Record<string, string> } {
  if (!range?.since && !range?.until) {
    return { expression: '', values: {} };
  }
  if (range.since && range.until) {
    return { expression: ' AND sk BETWEEN :since AND :until', values: { ':since': range.since, ':until': `${range.until}${HIGH_SORT_SUFFIX}` } };
  }
  if (range.since) {
    return { expression: ' AND sk >= :since', values: { ':since': range.since } };
  }
  return { expression: ' AND sk <= :until', values: { ':until': `${range.until}${HIGH_SORT_SUFFIX}` } };
}

export class DynamoDbAuditTrail implements AuditTrail {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  async record(input: RecordAuditEventInput): Promise<void> {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();

    try {
      await this.documentClient.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: PARTITION_KEY,
          sk: `${occurredAt}#${eventId}`,
          eventId,
          occurredAt,
          eventType: input.eventType,
          outcome: input.outcome,
          correlationId: input.correlationId,
          ...(input.flowId ? { flowId: input.flowId } : {}),
          ...(input.actorEmail ? { actorEmail: input.actorEmail } : {}),
          ...(input.resource ? { resource: input.resource } : {}),
          ...(input.action ? { action: input.action } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      }));
    } catch (error) {
      logger.error('Audit write failed', { eventType: input.eventType, reason: errorReason(error) });
      throw error;
    }

    logger.debug('Audit event written', { eventType: input.eventType });
  }

  async findLatest(limit: number = DEFAULT_LIMIT): Promise<AuditEvent[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    // Typically one call; it only pages further if a page came back short of limit.
    do {
      const result = await this.documentClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': PARTITION_KEY },
        ScanIndexForward: false,
        Limit: limit - items.length,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));

      items.push(...(result.Items ?? []));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey && items.length < limit);

    return this.toAuditEvents(items);
  }

  async findByActor(actorEmail: string, limit: number = DEFAULT_LIMIT, range?: AuditDateRange): Promise<AuditEvent[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    const { expression, values } = skRangeCondition(range);

    // FilterExpression only applies within one page, so a page can come back with fewer matches than limit even though more exist.
    do {
      const result = await this.documentClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: `pk = :pk${expression}`,
        FilterExpression: 'actorEmail = :actorEmail',
        ExpressionAttributeValues: { ':pk': PARTITION_KEY, ':actorEmail': actorEmail, ...values },
        ScanIndexForward: false,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));

      items.push(...(result.Items ?? []));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey && items.length < limit);

    return this.toAuditEvents(items).slice(0, limit);
  }

  private toAuditEvents(items: Record<string, unknown>[]): AuditEvent[] {
    return items
      .map((item) => this.toAuditEvent(item))
      .filter((event): event is AuditEvent => event !== undefined);
  }

  private toAuditEvent(item: Record<string, unknown>): AuditEvent | undefined {
    if (typeof item.eventId !== 'string' || typeof item.occurredAt !== 'string' || typeof item.eventType !== 'string') {
      logger.warn('Ignoring audit record with an invalid identity/type', { pk: item.pk });
      return undefined;
    }

    if (!isOutcome(item.outcome)) {
      logger.warn('Ignoring audit record with an invalid outcome', { eventId: item.eventId });
      return undefined;
    }

    if (typeof item.correlationId !== 'string') {
      logger.warn('Ignoring audit record with an invalid correlationId', { eventId: item.eventId });
      return undefined;
    }

    if (item.metadata !== undefined && !isMetadata(item.metadata)) {
      logger.warn('Ignoring audit record with invalid metadata', { eventId: item.eventId });
      return undefined;
    }

    return {
      eventId: item.eventId,
      occurredAt: item.occurredAt,
      eventType: item.eventType,
      outcome: item.outcome,
      correlationId: item.correlationId,
      ...(typeof item.flowId === 'string' ? { flowId: item.flowId } : {}),
      ...(typeof item.actorEmail === 'string' ? { actorEmail: item.actorEmail } : {}),
      ...(typeof item.resource === 'string' ? { resource: item.resource } : {}),
      ...(typeof item.action === 'string' ? { action: item.action } : {}),
      ...(item.metadata ? { metadata: item.metadata as Record<string, string | number | boolean> } : {}),
    };
  }
}
