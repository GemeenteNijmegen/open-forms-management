import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteReportOptions } from '../domain/WoonbehoefteReport';
import { resolveWoonbehoefteReportFilter } from '../filters/WoonbehoefteReportFilter';
import { WoonbehoefteReportStore } from '../store/WoonbehoefteReportStore';

const WOONBEHOEFTE_EXCELOVERZICHT_CHECK = { resource: 'woonbehoefte', action: 'exceloverzicht' } as const;

function resolveOptions(form: URLSearchParams): WoonbehoefteReportOptions {
  return {
    includeAllFormFields: form.get('includeAllFormFields') === 'on',
    includeAttachmentFilenames: form.get('includeAttachmentFilenames') === 'on',
  };
}

/**
 * Handles POST /woonbehoefte/overzichten: validates CSRF, writes a QUEUED report, invokes the worker
 * asynchronously (InvocationType: Event) and redirects immediately - it never waits for the worker. The
 * filter itself has no invalid shape (unknown values are dropped, not rejected), unlike Sport's district/
 * date request: there is always a valid, even if empty ("no filter"), WoonbehoefteReportFilter to build.
 */
export class WoonbehoefteReportCreateHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly reportStore: WoonbehoefteReportStore,
    private readonly lambdaClient: LambdaClient,
    private readonly auditTrail: AuditTrail,
    private readonly workerFunctionName: string,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_EXCELOVERZICHT_CHECK);
    if (denied) {
      return denied;
    }

    const form = parseFormBody(body, isBase64Encoded);
    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      return this.authorizationService.denyAccess(context, WOONBEHOEFTE_EXCELOVERZICHT_CHECK);
    }

    const filter = resolveWoonbehoefteReportFilter(form);
    const options = resolveOptions(form);

    const existing = await this.reportStore.findMatchingActive(filter, options);
    if (existing) {
      return Response.redirect('/woonbehoefte/overzichten?status=duplicate', 303);
    }

    const report = await this.reportStore.createQueued({ filter, options, requestedBy: identity.email ?? identity.principalId });

    await recordAudit(this.auditTrail, {
      eventType: 'WOONBEHOEFTE_EXCEL_REQUESTED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'woonbehoefte',
      action: 'request_report',
      ...(identity.email ? { actorEmail: identity.email } : {}),
      metadata: {
        reportId: report.reportId,
        includeAllFormFields: options.includeAllFormFields,
        includeAttachmentFilenames: options.includeAttachmentFilenames,
      },
    });

    try {
      await this.lambdaClient.send(new InvokeCommand({
        FunctionName: this.workerFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ reportId: report.reportId })),
      }));
    } catch (error) {
      logger.error('Failed to invoke WoonbehoefteExcelWorker', { reportId: report.reportId, reason: errorReason(error) });
      await this.reportStore.markQueuedFailed(report.reportId, 'WORKER_START_ERROR');
      return Response.redirect('/woonbehoefte/overzichten?status=worker_start_error', 303);
    }

    return Response.redirect('/woonbehoefte/overzichten?status=queued', 303);
  }
}
