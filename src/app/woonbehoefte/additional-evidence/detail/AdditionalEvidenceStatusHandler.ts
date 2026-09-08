import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../../shared/security/csrf/CsrfProtection';
import { sanitizeAdditionalEvidenceFilterQuery } from '../overview/AdditionalEvidenceOverviewFilter';
import { AdditionalEvidenceChangeableStatus, AdditionalEvidenceRepository, AdditionalEvidenceStatusChangeResult } from '../persistence/AdditionalEvidenceRepository';

const WOONBEHOEFTE_MANAGE_CHECK = { resource: 'woonbehoefte', action: 'manage' } as const;
const CHANGEABLE_STATUSES: AdditionalEvidenceChangeableStatus[] = ['NEW', 'UNKNOWN'];

function isChangeableStatus(value: string): value is AdditionalEvidenceChangeableStatus {
  return (CHANGEABLE_STATUSES as string[]).includes(value);
}

/**
 * Handles `POST /woonbehoefte/additional-evidence/{submissionId}/status`. Only NEW and UNKNOWN are ever
 * accepted as a target: LINKED is refused here, and `AdditionalEvidenceRepository.changeStatus` refuses it
 * again on the write itself, so a stale request can never move an already-gekoppeld workitem back.
 */
export class AdditionalEvidenceStatusHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly repository: AdditionalEvidenceRepository,
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

    const targetStatus = form.get('status');
    if (!targetStatus || !isChangeableStatus(targetStatus)) {
      return Response.error(400);
    }

    const backQuery = sanitizeAdditionalEvidenceFilterQuery(form.get('back') ?? undefined);
    const outcome = await this.repository.changeStatus(submissionId, targetStatus);
    if (outcome.result === 'NOT_FOUND') {
      return Response.error(404);
    }

    if (outcome.result === 'OK') {
      await recordAudit(this.auditTrail, {
        eventType: 'WOONBEHOEFTE_ADDITIONAL_EVIDENCE_STATUS_CHANGED',
        outcome: 'SUCCESS',
        correlationId: xRayTraceId(),
        resource: 'woonbehoefte',
        action: 'additional_evidence_status_change',
        actorEmail: identity.email ?? identity.principalId,
        metadata: { submissionReference: outcome.submissionReference, fromStatus: outcome.fromStatus, toStatus: targetStatus },
      });
    }

    return this.redirect(submissionId, outcome.result, backQuery);
  }

  private redirect(submissionId: string, result: AdditionalEvidenceStatusChangeResult, backQuery: string): ApiGatewayV2Response {
    const params = new URLSearchParams();
    if (backQuery) {
      params.set('back', backQuery);
    }
    if (result === 'OK' || result === 'NOOP') {
      params.set('saved', 'status');
    }
    if (result === 'LINKED') {
      params.set('status', 'linked-conflict');
    }
    const query = params.toString();
    return Response.redirect(`/woonbehoefte/additional-evidence/${submissionId}${query ? `?${query}` : ''}`, 303);
  }
}
