import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { isReportAvailable } from '../domain/WoonbehoefteReport';
import { WoonbehoefteReportStore } from '../store/WoonbehoefteReportStore';

const PRESIGN_EXPIRY_SECONDS = 60;
const WOONBEHOEFTE_EXCELOVERZICHT_CHECK = { resource: 'woonbehoefte', action: 'exceloverzicht' } as const;

/**
 * Handles GET /woonbehoefte/overzichten/{reportId}/download. Any medewerker with exceloverzicht may
 * download any report, not maker-only: Woonbehoefte has no scope dimension to check a report against,
 * unlike Sport's district-based access.
 */
export class WoonbehoefteReportDownloadHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly reportStore: WoonbehoefteReportStore,
    private readonly s3Client: S3Client,
    private readonly auditTrail: AuditTrail,
    private readonly bucketName: string,
  ) { }

  async handleRequest(identity: EmployeeIdentity, reportId: string): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_EXCELOVERZICHT_CHECK);
    if (denied) {
      return denied;
    }

    const report = await this.reportStore.get(reportId);
    if (!report || !isReportAvailable(report) || report.status !== 'READY' || !report.storageKey) {
      return Response.error(404);
    }

    await recordAudit(this.auditTrail, {
      eventType: 'WOONBEHOEFTE_EXCEL_DOWNLOADED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'woonbehoefte',
      action: 'download_report',
      ...(identity.email ? { actorEmail: identity.email } : {}),
      metadata: { reportId },
    });

    const url = await getSignedUrl(
      this.s3Client,
      new GetObjectCommand({ Bucket: this.bucketName, Key: report.storageKey }),
      { expiresIn: PRESIGN_EXPIRY_SECONDS },
    );
    return Response.redirect(url, 302);
  }
}
