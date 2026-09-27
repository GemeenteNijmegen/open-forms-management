import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { positionInOrder } from './domain/Ranking';
import { RankingStore } from './RankingStore';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditEventType } from '../../../shared/audit/AuditEvent';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../shared/security/csrf/CsrfProtection';
import { sanitizeWoonbehoefteFilterQuery } from '../overview/WoonbehoefteOverviewFilter';

const WOONBEHOEFTE_MANAGE_CHECK = { resource: 'woonbehoefte', action: 'manage' } as const;
const RANKING_FRAGMENT = 'rangschikking';

interface RankingActionRequest {
  form: URLSearchParams;
  expectedRevision: number;
  back: string;
}

function redirect(caseReference: string, params: Record<string, string>): ApiGatewayV2Response {
  const query = new URLSearchParams(params).toString();
  return Response.redirect(`/woonbehoefte/cases/${encodeURIComponent(caseReference)}${query ? `?${query}` : ''}#${RANKING_FRAGMENT}`, 303);
}

/**
 * Handles the three ranking-mutation POST routes on the detail page: invoegen, verplaatsen en
 * verwijderen. Single POST + 303 redirect + banner, same pattern as every other case action (see
 * WoonbehoefteActionSupport); no separate confirmation page.
 */
export class RankingActionHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly rankingStore: RankingStore,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleInsert(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await this.begin(identity, cookieHeader, body, isBase64Encoded);
    if ('statusCode' in begun) {
      return begun;
    }
    const { form, expectedRevision, back } = begun;
    const position = Number(form.get('position'));
    if (!Number.isInteger(position)) {
      return Response.error(400);
    }
    const actorEmail = identity.email ?? identity.principalId;

    const result = await this.rankingStore.insert(caseReference, position, actorEmail, expectedRevision);
    if (result !== 'OK') {
      return redirect(caseReference, { back, rankingStatus: 'stale' });
    }

    await this.audit('WOONBEHOEFTE_RANKING_INSERTED', 'insert', actorEmail, caseReference, form.get('note'), { newPosition: position });
    return redirect(caseReference, { back, rankingSaved: 'insert' });
  }

  async handleMove(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await this.begin(identity, cookieHeader, body, isBase64Encoded);
    if ('statusCode' in begun) {
      return begun;
    }
    const { form, expectedRevision, back } = begun;
    const position = Number(form.get('position'));
    if (!Number.isInteger(position)) {
      return Response.error(400);
    }
    const actorEmail = identity.email ?? identity.principalId;

    const currentList = await this.rankingStore.getCurrentList();
    const fromPosition = currentList ? positionInOrder(currentList.orderedCaseReferences, caseReference) : undefined;

    const result = await this.rankingStore.move(caseReference, position, actorEmail, expectedRevision);
    if (result !== 'OK') {
      return redirect(caseReference, { back, rankingStatus: 'stale' });
    }

    await this.audit(
      'WOONBEHOEFTE_RANKING_MOVED', 'move', actorEmail, caseReference, form.get('note'),
      { ...(fromPosition !== undefined ? { oldPosition: fromPosition } : {}), newPosition: position },
    );
    return redirect(caseReference, { back, rankingSaved: 'move' });
  }

  async handleRemove(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await this.begin(identity, cookieHeader, body, isBase64Encoded);
    if ('statusCode' in begun) {
      return begun;
    }
    const { form, expectedRevision, back } = begun;
    const actorEmail = identity.email ?? identity.principalId;

    const currentList = await this.rankingStore.getCurrentList();
    const fromPosition = currentList ? positionInOrder(currentList.orderedCaseReferences, caseReference) : undefined;

    const result = await this.rankingStore.remove(caseReference, actorEmail, expectedRevision);
    if (result !== 'OK') {
      return redirect(caseReference, { back, rankingStatus: 'stale' });
    }

    await this.audit(
      'WOONBEHOEFTE_RANKING_REMOVED', 'remove', actorEmail, caseReference, form.get('note'),
      fromPosition !== undefined ? { oldPosition: fromPosition } : {},
    );
    return redirect(caseReference, { back, rankingSaved: 'remove' });
  }

  private async begin(
    identity: EmployeeIdentity, cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean,
  ): Promise<RankingActionRequest | ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_MANAGE_CHECK);
    if (denied) {
      return denied;
    }

    const form = parseFormBody(body, isBase64Encoded);
    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      return this.authorizationService.denyAccess(context, WOONBEHOEFTE_MANAGE_CHECK);
    }

    const expectedRevision = Number(form.get('expectedRevision'));
    if (!Number.isInteger(expectedRevision)) {
      return Response.error(400);
    }

    return { form, expectedRevision, back: sanitizeWoonbehoefteFilterQuery(form.get('back') ?? undefined) };
  }

  private async audit(
    eventType: AuditEventType, action: string, actorEmail: string, caseReference: string, note: string | null, positions: Record<string, number>,
  ): Promise<void> {
    const trimmedNote = note?.trim();
    await recordAudit(this.auditTrail, {
      eventType,
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'woonbehoefte-ranking',
      action,
      actorEmail,
      metadata: { caseReference, ...positions, ...(trimmedNote ? { note: trimmedNote } : {}) },
    });
  }
}
