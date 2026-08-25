import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { beginWoonbehoefteAction, isActionRejected, redirectAfterMutation } from './WoonbehoefteActionSupport';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { isCaseStatus } from '../domain/CaseStatus';

/**
 * Handles `POST /woonbehoefte/cases/{caseReference}/status`: a broadly-allowed status change.
 * `INADMISSIBLE` is refused here on purpose: only `confirmInadmissible` may set it, and only from
 * `PROPOSED_INADMISSIBLE`, a two-step flow that needs no other actor.
 */
export class WoonbehoefteStatusHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleChangeStatus(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await beginWoonbehoefteAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isActionRejected(begun)) {
      return begun;
    }
    const { form, expectedVersion, back } = begun;

    const targetStatus = form.get('status');
    if (!targetStatus || !isCaseStatus(targetStatus) || targetStatus === 'INADMISSIBLE') {
      return Response.error(400);
    }

    const existingCase = await this.caseRepository.getCase(caseReference);
    if (!existingCase) {
      return Response.error(404);
    }

    if (targetStatus === existingCase.status) {
      return redirectAfterMutation(caseReference, 'OK', back);
    }

    const actorEmail = identity.email ?? identity.principalId;
    if (targetStatus === 'PROPOSED_INADMISSIBLE') {
      const motivering = form.get('motivering')?.trim();
      if (!motivering) {
        return Response.error(400);
      }
      const result = await this.caseRepository.proposeInadmissible(caseReference, actorEmail, expectedVersion, existingCase.status, motivering);
      if (result === 'OK') {
        await recordAudit(this.auditTrail, {
          eventType: 'WOONBEHOEFTE_STATUS_CHANGED',
          outcome: 'SUCCESS',
          correlationId: xRayTraceId(),
          resource: 'woonbehoefte',
          action: 'status_change',
          actorEmail,
          metadata: { caseReference, fromStatus: existingCase.status, toStatus: targetStatus },
        });
      }
      return redirectAfterMutation(caseReference, result, back, 'status');
    }

    const result = await this.caseRepository.changeStatus(caseReference, actorEmail, expectedVersion, existingCase.status, targetStatus);
    if (result === 'OK') {
      await recordAudit(this.auditTrail, {
        eventType: 'WOONBEHOEFTE_STATUS_CHANGED',
        outcome: 'SUCCESS',
        correlationId: xRayTraceId(),
        resource: 'woonbehoefte',
        action: 'status_change',
        actorEmail,
        metadata: { caseReference, fromStatus: existingCase.status, toStatus: targetStatus },
      });
    }

    return redirectAfterMutation(caseReference, result, back, 'status');
  }

  async handleConfirmInadmissible(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await beginWoonbehoefteAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isActionRejected(begun)) {
      return begun;
    }
    const { expectedVersion, back } = begun;

    const existingCase = await this.caseRepository.getCase(caseReference);
    if (!existingCase) {
      return Response.error(404);
    }
    // The only hard workflow guard in the feature: definitief niet-ontvankelijk requires the proposed step first.
    if (existingCase.status !== 'PROPOSED_INADMISSIBLE') {
      return Response.error(409);
    }

    const actorEmail = identity.email ?? identity.principalId;
    const result = await this.caseRepository.confirmInadmissible(caseReference, actorEmail, expectedVersion, existingCase.check.requested);
    if (result === 'OK') {
      await recordAudit(this.auditTrail, {
        eventType: 'WOONBEHOEFTE_STATUS_CHANGED',
        outcome: 'SUCCESS',
        correlationId: xRayTraceId(),
        resource: 'woonbehoefte',
        action: 'confirm_inadmissible',
        actorEmail,
        metadata: { caseReference, fromStatus: 'PROPOSED_INADMISSIBLE', toStatus: 'INADMISSIBLE' },
      });
    }

    return redirectAfterMutation(caseReference, result, back, 'status');
  }
}
