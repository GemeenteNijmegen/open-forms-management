import { randomBytes } from 'crypto';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { WoonbehoefteRefreshHandler } from '../WoonbehoefteRefreshHandler';

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

describe('WoonbehoefteRefreshHandler', () => {
  it('redirects to refresh=started when the worker invocation succeeds', async () => {
    const sourceCacheStore = {
      claimRefresh: jest.fn().mockResolvedValue(true),
      finalizeRefresh: jest.fn(),
    } as unknown as WoonbehoefteSourceCacheStore;
    const lambdaClient = { send: jest.fn().mockResolvedValue({}) } as unknown as LambdaClient;
    const handler = new WoonbehoefteRefreshHandler(makeAuthorizationService(), sourceCacheStore, lambdaClient, 'worker-function');

    const response = await handler.handleRequest({ principalId: 'medewerker' }, cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte?refresh=started');
    expect(sourceCacheStore.finalizeRefresh).not.toHaveBeenCalled();
  });

  it('finalizes the run as FAILED and redirects to refresh=failed, never started, when the worker invocation itself fails', async () => {
    const sourceCacheStore = {
      claimRefresh: jest.fn().mockResolvedValue(true),
      finalizeRefresh: jest.fn().mockResolvedValue(undefined),
    } as unknown as WoonbehoefteSourceCacheStore;
    const lambdaClient = { send: jest.fn().mockRejectedValue(new Error('Lambda invoke failed')) } as unknown as LambdaClient;
    const handler = new WoonbehoefteRefreshHandler(makeAuthorizationService(), sourceCacheStore, lambdaClient, 'worker-function');

    const response = await handler.handleRequest({ principalId: 'medewerker' }, cookieHeader, form({ csrfToken }), false, 'correlation-1');

    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith(
      expect.any(String), 'FAILED', expect.any(Date), { failureReason: 'WORKER_START_ERROR' },
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte?refresh=failed');
  });
});
