import { randomBytes } from 'crypto';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../../shared/security/csrf/CsrfProtection';
import { AdditionalEvidenceSourceCacheStore } from '../../source/AdditionalEvidenceSourceCacheStore';
import { AdditionalEvidenceRefreshHandler } from '../AdditionalEvidenceRefreshHandler';

const csrfToken = randomBytes(32).toString('base64url');
const cookieHeader = `${CSRF_COOKIE_NAME}=${csrfToken}`;

function makeAuthorizationService(): AuthorizationService {
  const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['view'] }]);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' }, evaluator }),
    requireAuthorization: jest.fn().mockResolvedValue(undefined),
    denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
  } as unknown as AuthorizationService;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('AdditionalEvidenceRefreshHandler', () => {
  it('redirects to refresh=started when the worker invocation succeeds', async () => {
    const sourceCacheStore = {
      claimRefresh: jest.fn().mockResolvedValue(true),
      finalizeRefresh: jest.fn(),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const lambdaClient = { send: jest.fn().mockResolvedValue({}) } as unknown as LambdaClient;
    const handler = new AdditionalEvidenceRefreshHandler(makeAuthorizationService(), sourceCacheStore, lambdaClient, 'additional-evidence-worker-function');

    const response = await handler.handleRequest({ principalId: 'medewerker' }, cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence?refresh=started');
    expect(sourceCacheStore.finalizeRefresh).not.toHaveBeenCalled();
  });

  it('finalizes the run as FAILED and redirects to refresh=failed, never started, when the worker invocation itself fails', async () => {
    const sourceCacheStore = {
      claimRefresh: jest.fn().mockResolvedValue(true),
      finalizeRefresh: jest.fn().mockResolvedValue(undefined),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const lambdaClient = { send: jest.fn().mockRejectedValue(new Error('Lambda invoke failed')) } as unknown as LambdaClient;
    const handler = new AdditionalEvidenceRefreshHandler(makeAuthorizationService(), sourceCacheStore, lambdaClient, 'additional-evidence-worker-function');

    const response = await handler.handleRequest({ principalId: 'medewerker' }, cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith(
      expect.any(String), 'FAILED', expect.any(Date), { failureReason: 'WORKER_START_ERROR' },
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence?refresh=failed');
  });

  it('does not invoke the worker and redirects to already-running when the claim is lost', async () => {
    const sourceCacheStore = {
      claimRefresh: jest.fn().mockResolvedValue(false),
      finalizeRefresh: jest.fn(),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const lambdaClient = { send: jest.fn() } as unknown as LambdaClient;
    const handler = new AdditionalEvidenceRefreshHandler(makeAuthorizationService(), sourceCacheStore, lambdaClient, 'additional-evidence-worker-function');

    const response = await handler.handleRequest({ principalId: 'medewerker' }, cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect(lambdaClient.send).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence?refresh=already-running');
  });
});
