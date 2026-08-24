import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { isReadySource, SourceDocumentReference, WoonbehoefteSourceRecord } from '../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../source/WoonbehoefteSourceCacheStore';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

/** Only these roles are ever offered for download; the CSV export itself is a sync input, not a medewerker document. */
function findDownloadableDocument(sources: WoonbehoefteSourceRecord[], documentId: string): SourceDocumentReference | undefined {
  for (const source of sources) {
    const candidates = [...(source.pdfDocument ? [source.pdfDocument] : []), ...source.attachments];
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
 */
export class WoonbehoefteDocumentDownloadHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly sourceCacheStore: WoonbehoefteSourceCacheStore,
    private readonly openZaakClient: OpenZaakClient,
    private readonly auditTrail: AuditTrail,
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

    const submissionIds = caseItems.sourceLinks.map((link) => link.submissionId);
    const sourceItems = await this.sourceCacheStore.getItems(submissionIds);
    const sources = [...sourceItems.values()].filter(isReadySource);

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

    await recordAudit(this.auditTrail, {
      eventType: 'WOONBEHOEFTE_DOCUMENT_DOWNLOADED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'woonbehoefte',
      action: 'download_document',
      ...(identity.email ? { actorEmail: identity.email } : {}),
      metadata: { caseReference, documentId },
    });

    return {
      statusCode: 200,
      isBase64Encoded: true,
      body: Buffer.from(content.body).toString('base64'),
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    };
  }
}
