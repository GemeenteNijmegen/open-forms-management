import { AuditEvent, RecordAuditEventInput } from './AuditEvent';

export interface AuditDateRange {
  since?: string;
  until?: string;
}

export interface AuditTrail {
  record(input: RecordAuditEventInput): Promise<void>;

  // Newest-first, a single Query. limit defaults to a UI-sized page (100) when omitted.
  findLatest(limit?: number): Promise<AuditEvent[]>;

  // Newest-first, a Query filtered on actorEmail; range narrows it to a window on occurredAt instead of the whole table.
  findByActor(actorEmail: string, limit?: number, range?: AuditDateRange): Promise<AuditEvent[]>;
}
