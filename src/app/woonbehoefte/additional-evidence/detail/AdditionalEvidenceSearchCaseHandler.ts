import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../../shared/security/csrf/CsrfProtection';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

/**
 * Handles `POST /woonbehoefte/additional-evidence/{submissionId}/search-case`. Never writes anything: it
 * only carries the searched kenmerk into a redirect back to the detail page, which performs the actual
 * (read-only) lookup itself. That keeps the lookup always-fresh - a search result is never trusted from
 * an earlier request, and a koppeling later re-validates the target independently again.
 */
export class AdditionalEvidenceSearchCaseHandler {
  constructor(private readonly authorizationService: AuthorizationService) { }

  async handleRequest(
    identity: EmployeeIdentity, submissionId: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    const form = parseFormBody(body, isBase64Encoded);
    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      return this.authorizationService.denyAccess(context, WOONBEHOEFTE_VIEW_CHECK);
    }

    const searchCaseReference = (form.get('searchCaseReference') ?? '').trim();
    const query = new URLSearchParams({ searchCaseReference });
    return Response.redirect(`/woonbehoefte/additional-evidence/${submissionId}?${query.toString()}`, 303);
  }
}
