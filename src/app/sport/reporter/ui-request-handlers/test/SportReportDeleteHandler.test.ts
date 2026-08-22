import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FakeAuditTrail } from '../../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../../shared/authorization/tests/FakePermissionRepository';
import { SportReport } from '../../store/SportReport';
import { SportReportStore } from '../../store/SportReportStore';
import { SportReportDeleteHandler } from '../SportReportDeleteHandler';

function report(overrides: Partial<SportReport> = {}): SportReport {
  return {
    reportId: 'report-1',
    districts: ['dukenburg'],
    from: '2026-01-01',
    to: '2026-01-31',
    status: 'READY',
    storageKey: 'reports/report-1.xlsx',
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function makeService(districts: string[]) {
  const repository = new FakePermissionRepository();
  repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts } }]);
  const auditTrail = new FakeAuditTrail();
  return { service: new AuthorizationService(repository, auditTrail), auditTrail };
}

describe('SportReportDeleteHandler', () => {
  it('deletes the S3 object, marks the report DELETED, audits and redirects for a fully-scoped medewerker', async () => {
    const { service, auditTrail } = makeService(['dukenburg']);
    const send = jest.fn().mockResolvedValue({});
    const s3Client = { send } as unknown as S3Client;
    const markDeleted = jest.fn().mockResolvedValue(true);
    const store = { get: jest.fn().mockResolvedValue(report()), markDeleted } as unknown as SportReportStore;
    const handler = new SportReportDeleteHandler(service, store, s3Client, auditTrail, 'test-bucket');

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, 'report-1');

    expect(response.statusCode).toBe(303);
    expect(send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'reports/report-1.xlsx' });
    expect(markDeleted).toHaveBeenCalledWith('report-1');
    expect(auditTrail.events).toContainEqual(expect.objectContaining({ eventType: 'SPORT_EXCEL_DELETED', outcome: 'SUCCESS' }));
  });

  it('denies deletion when the medewerker only has partial district access to the report', async () => {
    const { service } = makeService(['dukenburg']);
    const markDeleted = jest.fn();
    const store = { get: jest.fn().mockResolvedValue(report({ districts: ['dukenburg', 'lindenholt'] })), markDeleted } as unknown as SportReportStore;
    const handler = new SportReportDeleteHandler(service, store, {} as S3Client, new FakeAuditTrail(), 'test-bucket');

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, 'report-1');

    expect(response.statusCode).toBe(403);
    expect(markDeleted).not.toHaveBeenCalled();
  });

  it('stays idempotent when the S3 object is already gone: the status update still happens', async () => {
    const { service, auditTrail } = makeService(['dukenburg']);
    const send = jest.fn().mockRejectedValue(new Error('NoSuchKey'));
    const s3Client = { send } as unknown as S3Client;
    const markDeleted = jest.fn().mockResolvedValue(true);
    const store = { get: jest.fn().mockResolvedValue(report()), markDeleted } as unknown as SportReportStore;
    const handler = new SportReportDeleteHandler(service, store, s3Client, auditTrail, 'test-bucket');

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, 'report-1');

    expect(response.statusCode).toBe(303);
    expect(markDeleted).toHaveBeenCalledWith('report-1');
    expect(auditTrail.events).toContainEqual(expect.objectContaining({ eventType: 'SPORT_EXCEL_DELETED' }));
  });
});
