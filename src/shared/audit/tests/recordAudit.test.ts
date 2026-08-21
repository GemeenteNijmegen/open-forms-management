import { recordAudit } from '../recordAudit';
import { FakeAuditTrail } from './FakeAuditTrail';

describe('recordAudit', () => {
  it('calls through to AuditTrail.record', async () => {
    const auditTrail = new FakeAuditTrail();

    await recordAudit(auditTrail, { eventType: 'LOGIN_STARTED', outcome: 'SUCCESS', correlationId: 'trace-1' });

    expect(auditTrail.events).toMatchObject([{ eventType: 'LOGIN_STARTED', outcome: 'SUCCESS', correlationId: 'trace-1' }]);
  });

  it('swallows a failed write instead of throwing, since AuditTrail.record already logged it', async () => {
    const auditTrail = new FakeAuditTrail();
    jest.spyOn(auditTrail, 'record').mockRejectedValue(new Error('DynamoDB unavailable'));

    await expect(recordAudit(auditTrail, { eventType: 'LOGIN_STARTED', outcome: 'SUCCESS', correlationId: 'trace-1' }))
      .resolves.toBeUndefined();
  });
});
