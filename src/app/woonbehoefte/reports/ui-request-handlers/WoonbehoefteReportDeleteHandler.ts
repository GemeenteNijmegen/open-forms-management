import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
import { WoonbehoefteReportStore } from '../store/WoonbehoefteReportStore';

const WOONBEHOEFTE_EXCELOVERZICHT_CHECK = { resource: 'woonbehoefte', action: 'exceloverzicht' } as const;

/**
 * Handles POST /woonbehoefte/overzichten/{reportId}/delete. Not maker-only: any medewerker with
 * exceloverzicht may delete any report, matching the functional requirement that everyone with the
 * permission sees and manages the same report list.
 */
export class WoonbehoefteReportDeleteHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly reportStore: WoonbehoefteReportStore,
    private readonly s3Client: S3Client,
    private readonly auditTrail: AuditTrail,
    private readonly bucketName: string,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, reportId: string, cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean,
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

    const report = await this.reportStore.get(reportId);
    if (!report) {
      return Response.redirect('/woonbehoefte/overzichten', 303);
    }

    if (report.storageKey) {
      try {
        await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: report.storageKey }));
      } catch (error) {
        // A missing/already-deleted object is not a reason to keep the report visible; the status update below still runs.
        logger.warn('Woonbehoefte report S3 object could not be deleted', { reportId, reason: errorReason(error) });
      }
    }

    await this.reportStore.markDeleted(reportId);
    await recordAudit(this.auditTrail, {
      eventType: 'WOONBEHOEFTE_EXCEL_DELETED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'woonbehoefte',
      action: 'delete_report',
      ...(identity.email ? { actorEmail: identity.email } : {}),
      metadata: { reportId },
    });

    return Response.redirect('/woonbehoefte/overzichten', 303);
  }
}
