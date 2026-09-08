import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { AdditionalEvidenceSourceCacheStore } from '../additional-evidence/source/AdditionalEvidenceSourceCacheStore';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { SourceDocumentReference } from '../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../source/WoonbehoefteSourceCacheStore';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;
const PRESIGN_EXPIRY_SECONDS = 60;

/** Satisfied by both a `WoonbehoefteSourceItem` and an `AdditionalEvidenceSourceItem`: only the two document fields are ever needed here. */
interface DownloadableDocumentSource {
  pdfDocument?: SourceDocumentReference;
  attachments?: SourceDocumentReference[];
}

/**
 * Only `pdfDocument`/`attachments` are ever offered for download; the CSV export itself is a sync input,
 * not a medewerker document. Searches READY and FAILED sources alike: a FAILED source (CSV parse/fetch
 * error) can still carry a `pdfDocument`/`attachments` it kept from a valid Object envelope. Searches
 * PRIMARY and ADDITIONAL sources alike: a gekoppelde extra-bewijzeninzending's document is downloadable
 * through this same case-scoped route once it is linked, see `AdditionalEvidenceCaseDocumentsLoader`.
 */
function findDownloadableDocument(sources: DownloadableDocumentSource[], documentId: string): SourceDocumentReference | undefined {
  for (const source of sources) {
    const candidates = [...(source.pdfDocument ? [source.pdfDocument] : []), ...(source.attachments ?? [])];
    const match = candidates.find((document) => document.documentId === documentId);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_\-.]/g, '_');
}

/**
 * Handles `GET /woonbehoefte/cases/{caseReference}/documents/{documentId}`. The browser only ever
 * supplies `caseReference`/`documentId`; the backend resolves the real Open Zaak URL itself from the
 * case's own source links, and refuses anything not actually linked to this case (document IDOR
 * protection). Never trusts a browser-supplied Open Zaak URL.
 *
 * The Open Zaak bytes never go back through API Gateway/Lambda as the response body: a large document
 * would hit the payload limit and the medewerker's browser would see a bare 500. Instead the content is
 * staged in a private, short-lived S3 bucket and the medewerker gets redirected to a 60-second presigned
 * GetObject URL, the same pattern `SportReportDownloadHandler` already uses.
 */
export class WoonbehoefteDocumentDownloadHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly sourceCacheStore: WoonbehoefteSourceCacheStore,
    private readonly openZaakClient: OpenZaakClient,
    private readonly auditTrail: AuditTrail,
    private readonly s3Client: S3Client,
    private readonly bucketName: string,
    private readonly additionalSourceCacheStore: AdditionalEvidenceSourceCacheStore,
  ) { }

  async handleRequest(identity: EmployeeIdentity, caseReference: string | undefined, documentId: string | undefined): Promise<ApiGatewayV2Response> {
    if (!caseReference || !documentId) {
      return Response.error(400);
    }

    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    const caseItems = await this.caseRepository.getCaseItems(caseReference);
    if (!caseItems.woonbehoefteCase) {
      return Response.error(404);
    }

    const primarySubmissionIds = caseItems.sourceLinks.filter((link) => link.relation === 'PRIMARY').map((link) => link.submissionId);
    const additionalSubmissionIds = caseItems.sourceLinks.filter((link) => link.relation === 'ADDITIONAL').map((link) => link.submissionId);
    const [primarySourceItems, additionalSourceItems] = await Promise.all([
      this.sourceCacheStore.getItems(primarySubmissionIds),
      this.additionalSourceCacheStore.getItems(additionalSubmissionIds),
    ]);
    const sources: DownloadableDocumentSource[] = [...primarySourceItems.values(), ...additionalSourceItems.values()];

    const document = findDownloadableDocument(sources, documentId);
    if (!document) {
      logger.info('Woonbehoefte document download rejected: document not linked to this case', { caseReference, documentId });
      return Response.error(404);
    }

    let content;
    try {
      content = await this.openZaakClient.getDocumentContent(document.url, identity);
    } catch (error) {
      logger.warn('Woonbehoefte document fetch failed', { caseReference, documentId, reason: errorReason(error) });
      return Response.error(404);
    }

    // Best-effort: a real filename/content-type is friendlier than a UUID, but never blocks the download itself.
    let filename = `${sanitizeFilenameSegment(caseReference)}-${sanitizeFilenameSegment(documentId)}`;
    let contentType = 'application/octet-stream';
    try {
      const metadata = await this.openZaakClient.getDocumentMetadata(document.url, identity);
      filename = metadata.bestandsnaam ? sanitizeFilenameSegment(metadata.bestandsnaam) : filename;
      contentType = metadata.formaat ?? contentType;
    } catch (error) {
      logger.warn('Woonbehoefte document metadata fetch failed, falling back to a generic filename', { caseReference, documentId, reason: errorReason(error) });
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
      logger.error('Woonbehoefte document staging in temporary download bucket failed', { caseReference, documentId, reason: errorReason(error) });
      return Response.error(500);
    }

    // Semantics: the download was authorized and a temporary URL was issued, not that the browser received every byte.
    await recordAudit(this.auditTrail, {
      eventType: 'WOONBEHOEFTE_DOCUMENT_DOWNLOADED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'woonbehoefte',
      action: 'download_document',
      ...(identity.email ? { actorEmail: identity.email } : {}),
      metadata: { caseReference, documentId },
    });

    return Response.redirect(url, 302);
  }
}
