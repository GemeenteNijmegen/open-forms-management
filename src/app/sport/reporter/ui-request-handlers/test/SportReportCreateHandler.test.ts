import { LambdaClient } from '@aws-sdk/client-lambda';
import { FakeAuditTrail } from '../../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../../shared/authorization/tests/FakePermissionRepository';
import { SportReport } from '../../store/SportReport';
import { SportReportStore } from '../../store/SportReportStore';
import { SportReportCreateHandler } from '../SportReportCreateHandler';

function formBody(fields: Record<string, string | string[]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      params.append(key, entry);
    }
  }
  return params.toString();
}

function makeService(): { service: AuthorizationService; auditTrail: FakeAuditTrail } {
  const repository = new FakePermissionRepository();
  repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg', 'lindenholt'] } }]);
  const auditTrail = new FakeAuditTrail();
  return { service: new AuthorizationService(repository, auditTrail), auditTrail };
}

function makeStore(overrides: Partial<{ existing: SportReport | undefined }> = {}) {
  return {
    findMatchingActive: jest.fn().mockResolvedValue(overrides.existing),
    createQueued: jest.fn().mockImplementation(async (input) => ({
      reportId: 'report-1',
      districts: input.districts,
      from: input.from,
      to: input.to,
      status: 'QUEUED',
      requestedBy: input.requestedBy,
      requestedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })),
    markFailed: jest.fn().mockResolvedValue(true),
  };
}

describe('SportReportCreateHandler', () => {
  it('creates a QUEUED report, invokes the worker asynchronously, audits and redirects with a queued status', async () => {
    const { service, auditTrail } = makeService();
    const store = makeStore();
    const send = jest.fn().mockResolvedValue({});
    const lambdaClient = { send } as unknown as LambdaClient;
    const handler = new SportReportCreateHandler(service, store as unknown as SportReportStore, lambdaClient, auditTrail, 'worker-function');

    const body = formBody({ district: ['dukenburg', 'lindenholt'], from: '2026-01-01', to: '2026-01-31' });
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, body, false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toContain('status=queued');
    expect(store.createQueued).toHaveBeenCalledWith({
      districts: ['dukenburg', 'lindenholt'], from: '2026-01-01', to: '2026-01-31', requestedBy: 'medewerker@nijmegen.nl',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input).toMatchObject({ FunctionName: 'worker-function', InvocationType: 'Event' });
    expect(auditTrail.events).toContainEqual(expect.objectContaining({
      eventType: 'SPORT_EXCEL_REQUESTED', outcome: 'SUCCESS', metadata: expect.objectContaining({ reportId: 'report-1', districts: 'dukenburg,lindenholt' }),
    }));
  });

  it('rejects the whole request when a requested district is not allowed, without creating a report', async () => {
    const { service, auditTrail } = makeService();
    const store = makeStore();
    const lambdaClient = { send: jest.fn() } as unknown as LambdaClient;
    const handler = new SportReportCreateHandler(service, store as unknown as SportReportStore, lambdaClient, auditTrail, 'worker-function');

    const body = formBody({ district: ['dukenburg', 'nijmegenNoord'], from: '2026-01-01', to: '2026-01-31' });
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, body, false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toContain('status=invalid');
    expect(store.createQueued).not.toHaveBeenCalled();
  });

  it('does not start a second worker when an identical active request already exists', async () => {
    const { service, auditTrail } = makeService();
    const existing: SportReport = {
      reportId: 'existing',
      districts: ['dukenburg'],
      from: '2026-01-01',
      to: '2026-01-31',
      status: 'BUILDING',
      requestedBy: 'medewerker@nijmegen.nl',
      requestedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    const store = makeStore({ existing });
    const send = jest.fn();
    const lambdaClient = { send } as unknown as LambdaClient;
    const handler = new SportReportCreateHandler(service, store as unknown as SportReportStore, lambdaClient, auditTrail, 'worker-function');

    const body = formBody({ district: 'dukenburg', from: '2026-01-01', to: '2026-01-31' });
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, body, false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toContain('status=duplicate');
    expect(store.createQueued).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('marks the report FAILED with WORKER_START_ERROR and redirects to an error status when the async invoke itself fails', async () => {
    const { service, auditTrail } = makeService();
    const store = makeStore();
    const send = jest.fn().mockRejectedValue(new Error('Lambda unavailable'));
    const lambdaClient = { send } as unknown as LambdaClient;
    const handler = new SportReportCreateHandler(service, store as unknown as SportReportStore, lambdaClient, auditTrail, 'worker-function');

    const body = formBody({ district: 'dukenburg', from: '2026-01-01', to: '2026-01-31' });
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, body, false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toContain('status=worker_start_error');
    expect(store.markFailed).toHaveBeenCalledWith('report-1', 'WORKER_START_ERROR');
  });
});
