import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FakeAuditTrail } from '../../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../../shared/authorization/tests/FakePermissionRepository';
import { SportReport } from '../../store/SportReport';
import { SportReportStore } from '../../store/SportReportStore';
import { SportReportDownloadHandler } from '../SportReportDownloadHandler';

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

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

function makeService(districts: string[] = ['dukenburg']) {
  const repository = new FakePermissionRepository();
  repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts } }]);
  const auditTrail = new FakeAuditTrail();
  return { service: new AuthorizationService(repository, auditTrail), auditTrail };
}

describe('SportReportDownloadHandler', () => {
  beforeEach(() => {
    (getSignedUrl as jest.Mock).mockReset().mockResolvedValue('https://signed.example.invalid/reports/report-1.xlsx');
  });

  it('presigns a short-lived GetObject URL and audits the download after authorization succeeds', async () => {
    const { service, auditTrail } = makeService(['dukenburg']);
    const store = { get: jest.fn().mockResolvedValue(report()) } as unknown as SportReportStore;
    const handler = new SportReportDownloadHandler(service, store, {} as S3Client, auditTrail, 'test-bucket');

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, 'report-1');

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toBe('https://signed.example.invalid/reports/report-1.xlsx');
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 60 });
    expect(auditTrail.events).toContainEqual(expect.objectContaining({
      eventType: 'SPORT_EXCEL_DOWNLOADED', outcome: 'SUCCESS', metadata: expect.objectContaining({ reportId: 'report-1' }),
    }));
  });

  it('denies a medewerker who no longer has access to every report district', async () => {
    const { service } = makeService(['lindenholt']);
    const store = { get: jest.fn().mockResolvedValue(report({ districts: ['dukenburg', 'lindenholt'] })) } as unknown as SportReportStore;
    const handler = new SportReportDownloadHandler(service, store, {} as S3Client, new FakeAuditTrail(), 'test-bucket');

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, 'report-1');

    expect(response.statusCode).toBe(403);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['is expired, even though DynamoDB TTL/S3 lifecycle have not physically removed it yet', { expiresAt: Math.floor(Date.now() / 1000) - 1 }],
    ['is not READY yet', { status: 'BUILDING' as const, storageKey: undefined }],
  ])('refuses to presign a report that %s', async (_description, overrides) => {
    const { service } = makeService(['dukenburg']);
    const store = { get: jest.fn().mockResolvedValue(report(overrides)) } as unknown as SportReportStore;
    const handler = new SportReportDownloadHandler(service, store, {} as S3Client, new FakeAuditTrail(), 'test-bucket');

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, 'report-1');

    expect(response.statusCode).toBe(404);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});
