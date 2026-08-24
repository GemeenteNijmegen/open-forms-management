import { randomUUID } from 'crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { sanitizeWoonbehoefteFilterQuery } from './WoonbehoefteOverviewFilter';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteSourceCacheStore } from '../source/WoonbehoefteSourceCacheStore';

const WOONBEHOEFTE_REFRESH_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

/**
 * Handles `POST /woonbehoefte/refresh`: claims the refresh conditionally and invokes the sync worker
 * asynchronously (`InvocationType: 'Event'`), then redirects back. Unlike Sport, this is a plain form
 * POST with the existing CSRF token, not a `fetch`+polling flow: the medewerker reloads the overview to
 * see progress, no new same-origin header needed for this feature. Gated on `view`, not `manage`: pulling
 * in new submissions is not a case mutation, and a view-only medewerker still needs to see new aanvragen.
 */
export class WoonbehoefteRefreshHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly sourceCacheStore: WoonbehoefteSourceCacheStore,
    private readonly lambdaClient: LambdaClient,
    private readonly workerFunctionName: string,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean, triggerCorrelationId: string,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_REFRESH_CHECK);
    if (denied) {
      return denied;
    }

    const form = parseFormBody(body, isBase64Encoded);
    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      return this.authorizationService.denyAccess(context, WOONBEHOEFTE_REFRESH_CHECK);
    }

    const back = sanitizeWoonbehoefteFilterQuery(form.get('back') ?? undefined);
    const backParam = back ? `&${back}` : '';

    const runId = randomUUID();
    const claimed = await this.sourceCacheStore.claimRefresh(runId);
    if (!claimed) {
      logger.debug('Woonbehoefte source refresh already active, not starting a new worker', { triggerCorrelationId });
      return Response.redirect(`/woonbehoefte?refresh=already-running${backParam}`, 303);
    }

    try {
      await this.lambdaClient.send(new InvokeCommand({
        FunctionName: this.workerFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ runId, triggerCorrelationId })),
      }));
      logger.info('Woonbehoefte source refresh started', { runId, triggerCorrelationId });
    } catch (error) {
      logger.error('Failed to invoke WoonbehoefteSyncWorker', { runId, reason: errorReason(error) });
      await this.sourceCacheStore.finalizeRefresh(runId, 'FAILED', new Date(), { failureReason: 'WORKER_START_ERROR' });
    }

    return Response.redirect(`/woonbehoefte?refresh=started${backParam}`, 303);
  }
}
