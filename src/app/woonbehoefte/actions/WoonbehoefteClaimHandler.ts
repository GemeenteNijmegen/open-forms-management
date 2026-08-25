import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { beginWoonbehoefteAction, isActionRejected, redirectAfterMutation } from './WoonbehoefteActionSupport';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditEventType } from '../../../shared/audit/AuditEvent';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';

type ClaimAction = 'claim' | 'release' | 'takeOver';

const AUDIT_EVENT_BY_ACTION: Record<ClaimAction, AuditEventType> = {
  claim: 'WOONBEHOEFTE_CASE_CLAIMED', release: 'WOONBEHOEFTE_CASE_RELEASED', takeOver: 'WOONBEHOEFTE_CASE_TAKEN_OVER',
};

const SAVED_MARKER_BY_ACTION: Record<ClaimAction, string> = {
  claim: 'claim', release: 'release', takeOver: 'take-over',
};

/**
 * Handles `POST /woonbehoefte/cases/{caseReference}/claim|release|take-over`. A claim is organisatorisch,
 * not an authorization lock: any `woonbehoefte:manage` medewerker may claim, release or take over any
 * case, regardless of who currently holds it.
 */
export class WoonbehoefteClaimHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleRequest(
    action: ClaimAction, identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
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

    const actorEmail = identity.email ?? identity.principalId;
    const existingCase = await this.caseRepository.getCase(caseReference);
    if (!existingCase) {
      return Response.error(404);
    }

    const result = action === 'claim'
      ? await this.caseRepository.claim(caseReference, actorEmail, expectedVersion, existingCase.status)
      : action === 'release'
        ? await this.caseRepository.release(caseReference, actorEmail, expectedVersion)
        : await this.caseRepository.takeOver(caseReference, actorEmail, expectedVersion, existingCase.claimedBy);

    if (result === 'OK') {
      await recordAudit(this.auditTrail, {
        eventType: AUDIT_EVENT_BY_ACTION[action],
        outcome: 'SUCCESS',
        correlationId: xRayTraceId(),
        resource: 'woonbehoefte',
        action,
        actorEmail,
        metadata: { caseReference },
      });
    }

    return redirectAfterMutation(caseReference, result, back, SAVED_MARKER_BY_ACTION[action]);
  }
}
