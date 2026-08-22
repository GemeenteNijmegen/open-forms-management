import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { resolveAllowedDistricts } from '../../sportdata/SportDistrictAuthorization';
import { isReportAvailable } from '../store/SportReport';
import { SportReportStore } from '../store/SportReportStore';

const PRESIGN_EXPIRY_SECONDS = 60;

/**
 * Handles `GET /sport/overzichten/{reportId}/download`. Authorization is re-checked against the
 * report's own districts, not the medewerker's general Sport access, exactly like `SportPdfDownloadHandler`.
 */
export class SportReportDownloadHandler {
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
    if (!report || !isReportAvailable(report) || report.status !== 'READY' || !report.storageKey) {
      return Response.error(404);
    }

    const allowedDistricts = new Set<string>(resolveAllowedDistricts(context.evaluator));
    if (!report.districts.every((district) => allowedDistricts.has(district))) {
      return Response.error(403);
    }

    await recordAudit(this.auditTrail, {
      eventType: 'SPORT_EXCEL_DOWNLOADED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'sport',
      action: 'download_report',
      ...(identity.email ? { actorEmail: identity.email } : {}),
      metadata: { reportId, districts: report.districts.join(','), from: report.from, to: report.to },
    });

    const url = await getSignedUrl(
      this.s3Client,
      new GetObjectCommand({ Bucket: this.bucketName, Key: report.storageKey }),
      { expiresIn: PRESIGN_EXPIRY_SECONDS },
    );
    return Response.redirect(url, 302);
  }
}
