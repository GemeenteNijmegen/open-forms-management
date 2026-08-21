import { RecordAuditEventInput } from './AuditEvent';
import { AuditTrail } from './AuditTrail';

// AuditTrail.record() already logs ERROR on failure; this stops that failure from also breaking the request
// it's auditing. A missed audit write shouldn't block a medewerker from logging in or out.
export async function recordAudit(auditTrail: AuditTrail, input: RecordAuditEventInput): Promise<void> {
  try {
    await auditTrail.record(input);
  } catch {
    // already logged by AuditTrail.record()
  }
}
