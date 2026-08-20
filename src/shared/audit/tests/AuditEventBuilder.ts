import { randomUUID } from 'crypto';
import { AuditEvent } from '../AuditEvent';

export function anAuditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    eventType: 'LOGIN_SUCCEEDED',
    outcome: 'SUCCESS',
    actorEmail: 'medewerker@nijmegen.nl',
    correlationId: randomUUID(),
    ...overrides,
  };
}
