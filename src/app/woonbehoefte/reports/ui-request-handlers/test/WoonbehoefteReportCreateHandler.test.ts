import { randomBytes } from 'crypto';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { FakeAuditTrail } from '../../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteReport } from '../../domain/WoonbehoefteReport';
import { WoonbehoefteReportStore } from '../../store/WoonbehoefteReportStore';
import { WoonbehoefteReportCreateHandler } from '../WoonbehoefteReportCreateHandler';

const csrfToken = randomBytes(32).toString('base64url');
const cookieHeader = `${CSRF_COOKIE_NAME}=${csrfToken}`;

function formBody(fields: Record<string, string | string[]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      params.append(key, entry);
    }
  }
  return params.toString();
}

function makeService(grants: { resource: string; actions: string[] }[] = [{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]) {
  const evaluator = new PermissionEvaluator(grants);
  const auditTrail = new FakeAuditTrail();
  const service = {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'employee-1' }, evaluator }),
    requireAuthorization: jest.fn().mockImplementation(async (_context, check) => (evaluator.evaluate(check) === 'ALLOW'
      ? undefined
      : { statusCode: 403 })),
    denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
  } as unknown as AuthorizationService;
  return { service, auditTrail };
}

function makeStore(overrides: Partial<{ existing: WoonbehoefteReport | undefined }> = {}) {
  return {
    findMatchingActive: jest.fn().mockResolvedValue(overrides.existing),
    createQueued: jest.fn().mockImplementation(async (input) => ({
      reportId: 'report-1',
      filter: input.filter,
      options: input.options,
      status: 'QUEUED',
      requestedBy: input.requestedBy,
      requestedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })),
    markQueuedFailed: jest.fn().mockResolvedValue(true),
  };
}

describe('WoonbehoefteReportCreateHandler', () => {
  it('creates a QUEUED report, invokes the worker asynchronously, audits without filter contents and redirects with a queued status', async () => {
    const { service, auditTrail } = makeService();
    const store = makeStore();
    const send = jest.fn().mockResolvedValue({});
    const lambdaClient = { send } as unknown as LambdaClient;
    const handler = new WoonbehoefteReportCreateHandler(service, store as unknown as WoonbehoefteReportStore, lambdaClient, auditTrail, 'worker-function');

    const body = formBody({ csrfToken, status: ['NEW', 'IN_PROGRESS'], search: 'Lindenhof', includeAllFormFields: 'on' });
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte/overzichten?status=queued');
    expect(store.createQueued).toHaveBeenCalledWith({
      filter: expect.objectContaining({ statuses: ['NEW', 'IN_PROGRESS'], search: 'Lindenhof' }),
      options: { includeAllFormFields: true, includeAttachmentFilenames: false },
      requestedBy: 'medewerker@nijmegen.nl',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input).toMatchObject({ FunctionName: 'worker-function', InvocationType: 'Event' });

    const auditedEvent = auditTrail.events.find((event) => event.eventType === 'WOONBEHOEFTE_EXCEL_REQUESTED');
    expect(auditedEvent).toMatchObject({ outcome: 'SUCCESS', metadata: { reportId: 'report-1', includeAllFormFields: true } });
    // No filter contents (statuses/search) in the audit metadata: only reportId and the two option booleans.
    expect(Object.keys(auditedEvent!.metadata!)).toEqual(['reportId', 'includeAllFormFields', 'includeAttachmentFilenames']);
  });

  it('denies the request without a valid CSRF token, never creating a report', async () => {
    const { service } = makeService();
    const store = makeStore();
    const lambdaClient = { send: jest.fn() } as unknown as LambdaClient;
    const handler = new WoonbehoefteReportCreateHandler(service, store as unknown as WoonbehoefteReportStore, lambdaClient, new FakeAuditTrail(), 'worker-function');

    const body = formBody({ csrfToken: 'wrong-token' });
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, cookieHeader, body, false);

    expect(response.statusCode).toBe(403);
    expect(store.createQueued).not.toHaveBeenCalled();
  });

  it('never resolves assignment to MINE even if a form field claims it, since the type has no such value', async () => {
    const { service } = makeService();
    const store = makeStore();
    const lambdaClient = { send: jest.fn().mockResolvedValue({}) } as unknown as LambdaClient;
    const handler = new WoonbehoefteReportCreateHandler(service, store as unknown as WoonbehoefteReportStore, lambdaClient, new FakeAuditTrail(), 'worker-function');

    const body = formBody({ csrfToken, assignment: 'mine' });
    await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, cookieHeader, body, false);

    expect(store.createQueued).toHaveBeenCalledWith(expect.objectContaining({ filter: expect.objectContaining({ assignment: 'ALL' }) }));
  });

  it('does not start a second worker when an identical active request already exists', async () => {
    const { service, auditTrail } = makeService();
    const existing: WoonbehoefteReport = {
      reportId: 'existing',
      filter: { statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL', checkRequestedOnly: false },
      options: { includeAllFormFields: false, includeAttachmentFilenames: false },
      status: 'BUILDING',
      requestedBy: 'medewerker@nijmegen.nl',
      requestedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    const store = makeStore({ existing });
    const send = jest.fn();
    const lambdaClient = { send } as unknown as LambdaClient;
    const handler = new WoonbehoefteReportCreateHandler(service, store as unknown as WoonbehoefteReportStore, lambdaClient, auditTrail, 'worker-function');

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, cookieHeader, formBody({ csrfToken }), false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte/overzichten?status=duplicate');
    expect(store.createQueued).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('marks the report FAILED with WORKER_START_ERROR and redirects to an error status when the async invoke itself fails', async () => {
    const { service } = makeService();
    const store = makeStore();
    const send = jest.fn().mockRejectedValue(new Error('Lambda unavailable'));
    const lambdaClient = { send } as unknown as LambdaClient;
    const handler = new WoonbehoefteReportCreateHandler(service, store as unknown as WoonbehoefteReportStore, lambdaClient, new FakeAuditTrail(), 'worker-function');

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, cookieHeader, formBody({ csrfToken }), false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte/overzichten?status=worker_start_error');
    expect(store.markQueuedFailed).toHaveBeenCalledWith('report-1', 'WORKER_START_ERROR');
  });
});
