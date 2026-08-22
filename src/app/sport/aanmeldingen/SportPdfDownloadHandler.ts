import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { z } from 'zod';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { ObjectsClient } from '../../../shared/clients/objects/ObjectsClient';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { OpenZaakDocumentContent } from '../../../shared/clients/open-zaak/OpenZaakResponse';
import { isValidUuid } from '../../../shared/clients/utils/format';
import { parseSportSubmission } from '../sportdata/parseSportSubmission';
import { SPORT_FORM_NAME } from '../sportdata/SportObjectsQuery';

const sportPdfObjectDataSchema = z.looseObject({
  formName: z.string(),
  reference: z.string(),
  csv: z.string(),
  pdf: z.string().optional(),
});

/**
 * Handles `GET /sport/submissions/{objectUuid}/pdf`. Loads and authorizes the Sportinzending the same
 * way the overview does (object -> CSV -> district), but for one object and against the district of
 * that specific submission, not the medewerker's full allowed-districts list: a link to one download
 * only works for a medewerker who is actually allowed to see that submission's district.
 */
export class SportPdfDownloadHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly objectsClient: ObjectsClient,
    private readonly openZaakClient: OpenZaakClient,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleRequest(identity: EmployeeIdentity, objectUuid: string | undefined): Promise<ApiGatewayV2Response> {
    const requestStartedAt = Date.now();

    if (!objectUuid || !isValidUuid(objectUuid)) {
      logger.info('Sport PDF request rejected: invalid objectUuid');
      return Response.error(400);
    }

    const context = await this.authorizationService.loadContext(identity);

    const objectStartedAt = Date.now();
    let objectData: unknown;
    try {
      const object = await this.objectsClient.getObjectByUuid(objectUuid);
      objectData = object.record.data;
    } catch (error) {
      logger.warn('Sport PDF object fetch failed', { objectUuid, reason: errorReason(error) });
      return Response.error(404);
    }
    logger.debug('Sport PDF object fetch finished', { objectUuid, durationMs: Date.now() - objectStartedAt });

    const parsedData = sportPdfObjectDataSchema.safeParse(objectData);
    if (!parsedData.success || parsedData.data.formName !== SPORT_FORM_NAME) {
      logger.info('Sport PDF request rejected: not a Sport object', { objectUuid });
      return Response.error(404);
    }

    const csvStartedAt = Date.now();
    let csvText: string;
    try {
      csvText = await this.openZaakClient.getDocumentText(parsedData.data.csv, identity);
    } catch (error) {
      logger.warn('Sport PDF CSV fetch failed', { objectUuid, reason: errorReason(error) });
      return Response.error(404);
    }
    logger.debug('Sport PDF CSV fetch finished', { objectUuid, durationMs: Date.now() - csvStartedAt });

    const parseStartedAt = Date.now();
    let district: string;
    try {
      district = parseSportSubmission(csvText, parsedData.data.reference).district;
    } catch (error) {
      logger.warn('Sport PDF CSV parsing failed', { objectUuid, reason: errorReason(error) });
      return Response.error(404);
    }
    logger.debug('Sport PDF district resolved', { objectUuid, durationMs: Date.now() - parseStartedAt });

    const authStartedAt = Date.now();
    const permissionCheck = { resource: 'sport', action: 'view', scope: { districts: district } } as const;
    const denied = await this.authorizationService.requireAuthorization(context, permissionCheck);
    logger.debug('Sport PDF authorization evaluated', { objectUuid, durationMs: Date.now() - authStartedAt });
    if (denied) {
      return denied;
    }

    if (!parsedData.data.pdf) {
      logger.info('Sport PDF request rejected: object has no pdf reference', { objectUuid });
      return Response.error(404);
    }

    const pdfStartedAt = Date.now();
    let content: OpenZaakDocumentContent;
    try {
      content = await this.openZaakClient.getDocumentContent(parsedData.data.pdf, identity);
    } catch (error) {
      logger.error('Sport PDF fetch failed', { objectUuid, reason: errorReason(error) });
      return Response.error(500);
    }
    logger.debug('Sport PDF fetch finished', {
      objectUuid, durationMs: Date.now() - pdfStartedAt, byteCount: content.body.byteLength,
    });

    const documentUuid = extractDocumentUuid(parsedData.data.pdf);
    const responseStartedAt = Date.now();
    const response = buildPdfDownloadResponse(content.body, parsedData.data.reference, objectUuid);
    logger.debug('Sport PDF response built', { objectUuid, durationMs: Date.now() - responseStartedAt });

    const auditStartedAt = Date.now();
    await recordAudit(this.auditTrail, {
      eventType: 'SPORT_PDF_DOWNLOADED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'sport',
      action: 'download_pdf',
      ...(identity.email ? { actorEmail: identity.email } : {}),
      metadata: { objectUuid, ...(documentUuid ? { documentUuid } : {}) },
    });
    logger.debug('Sport PDF audit written', { objectUuid, durationMs: Date.now() - auditStartedAt });

    logger.debug('Sport PDF request finished', { objectUuid, documentUuid, durationMs: Date.now() - requestStartedAt });
    return response;
  }
}

/** Open Zaak document URLs end in `.../enkelvoudiginformatieobjecten/{uuid}`; the UUID is the document's own identifier. */
function extractDocumentUuid(documentUrl: string): string | undefined {
  const segment = documentUrl.replace(/\/$/, '').split('/').pop() ?? '';
  return isValidUuid(segment) ? segment : undefined;
}

function buildPdfDownloadResponse(body: Uint8Array, reference: string, objectUuid: string): ApiGatewayV2Response {
  const filenameSegment = sanitizeFilenameSegment(reference) || sanitizeFilenameSegment(objectUuid);
  return {
    statusCode: 200,
    isBase64Encoded: true,
    body: Buffer.from(body).toString('base64'),
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="sportaanmelding-${filenameSegment}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  };
}

/** Keeps a header value safe without pulling in personal data: only the characters a Kenmerk/UUID actually uses. */
function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '');
}
