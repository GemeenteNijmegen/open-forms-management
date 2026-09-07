import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { buildAdditionalEvidenceLinkNoteText } from './AdditionalEvidenceLinkNoteText';
import { AdditionalEvidenceLinkRepository } from './AdditionalEvidenceLinkRepository';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../../shared/security/csrf/CsrfProtection';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { isReadyAdditionalEvidenceSource } from '../domain/AdditionalEvidenceSource';
import { sanitizeAdditionalEvidenceFilterQuery } from '../overview/AdditionalEvidenceOverviewFilter';
import { AdditionalEvidenceRepository } from '../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../source/AdditionalEvidenceSourceCacheStore';

const WOONBEHOEFTE_MANAGE_CHECK = { resource: 'woonbehoefte', action: 'manage' } as const;

type LinkOutcome = 'linked' | 'conflict' | 'failed';

/**
 * Handles `POST /woonbehoefte/additional-evidence/{submissionId}/link`. The zoek-hoofdzaak search result is
 * UX only, never trusted here: the workitem, the target case and this submission's own source (needed for
 * the automatic note text and documentCount) are all re-read and re-validated before the atomic link
 * transaction is even attempted.
 */
export class AdditionalEvidenceLinkHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly repository: AdditionalEvidenceRepository,
    private readonly sourceCacheStore: AdditionalEvidenceSourceCacheStore,
    private readonly primaryCaseRepository: WoonbehoefteCaseRepository,
    private readonly linkRepository: AdditionalEvidenceLinkRepository,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, submissionId: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_MANAGE_CHECK);
    if (denied) {
      return denied;
    }
    if (!submissionId) {
      return Response.error(400);
    }

    const form = parseFormBody(body, isBase64Encoded);
    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      return this.authorizationService.denyAccess(context, WOONBEHOEFTE_MANAGE_CHECK);
    }

    const backQuery = sanitizeAdditionalEvidenceFilterQuery(form.get('back') ?? undefined);
    const targetCaseReference = (form.get('targetCaseReference') ?? '').trim();
    if (!targetCaseReference) {
      return Response.error(400);
    }

    const workItem = await this.repository.getWorkItem(submissionId);
    if (!workItem) {
      return Response.error(404);
    }
    // Already LINKED (by this or another request) since the medewerker last saw this page: a conflict, not a fresh precondition failure.
    if (workItem.status === 'LINKED') {
      return this.redirect(submissionId, 'conflict', backQuery);
    }

    const targetCase = await this.primaryCaseRepository.getCase(targetCaseReference);
    if (!targetCase) {
      return this.redirect(submissionId, 'failed', backQuery);
    }

    const sourceItems = await this.sourceCacheStore.getItems([submissionId]);
    const source = sourceItems.get(submissionId);
    if (!source || !isReadyAdditionalEvidenceSource(source)) {
      return this.redirect(submissionId, 'failed', backQuery);
    }

    const actorEmail = identity.email ?? identity.principalId;
    const noteText = buildAdditionalEvidenceLinkNoteText(workItem.submissionReference, source.evidenceDescription, source.remarks);
    const result = await this.linkRepository.link(submissionId, workItem.submissionReference, targetCaseReference, noteText, actorEmail);
    if (result === 'CONFLICT') {
      return this.redirect(submissionId, 'conflict', backQuery);
    }

    const documentCount = (source.pdfDocument ? 1 : 0) + source.attachments.length;
    await recordAudit(this.auditTrail, {
      eventType: 'WOONBEHOEFTE_ADDITIONAL_EVIDENCE_LINKED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'woonbehoefte',
      action: 'additional_evidence_link',
      actorEmail,
      metadata: { additionalSubmissionReference: workItem.submissionReference, submissionId, caseReference: targetCaseReference, documentCount },
    });

    return this.redirect(submissionId, 'linked', backQuery);
  }

  private redirect(submissionId: string, outcome: LinkOutcome, backQuery: string): ApiGatewayV2Response {
    const params = new URLSearchParams();
    if (backQuery) {
      params.set('back', backQuery);
    }
    if (outcome === 'linked') {
      params.set('saved', 'linked');
    } else {
      params.set('linkError', outcome);
    }
    const query = params.toString();
    // #koppelen: same reasoning as the search-case redirect, land back on the koppelen-blok, not the top of the page.
    return Response.redirect(`/woonbehoefte/additional-evidence/${submissionId}?${query}#koppelen`, 303);
  }
}
