import { randomUUID } from 'crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { withCorrelationId } from '../../../observability/withCorrelationId';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { isSameOriginRequest, SPORT_SAME_ORIGIN_HEADER } from '../../../shared/security/SameOriginRequest';
import { SportCacheStore } from '../cache/SportCacheStore';

function accepted(): ApiGatewayV2Response {
  return Response.ok(202);
}

/**
 * Handles `POST /sport/submissions/refresh`: claims the refresh conditionally and invokes
 * `SportCacheWorker` asynchronously (`InvocationType: 'Event'`). Never waits for the worker; the browser
 * finds out the outcome through the next `GET /sport/submissions` poll.
 */
export class SportRefreshHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly cacheStore: SportCacheStore,
    private readonly lambdaClient: LambdaClient,
    private readonly workerFunctionName: string,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, headers: Record<string, string | undefined> | undefined, triggerCorrelationId: string,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, { resource: 'sport', action: 'view' });
    if (denied) {
      return withCorrelationId(denied, triggerCorrelationId);
    }

    if (!isSameOriginRequest(headers, SPORT_SAME_ORIGIN_HEADER)) {
      logger.warn('Sport refresh request rejected: missing same-origin header');
      return withCorrelationId(Response.error(403), triggerCorrelationId);
    }

    const runId = randomUUID();
    const claimed = await this.cacheStore.claimRefresh(runId);
    if (!claimed) {
      logger.debug('Sport cache refresh already active, not starting a new worker', { triggerCorrelationId });
      return withCorrelationId(accepted(), triggerCorrelationId);
    }

    try {
      await this.lambdaClient.send(new InvokeCommand({
        FunctionName: this.workerFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ runId, triggerCorrelationId })),
      }));
      logger.info('Sport cache refresh started', { runId, triggerCorrelationId });
    } catch (error) {
      logger.error('Failed to invoke SportCacheWorker', { runId, reason: errorReason(error) });
      await this.cacheStore.finalizeRefresh(runId, 'FAILED', new Date(), { failureReason: 'WORKER_START_ERROR' });
    }

    return withCorrelationId(accepted(), triggerCorrelationId);
  }
}
