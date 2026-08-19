import { AuditTrail } from '../AuditTrail';
import { recordAudit } from '../recordAudit';

describe('recordAudit', () => {
  it('calls through to AuditTrail.record', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const auditTrail = { record, findLatest: jest.fn(), findByActor: jest.fn() } as unknown as AuditTrail;

    await recordAudit(auditTrail, { eventType: 'LOGIN_STARTED', outcome: 'SUCCESS', correlationId: 'trace-1' });

    expect(record).toHaveBeenCalledWith({ eventType: 'LOGIN_STARTED', outcome: 'SUCCESS', correlationId: 'trace-1' });
  });

  it('swallows a failed write instead of throwing, since AuditTrail.record already logged it', async () => {
    const record = jest.fn().mockRejectedValue(new Error('DynamoDB unavailable'));
    const auditTrail = { record, findLatest: jest.fn(), findByActor: jest.fn() } as unknown as AuditTrail;

    await expect(recordAudit(auditTrail, { eventType: 'LOGIN_STARTED', outcome: 'SUCCESS', correlationId: 'trace-1' }))
      .resolves.toBeUndefined();
  });
});
