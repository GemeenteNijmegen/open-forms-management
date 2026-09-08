import { randomBytes } from 'crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FakeAuditTrail } from '../../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteReport } from '../../domain/WoonbehoefteReport';
import { WoonbehoefteReportStore } from '../../store/WoonbehoefteReportStore';
import { WoonbehoefteReportDeleteHandler } from '../WoonbehoefteReportDeleteHandler';

const csrfToken = randomBytes(32).toString('base64url');
const cookieHeader = `${CSRF_COOKIE_NAME}=${csrfToken}`;

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
    denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
  } as unknown as AuthorizationService;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('WoonbehoefteReportDeleteHandler', () => {
  it('deletes the S3 object, marks the report DELETED and audits it, not maker-only', async () => {
    const service = makeService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]);
    const auditTrail = new FakeAuditTrail();
    const send = jest.fn().mockResolvedValue({});
    const s3Client = { send } as unknown as S3Client;
    const markDeleted = jest.fn().mockResolvedValue(true);
    const store = { get: jest.fn().mockResolvedValue(report({ requestedBy: 'collega@nijmegen.nl' })), markDeleted } as unknown as WoonbehoefteReportStore;
    const handler = new WoonbehoefteReportDeleteHandler(service, store, s3Client, auditTrail, 'test-bucket');

    const response = await handler.handleRequest(
      { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, 'report-1', cookieHeader, form({ csrfToken }), false,
    );

    expect(response.statusCode).toBe(303);
    expect(send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'reports/report-1.xlsx' });
    expect(markDeleted).toHaveBeenCalledWith('report-1');
    expect(auditTrail.events).toContainEqual(expect.objectContaining({ eventType: 'WOONBEHOEFTE_EXCEL_DELETED', outcome: 'SUCCESS' }));
  });

  it('denies deletion without a valid CSRF token', async () => {
    const service = makeService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]);
    const markDeleted = jest.fn();
    const store = { get: jest.fn().mockResolvedValue(report()), markDeleted } as unknown as WoonbehoefteReportStore;
    const handler = new WoonbehoefteReportDeleteHandler(service, store, {} as S3Client, new FakeAuditTrail(), 'test-bucket');

    const response = await handler.handleRequest(
      { principalId: 'employee-1' }, 'report-1', cookieHeader, form({ csrfToken: 'wrong-token' }), false,
    );

    expect(response.statusCode).toBe(403);
    expect(markDeleted).not.toHaveBeenCalled();
  });

  it('denies a medewerker without woonbehoefte:exceloverzicht before ever touching the store', async () => {
    const service = makeService([{ resource: 'woonbehoefte', actions: ['view'] }]);
    const markDeleted = jest.fn();
    const store = { get: jest.fn(), markDeleted } as unknown as WoonbehoefteReportStore;
    const handler = new WoonbehoefteReportDeleteHandler(service, store, {} as S3Client, new FakeAuditTrail(), 'test-bucket');

    const response = await handler.handleRequest({ principalId: 'employee-1' }, 'report-1', cookieHeader, form({ csrfToken }), false);

    expect(response.statusCode).toBe(403);
    expect(store.get).not.toHaveBeenCalled();
  });

  it('stays idempotent when the S3 object is already gone: the status update still happens', async () => {
    const service = makeService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]);
    const auditTrail = new FakeAuditTrail();
    const send = jest.fn().mockRejectedValue(new Error('NoSuchKey'));
    const s3Client = { send } as unknown as S3Client;
    const markDeleted = jest.fn().mockResolvedValue(true);
    const store = { get: jest.fn().mockResolvedValue(report()), markDeleted } as unknown as WoonbehoefteReportStore;
    const handler = new WoonbehoefteReportDeleteHandler(service, store, s3Client, auditTrail, 'test-bucket');

    const response = await handler.handleRequest(
      { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, 'report-1', cookieHeader, form({ csrfToken }), false,
    );

    expect(response.statusCode).toBe(303);
    expect(markDeleted).toHaveBeenCalledWith('report-1');
    expect(auditTrail.events).toContainEqual(expect.objectContaining({ eventType: 'WOONBEHOEFTE_EXCEL_DELETED' }));
  });

  it('redirects without touching S3/markDeleted when the report no longer exists', async () => {
    const service = makeService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]);
    const send = jest.fn();
    const markDeleted = jest.fn();
    const store = { get: jest.fn().mockResolvedValue(undefined), markDeleted } as unknown as WoonbehoefteReportStore;
    const handler = new WoonbehoefteReportDeleteHandler(service, store, { send } as unknown as S3Client, new FakeAuditTrail(), 'test-bucket');

    const response = await handler.handleRequest({ principalId: 'employee-1' }, 'missing-report', cookieHeader, form({ csrfToken }), false);

    expect(response.statusCode).toBe(303);
    expect(send).not.toHaveBeenCalled();
    expect(markDeleted).not.toHaveBeenCalled();
  });
});
