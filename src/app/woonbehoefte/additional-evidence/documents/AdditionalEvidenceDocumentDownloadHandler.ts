import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { SourceDocumentReference } from '../../domain/WoonbehoefteSource';
import { AdditionalEvidenceSourceItem } from '../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceRepository } from '../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../source/AdditionalEvidenceSourceCacheStore';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;
const PRESIGN_EXPIRY_SECONDS = 60;

/** Only `pdfDocument`/`attachments` are ever offered for download; the CSV export itself is never a medewerker document. */
function findDownloadableDocument(source: AdditionalEvidenceSourceItem, documentId: string): SourceDocumentReference | undefined {
  const candidates = [...(source.pdfDocument ? [source.pdfDocument] : []), ...(source.attachments ?? [])];
  return candidates.find((document) => document.documentId === documentId);
}

function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_\-.]/g, '_');
}

/**
 * Handles `GET /woonbehoefte/additional-evidence/{submissionId}/documents/{documentId}`. The browser only
 * ever supplies `submissionId`/`documentId`; the backend resolves the real Open Zaak URL itself from that
 * submission's own source record, and refuses anything not actually linked to this submission (document
 * IDOR protection). Never trusts a browser-supplied Open Zaak URL. Same staged-download-via-temporary-S3
 * pattern as the primary Woonbehoefte document download.
 */
export class AdditionalEvidenceDocumentDownloadHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly repository: AdditionalEvidenceRepository,
    private readonly sourceCacheStore: AdditionalEvidenceSourceCacheStore,
    private readonly openZaakClient: OpenZaakClient,
    private readonly auditTrail: AuditTrail,
    private readonly s3Client: S3Client,
    private readonly bucketName: string,
  ) { }

  async handleRequest(identity: EmployeeIdentity, submissionId: string | undefined, documentId: string | undefined): Promise<ApiGatewayV2Response> {
    if (!submissionId || !documentId) {
      return Response.error(400);
    }

    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    const workItem = await this.repository.getWorkItem(submissionId);
    if (!workItem) {
      return Response.error(404);
    }

    const sourceItems = await this.sourceCacheStore.getItems([submissionId]);
    const source = sourceItems.get(submissionId);
    const document = source && findDownloadableDocument(source, documentId);
    if (!document) {
      logger.info('Additional Evidence document download rejected: document not linked to this submission', { submissionId, documentId });
      return Response.error(404);
    }

    let content;
    try {
      content = await this.openZaakClient.getDocumentContent(document.url, identity);
    } catch (error) {
      logger.warn('Additional Evidence document fetch failed', { submissionId, documentId, reason: errorReason(error) });
      return Response.error(404);
    }

    let filename = `${sanitizeFilenameSegment(workItem.submissionReference)}-${sanitizeFilenameSegment(documentId)}`;
    let contentType = 'application/octet-stream';
    try {
      const metadata = await this.openZaakClient.getDocumentMetadata(document.url, identity);
      filename = metadata.bestandsnaam ? sanitizeFilenameSegment(metadata.bestandsnaam) : filename;
      contentType = metadata.formaat ?? contentType;
    } catch (error) {
      logger.warn('Additional Evidence document metadata fetch failed, falling back to a generic filename', { submissionId, documentId, reason: errorReason(error) });
    }

    const key = `downloads/${documentId}`;
    let url: string;
    try {
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: content.body,
        ContentType: contentType,
        ContentDisposition: `attachment; filename="${filename}"`,
        CacheControl: 'private, no-store',
      }));
      url = await getSignedUrl(
        this.s3Client, new GetObjectCommand({ Bucket: this.bucketName, Key: key }), { expiresIn: PRESIGN_EXPIRY_SECONDS },
      );
    } catch (error) {
      logger.error('Additional Evidence document staging in temporary download bucket failed', { submissionId, documentId, reason: errorReason(error) });
      return Response.error(500);
    }

    await recordAudit(this.auditTrail, {
      eventType: 'WOONBEHOEFTE_DOCUMENT_DOWNLOADED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'woonbehoefte',
      action: 'download_document',
      ...(identity.email ? { actorEmail: identity.email } : {}),
      metadata: { submissionReference: workItem.submissionReference, documentId },
    });

    return Response.redirect(url, 302);
  }
}
