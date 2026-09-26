import { randomBytes } from 'crypto';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../shared/security/csrf/CsrfProtection';
import { ProjectDetailsStore } from '../persistence/ProjectDetailsStore';
import { ProjectDetailsTriggerHandler } from '../ui/ProjectDetailsTriggerHandler';

const csrfToken = randomBytes(32).toString('base64url');
const cookieHeader = `${CSRF_COOKIE_NAME}=${csrfToken}`;

function makeAuthorizationService(): AuthorizationService {
  const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['manage'] }]);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' }, evaluator }),
    requireAuthorization: jest.fn().mockResolvedValue(undefined),
    denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
  } as unknown as AuthorizationService;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function makeStore(overrides: Partial<{ workVersion: unknown; attempt: unknown }> = {}): ProjectDetailsStore {
  return {
    getWorkVersion: jest.fn().mockResolvedValue(overrides.workVersion),
    getAttempt: jest.fn().mockResolvedValue(overrides.attempt),
  } as unknown as ProjectDetailsStore;
}

function makeAuditTrail(): AuditTrail {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditTrail;
}

describe('ProjectDetailsTriggerHandler', () => {
  it('invokes the worker asynchronously for a batch start, audits the start and redirects with projectDetails=started', async () => {
    const lambdaClient = { send: jest.fn().mockResolvedValue({}) } as unknown as LambdaClient;
    const auditTrail = makeAuditTrail();
    const handler = new ProjectDetailsTriggerHandler(makeAuthorizationService(), makeStore(), lambdaClient, 'worker-function', auditTrail);

    const response = await handler.handleBatchStart({ principalId: 'medewerker' }, cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte?projectDetails=started');
    expect((lambdaClient.send as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((auditTrail.record as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'WOONBEHOEFTE_PROJECT_DETAILS_START_REQUESTED',
      metadata: {},
    }));
  });

  it('redirects with projectDetails=failed when the worker invocation itself fails, auditing nothing', async () => {
    const lambdaClient = { send: jest.fn().mockRejectedValue(new Error('invoke failed')) } as unknown as LambdaClient;
    const auditTrail = makeAuditTrail();
    const handler = new ProjectDetailsTriggerHandler(makeAuthorizationService(), makeStore(), lambdaClient, 'worker-function', auditTrail);

    const response = await handler.handleBatchStart({ principalId: 'medewerker' }, cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte?projectDetails=failed');
    expect((auditTrail.record as jest.Mock)).not.toHaveBeenCalled();
  });

  it('starts a single dossier from NEW, audits the start with the caseReference, and redirects back to the case', async () => {
    const lambdaClient = { send: jest.fn().mockResolvedValue({}) } as unknown as LambdaClient;
    const auditTrail = makeAuditTrail();
    const handler = new ProjectDetailsTriggerHandler(makeAuthorizationService(), makeStore(), lambdaClient, 'worker-function', auditTrail);

    const response = await handler.handleCaseStart({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte/cases/OF-1');
    expect((lambdaClient.send as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((auditTrail.record as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'WOONBEHOEFTE_PROJECT_DETAILS_START_REQUESTED',
      metadata: { caseReference: 'OF-1' },
    }));
  });

  it('never restarts a READY dossier, even on a duplicate POST, and audits nothing', async () => {
    const lambdaClient = { send: jest.fn().mockResolvedValue({}) } as unknown as LambdaClient;
    const store = makeStore({ workVersion: { caseReference: 'OF-1' } });
    const auditTrail = makeAuditTrail();
    const handler = new ProjectDetailsTriggerHandler(makeAuthorizationService(), store, lambdaClient, 'worker-function', auditTrail);

    const response = await handler.handleCaseStart({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect(response.statusCode).toBe(303);
    expect((lambdaClient.send as jest.Mock)).not.toHaveBeenCalled();
    expect((auditTrail.record as jest.Mock)).not.toHaveBeenCalled();
  });

  it('never restarts a PENDING dossier from an in-flight run', async () => {
    const lambdaClient = { send: jest.fn().mockResolvedValue({}) } as unknown as LambdaClient;
    const store = makeStore({ attempt: { caseReference: 'OF-1', status: 'PENDING', attemptedAt: new Date().toISOString() } });
    const handler = new ProjectDetailsTriggerHandler(makeAuthorizationService(), store, lambdaClient, 'worker-function', makeAuditTrail());

    await handler.handleCaseStart({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect((lambdaClient.send as jest.Mock)).not.toHaveBeenCalled();
  });

  it('does restart a dossier whose PENDING poging is older than the Lambda-timeout, since that worker crashed', async () => {
    const lambdaClient = { send: jest.fn().mockResolvedValue({}) } as unknown as LambdaClient;
    const staleAttemptedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const store = makeStore({ attempt: { caseReference: 'OF-1', status: 'PENDING', attemptedAt: staleAttemptedAt } });
    const handler = new ProjectDetailsTriggerHandler(makeAuthorizationService(), store, lambdaClient, 'worker-function', makeAuditTrail());

    await handler.handleCaseStart({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect((lambdaClient.send as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('rejects a batch start without a valid CSRF token, invoking nothing', async () => {
    const lambdaClient = { send: jest.fn() } as unknown as LambdaClient;
    const handler = new ProjectDetailsTriggerHandler(makeAuthorizationService(), makeStore(), lambdaClient, 'worker-function', makeAuditTrail());

    const response = await handler.handleBatchStart({ principalId: 'medewerker' }, cookieHeader, form({ csrfToken: 'wrong' }), false, 'correlation-1');

    expect(response.statusCode).toBe(403);
    expect((lambdaClient.send as jest.Mock)).not.toHaveBeenCalled();
  });
});
