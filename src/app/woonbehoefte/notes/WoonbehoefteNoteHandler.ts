import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../shared/security/csrf/CsrfProtection';
import { redirectToWoonbehoefteCase, WOONBEHOEFTE_MANAGE_CHECK } from '../actions/WoonbehoefteActionSupport';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { CaseNoteCategory } from '../domain/WoonbehoefteCase';
import { sanitizeWoonbehoefteFilterQuery } from '../overview/WoonbehoefteOverviewFilter';

const NOTE_CATEGORIES: readonly string[] = ['GENERAL', 'CONTACT', 'ASSESSMENT', 'ADDITIONAL_INFORMATION', 'ADMISSIBILITY', 'CHECK'];

function isNoteCategory(value: string | null): value is CaseNoteCategory {
  return value !== null && NOTE_CATEGORIES.includes(value);
}

/**
 * Handles `POST /woonbehoefte/cases/{caseReference}/notes`. Notes are append-only: no
 * `version`/`expectedVersion` here, since a note never overwrites anything already on the case.
 */
export class WoonbehoefteNoteHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }

    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_MANAGE_CHECK);
    if (denied) {
      return denied;
    }

    const form = parseFormBody(body, isBase64Encoded);
    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      return this.authorizationService.denyAccess(context, WOONBEHOEFTE_MANAGE_CHECK);
    }

    const category = form.get('category');
    const text = form.get('text')?.trim();
    const back = sanitizeWoonbehoefteFilterQuery(form.get('back') ?? undefined);
    if (!isNoteCategory(category) || !text) {
      return Response.error(400);
    }

    const existingCase = await this.caseRepository.getCase(caseReference);
    if (!existingCase) {
      return Response.error(404);
    }

    const actorEmail = identity.email ?? identity.principalId;
    const note = await this.caseRepository.addNote(caseReference, actorEmail, category, text);

    // Note text never leaves this table: centrale audit only records that one was added, not what it says.
    await recordAudit(this.auditTrail, {
      eventType: 'WOONBEHOEFTE_NOTE_ADDED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'woonbehoefte',
      action: 'note_add',
      actorEmail,
      metadata: { caseReference, category, noteId: note.noteId },
    });

    return redirectToWoonbehoefteCase(caseReference, { back, saved: 'note' });
  }
}
