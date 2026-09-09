import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FakeAuditTrail } from '../../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { WoonbehoefteReport } from '../../domain/WoonbehoefteReport';
import { WoonbehoefteReportStore } from '../../store/WoonbehoefteReportStore';
import { WoonbehoefteReportDownloadHandler } from '../WoonbehoefteReportDownloadHandler';

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

const filter = { statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL' as const, checkRequestedOnly: false };

function report(overrides: Partial<WoonbehoefteReport> = {}): WoonbehoefteReport {
  return {
    reportId: 'report-1',
    filter,
    options: { includeAllFormFields: false, includeAttachmentFilenames: false },
    status: 'READY',
    storageKey: 'reports/report-1.xlsx',
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function makeService(grants: { resource: string; actions: string[] }[]): AuthorizationService {
  const evaluator = new PermissionEvaluator(grants);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'employee-1' }, evaluator }),
    requireAuthorization: jest.fn().mockImplementation(async (_context, check) => (evaluator.evaluate(check) === 'ALLOW'
      ? undefined
      : { statusCode: 403 })),
  } as unknown as AuthorizationService;
}

describe('WoonbehoefteReportDownloadHandler', () => {
  beforeEach(() => {
    (getSignedUrl as jest.Mock).mockReset().mockResolvedValue('https://signed.example.invalid/reports/report-1.xlsx');
  });

  it('presigns a short-lived GetObject URL and audits the download, requested by a different medewerker than the downloader', async () => {
    const store = { get: jest.fn().mockResolvedValue(report({ requestedBy: 'collega@nijmegen.nl' })) } as unknown as WoonbehoefteReportStore;
    const auditTrail = new FakeAuditTrail();
    const handler = new WoonbehoefteReportDownloadHandler(
      makeService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]), store, {} as S3Client, auditTrail, 'test-bucket',
    );

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, 'report-1');

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toBe('https://signed.example.invalid/reports/report-1.xlsx');
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 60 });
    expect(auditTrail.events).toContainEqual(expect.objectContaining({
      eventType: 'WOONBEHOEFTE_EXCEL_DOWNLOADED', outcome: 'SUCCESS', metadata: { reportId: 'report-1' },
    }));
  });

  it('denies a medewerker without woonbehoefte:exceloverzicht', async () => {
    const store = { get: jest.fn() } as unknown as WoonbehoefteReportStore;
    const handler = new WoonbehoefteReportDownloadHandler(
      makeService([{ resource: 'woonbehoefte', actions: ['view'] }]), store, {} as S3Client, new FakeAuditTrail(), 'test-bucket',
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, 'report-1');

    expect(response.statusCode).toBe(403);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['is expired, even though DynamoDB TTL/S3 lifecycle have not physically removed it yet', { expiresAt: Math.floor(Date.now() / 1000) - 1 }],
    ['is not READY yet', { status: 'BUILDING' as const, storageKey: undefined }],
  ])('refuses to presign a report that %s', async (_description, overrides) => {
    const store = { get: jest.fn().mockResolvedValue(report(overrides)) } as unknown as WoonbehoefteReportStore;
    const handler = new WoonbehoefteReportDownloadHandler(
      makeService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]), store, {} as S3Client, new FakeAuditTrail(), 'test-bucket',
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, 'report-1');

    expect(response.statusCode).toBe(404);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});
