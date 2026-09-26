import { ApiGatewayV2Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationContext } from '../../../../shared/authorization/AuthorizationContext';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../../shared/security/csrf/CsrfProtection';
import { sanitizeWoonbehoefteFilterQuery } from '../../overview/WoonbehoefteOverviewFilter';

export const PROJECT_DETAILS_MANAGE_CHECK = { resource: 'woonbehoefte', action: 'manage' } as const;

export interface ProjectDetailsActionRequest {
  context: AuthorizationContext;
  form: URLSearchParams;
  back: string;
}

/**
 * Zelfde `manage`/CSRF-proloog als `beginWoonbehoefteAction`, maar zonder `expectedVersion`: de werkversie
 * heeft bewust geen generieke optimistic locking, alleen last-write-wins per onderdeel (zie besluitenlog).
 */
export async function beginProjectDetailsAction(
  authorizationService: AuthorizationService, identity: EmployeeIdentity, cookieHeader: string | undefined,
  body: string | undefined, isBase64Encoded: boolean,
): Promise<ProjectDetailsActionRequest | ApiGatewayV2Response> {
  const context = await authorizationService.loadContext(identity);
  const denied = await authorizationService.requireAuthorization(context, PROJECT_DETAILS_MANAGE_CHECK);
  if (denied) {
    return denied;
  }

  const form = parseFormBody(body, isBase64Encoded);
  if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
    return authorizationService.denyAccess(context, PROJECT_DETAILS_MANAGE_CHECK);
  }

  return { context, form, back: sanitizeWoonbehoefteFilterQuery(form.get('back') ?? undefined) };
}

export function isProjectDetailsActionRejected(
  result: ProjectDetailsActionRequest | ApiGatewayV2Response,
): result is ApiGatewayV2Response {
  return 'statusCode' in result;
}
