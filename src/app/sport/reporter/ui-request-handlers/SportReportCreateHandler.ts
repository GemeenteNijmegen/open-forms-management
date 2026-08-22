import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { resolveReportDateRange, resolveReportDistricts } from './SportReportRequestValidation';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { resolveAllowedDistricts } from '../../SportDistrictAuthorization';
import { SportReportStore } from '../store/SportReportStore';

function parseFormBody(body: string | undefined, isBase64Encoded: boolean): URLSearchParams {
  if (!body) {
    return new URLSearchParams();
  }
  return new URLSearchParams(isBase64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body);
}

/**
 * Handles `POST /sport/overzichten`: validates the request, writes a QUEUED report, invokes the worker
 * asynchronously (`InvocationType: 'Event'`) and redirects immediately - it never waits for the worker.
 */
export class SportReportCreateHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly reportStore: SportReportStore,
    private readonly lambdaClient: LambdaClient,
    private readonly auditTrail: AuditTrail,
    private readonly workerFunctionName: string,
  ) { }

  async handleRequest(identity: EmployeeIdentity, body: string | undefined, isBase64Encoded: boolean): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, { resource: 'sport', action: 'view' });
    if (denied) {
      return denied;
    }

    const form = parseFormBody(body, isBase64Encoded);
    const allowedDistricts = resolveAllowedDistricts(context.evaluator);
    const requestedDistricts = resolveReportDistricts(form.getAll('district'), allowedDistricts);
    const dateRange = requestedDistricts ? resolveReportDateRange(form.get('from') ?? '', form.get('to') ?? '') : undefined;

    if (!requestedDistricts || !dateRange) {
      logger.info('Sport report request rejected: invalid districts or date range');
      return Response.redirect('/sport/overzichten?status=invalid', 303);
    }

    const existing = await this.reportStore.findMatchingActive(requestedDistricts, dateRange.from, dateRange.to);
    if (existing) {
      return Response.redirect('/sport/overzichten?status=duplicate', 303);
    }

    const report = await this.reportStore.createQueued({
      districts: requestedDistricts,
      from: dateRange.from,
      to: dateRange.to,
      requestedBy: identity.email ?? identity.principalId,
    });

    await recordAudit(this.auditTrail, {
      eventType: 'SPORT_EXCEL_REQUESTED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'sport',
      action: 'request_report',
      ...(identity.email ? { actorEmail: identity.email } : {}),
      metadata: { reportId: report.reportId, districts: report.districts.join(','), from: report.from, to: report.to },
    });

    try {
      await this.lambdaClient.send(new InvokeCommand({
        FunctionName: this.workerFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ reportId: report.reportId })),
      }));
    } catch (error) {
      logger.error('Failed to invoke SportExcelWorker', { reportId: report.reportId, reason: errorReason(error) });
      await this.reportStore.markFailed(report.reportId, 'WORKER_START_ERROR');
      return Response.redirect('/sport/overzichten?status=worker_start_error', 303);
    }

    return Response.redirect('/sport/overzichten?status=queued', 303);
  }
}
