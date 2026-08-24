import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { beginWoonbehoefteAction, isActionRejected, redirectAfterMutation } from '../actions/WoonbehoefteActionSupport';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { CaseCheck } from '../domain/WoonbehoefteCase';

const CHECK_OUTCOMES: readonly string[] = ['OK', 'CHANGES_NEEDED'];

function isCheckOutcome(value: string | null): value is NonNullable<CaseCheck['lastOutcome']> {
  return value !== null && CHECK_OUTCOMES.includes(value);
}

/**
 * Handles `POST /woonbehoefte/cases/{caseReference}/check/request|complete`. A check is independent of
 * the main status and has no vierogenprincipe: any `woonbehoefte:manage` medewerker may complete a check
 * they requested themselves.
 */
export class WoonbehoefteCheckHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleRequest(
    handling: 'request' | 'complete', identity: EmployeeIdentity, caseReference: string | undefined,
    cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await beginWoonbehoefteAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isActionRejected(begun)) {
      return begun;
    }
    const { form, expectedVersion, back } = begun;
    const actorEmail = identity.email ?? identity.principalId;

    const outcome = form.get('outcome');
    if (handling === 'complete' && !isCheckOutcome(outcome)) {
      return Response.error(400);
    }

    // The optional toelichting is written in the same transaction as the check mutation itself
    // (WoonbehoefteCaseRepository), so a failed check mutation can never leave an orphan note behind.
    const noteText = form.get('note')?.trim() || undefined;

    if (handling === 'request') {
      const result = await this.caseRepository.requestCheck(caseReference, actorEmail, expectedVersion, noteText);
      if (result === 'OK') {
        await recordAudit(this.auditTrail, {
          eventType: 'WOONBEHOEFTE_CHECK_REQUESTED',
          outcome: 'SUCCESS',
          correlationId: xRayTraceId(),
          resource: 'woonbehoefte',
          action: 'check_request',
          actorEmail,
          metadata: { caseReference },
        });
      }
      return redirectAfterMutation(caseReference, result, back, 'check-requested');
    }

    const checkOutcome = outcome as NonNullable<CaseCheck['lastOutcome']>;
    const result = await this.caseRepository.completeCheck(caseReference, actorEmail, expectedVersion, checkOutcome, noteText);
    if (result === 'OK') {
      await recordAudit(this.auditTrail, {
        eventType: 'WOONBEHOEFTE_CHECK_COMPLETED',
        outcome: 'SUCCESS',
        correlationId: xRayTraceId(),
        resource: 'woonbehoefte',
        action: 'check_complete',
        actorEmail,
        metadata: { caseReference, checkOutcome },
      });
    }
    return redirectAfterMutation(caseReference, result, back, 'check-completed');
  }
}
