import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { resolveAllowedDistricts } from '../../SportDistrictAuthorization';
import { SportReportStore } from '../store/SportReportStore';

/**
 * Handles `POST /sport/overzichten/{reportId}/delete`. Not maker-only: any medewerker who currently sees
 * every district in the report (or a Sport/global admin, via the same evaluator) may delete it.
 */
export class SportReportDeleteHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly reportStore: SportReportStore,
    private readonly s3Client: S3Client,
    private readonly auditTrail: AuditTrail,
    private readonly bucketName: string,
  ) { }

  async handleRequest(identity: EmployeeIdentity, reportId: string): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, { resource: 'sport', action: 'view' });
    if (denied) {
      return denied;
    }

    const report = await this.reportStore.get(reportId);
    if (!report) {
      return Response.redirect('/sport/overzichten', 303);
    }

    const allowedDistricts = new Set<string>(resolveAllowedDistricts(context.evaluator));
    if (!report.districts.every((district) => allowedDistricts.has(district))) {
      return Response.error(403);
    }

    if (report.storageKey) {
      try {
        await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: report.storageKey }));
      } catch (error) {
        // A missing/already-deleted object is not a reason to keep the report visible; the status update below still runs.
        logger.warn('Sport report S3 object could not be deleted', { reportId, reason: errorReason(error) });
      }
    }

    await this.reportStore.markDeleted(reportId);
    await recordAudit(this.auditTrail, {
      eventType: 'SPORT_EXCEL_DELETED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'sport',
      action: 'delete_report',
      ...(identity.email ? { actorEmail: identity.email } : {}),
      metadata: { reportId, districts: report.districts.join(','), from: report.from, to: report.to },
    });

    return Response.redirect('/sport/overzichten', 303);
  }
}
