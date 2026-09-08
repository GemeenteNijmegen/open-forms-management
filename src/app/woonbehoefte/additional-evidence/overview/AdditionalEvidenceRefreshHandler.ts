import { randomUUID } from 'crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../../shared/security/csrf/CsrfProtection';
import { AdditionalEvidenceSourceCacheStore } from '../source/AdditionalEvidenceSourceCacheStore';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

/**
 * Handles `POST /woonbehoefte/additional-evidence/refresh`: claims the Additional Evidence refresh
 * conditionally and invokes its own sync worker asynchronously (`InvocationType: 'Event'`), then redirects
 * back. Entirely separate from the primary refresh: its own claim state, its own worker. Gated on `view`,
 * not `manage`, same reasoning as the primary refresh: pulling in new submissions is not a mutation.
 */
export class AdditionalEvidenceRefreshHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly sourceCacheStore: AdditionalEvidenceSourceCacheStore,
    private readonly lambdaClient: LambdaClient,
    private readonly workerFunctionName: string,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean, triggerCorrelationId: string,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    const form = parseFormBody(body, isBase64Encoded);
    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      return this.authorizationService.denyAccess(context, WOONBEHOEFTE_VIEW_CHECK);
    }

    const runId = randomUUID();
    const claimed = await this.sourceCacheStore.claimRefresh(runId);
    if (!claimed) {
      logger.debug('Additional Evidence source refresh already active, not starting a new worker', { triggerCorrelationId });
      return Response.redirect('/woonbehoefte/additional-evidence?refresh=already-running', 303);
    }

    try {
      await this.lambdaClient.send(new InvokeCommand({
        FunctionName: this.workerFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ runId, triggerCorrelationId })),
      }));
      logger.info('Additional Evidence source refresh started', { runId, triggerCorrelationId });
    } catch (error) {
      logger.error('Failed to invoke AdditionalEvidenceSyncWorker', { runId, reason: errorReason(error) });
      await this.sourceCacheStore.finalizeRefresh(runId, 'FAILED', new Date(), { failureReason: 'WORKER_START_ERROR' });
      return Response.redirect('/woonbehoefte/additional-evidence?refresh=failed', 303);
    }

    return Response.redirect('/woonbehoefte/additional-evidence?refresh=started', 303);
  }
}
