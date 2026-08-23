import { LambdaClient } from '@aws-sdk/client-lambda';
import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { SPORT_SAME_ORIGIN_HEADER } from '../../../../shared/security/SameOriginRequest';
import { SportCacheStore } from '../../cache/SportCacheStore';
import { SportRefreshHandler } from '../SportRefreshHandler';

function authorizedService(): AuthorizationService {
  const repository = new FakePermissionRepository();
  repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
  return new AuthorizationService(repository, new FakeAuditTrail());
}

const identity = { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' };
const sameOriginHeaders = { [SPORT_SAME_ORIGIN_HEADER]: '1' };

describe('SportRefreshHandler', () => {
  it('denies a medewerker without any Sport grant', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const cacheStore = { claimRefresh: jest.fn() } as unknown as SportCacheStore;
    const lambdaClient = { send: jest.fn() } as unknown as LambdaClient;
    const handler = new SportRefreshHandler(service, cacheStore, lambdaClient, 'worker-fn');

    const response = await handler.handleRequest(identity, sameOriginHeaders, 'trace-1');

    expect(response.statusCode).toBe(403);
    expect(cacheStore.claimRefresh).not.toHaveBeenCalled();
  });

  it('rejects a POST missing the same-origin header, without claiming a refresh', async () => {
    const service = authorizedService();
    const cacheStore = { claimRefresh: jest.fn() } as unknown as SportCacheStore;
    const lambdaClient = { send: jest.fn() } as unknown as LambdaClient;
    const handler = new SportRefreshHandler(service, cacheStore, lambdaClient, 'worker-fn');

    const response = await handler.handleRequest(identity, {}, 'trace-1');

    expect(response.statusCode).toBe(403);
    expect(cacheStore.claimRefresh).not.toHaveBeenCalled();
  });

  it('claims the refresh and invokes the worker exactly once with the claimed runId', async () => {
    const service = authorizedService();
    const cacheStore = { claimRefresh: jest.fn().mockResolvedValue(true), finalizeRefresh: jest.fn() } as unknown as SportCacheStore;
    const send = jest.fn().mockResolvedValue({});
    const lambdaClient = { send } as unknown as LambdaClient;
    const handler = new SportRefreshHandler(service, cacheStore, lambdaClient, 'worker-fn');

    const response = await handler.handleRequest(identity, sameOriginHeaders, 'trace-1');

    expect(response.statusCode).toBe(202);
    expect(response.headers?.['X-Correlation-Id']).toBe('trace-1');
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0][0].input.Payload.toString());
    expect(payload.triggerCorrelationId).toBe('trace-1');
    expect(send.mock.calls[0][0].input.InvocationType).toBe('Event');
    expect(send.mock.calls[0][0].input.FunctionName).toBe('worker-fn');
  });

  it('does not start a second worker when a refresh is already active, but still answers 202', async () => {
    const service = authorizedService();
    const cacheStore = { claimRefresh: jest.fn().mockResolvedValue(false) } as unknown as SportCacheStore;
    const send = jest.fn();
    const lambdaClient = { send } as unknown as LambdaClient;
    const handler = new SportRefreshHandler(service, cacheStore, lambdaClient, 'worker-fn');

    const response = await handler.handleRequest(identity, sameOriginHeaders, 'trace-1');

    expect(response.statusCode).toBe(202);
    expect(send).not.toHaveBeenCalled();
  });

  it('moves the claimed run to a recoverable FAILED state when the worker invoke itself fails', async () => {
    const service = authorizedService();
    const cacheStore = {
      claimRefresh: jest.fn().mockResolvedValue(true), finalizeRefresh: jest.fn().mockResolvedValue(true),
    } as unknown as SportCacheStore;
    const send = jest.fn().mockRejectedValue(new Error('Lambda unavailable'));
    const lambdaClient = { send } as unknown as LambdaClient;
    const handler = new SportRefreshHandler(service, cacheStore, lambdaClient, 'worker-fn');

    const response = await handler.handleRequest(identity, sameOriginHeaders, 'trace-1');

    expect(response.statusCode).toBe(202);
    expect(cacheStore.finalizeRefresh).toHaveBeenCalledWith(
      expect.any(String), 'FAILED', expect.any(Date), { failureReason: 'WORKER_START_ERROR' },
    );
  });
});
