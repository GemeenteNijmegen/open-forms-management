import { randomUUID } from 'crypto';
import { AuditEvent, RecordAuditEventInput } from '../AuditEvent';
import { AuditDateRange, AuditTrail } from '../AuditTrail';

/**
 * In-memory AuditTrail for tests of code that depends on AuditTrail, without talking to DynamoDB.
 */
export class FakeAuditTrail implements AuditTrail {
  readonly events: AuditEvent[] = [];

  async record(input: RecordAuditEventInput): Promise<void> {
    this.events.push({ ...input, eventId: randomUUID(), occurredAt: new Date().toISOString() });
  }

  async findLatest(limit = 100): Promise<AuditEvent[]> {
    return [...this.events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
  }

  async findByActor(actorEmail: string, limit = 100, range?: AuditDateRange): Promise<AuditEvent[]> {
    const latest = await this.findLatest(this.events.length);
    return latest
      .filter((event) => event.actorEmail === actorEmail)
      .filter((event) => !range?.since || event.occurredAt >= range.since)
      .filter((event) => !range?.until || event.occurredAt <= range.until)
      .slice(0, limit);
  }
}
