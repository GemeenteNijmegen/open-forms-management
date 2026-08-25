import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationContext } from '../../../shared/authorization/AuthorizationContext';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../shared/security/csrf/CsrfProtection';
import { CaseMutationResult } from '../cases/WoonbehoefteCaseRepository';
import { sanitizeWoonbehoefteFilterQuery } from '../overview/WoonbehoefteOverviewFilter';

export const WOONBEHOEFTE_MANAGE_CHECK = { resource: 'woonbehoefte', action: 'manage' } as const;

export interface WoonbehoefteActionRequest {
  context: AuthorizationContext;
  form: URLSearchParams;
  expectedVersion: number;
  /** Sanitized overview-filter query string carried through from a hidden `back` field; never trust it raw, see `sanitizeWoonbehoefteFilterQuery`. */
  back: string;
}

/**
 * The shared prologue every case-mutation POST handler needs: `manage`, CSRF, and a numeric
 * `expectedVersion` hidden field to guard the optimistic-locked write. Returns a 40x response the
 * handler should return as-is when any of those checks fail, or the parsed request when they pass.
 */
export async function beginWoonbehoefteAction(
  authorizationService: AuthorizationService, identity: EmployeeIdentity, cookieHeader: string | undefined,
  body: string | undefined, isBase64Encoded: boolean,
): Promise<WoonbehoefteActionRequest | ApiGatewayV2Response> {
  const context = await authorizationService.loadContext(identity);
  const denied = await authorizationService.requireAuthorization(context, WOONBEHOEFTE_MANAGE_CHECK);
  if (denied) {
    return denied;
  }

  const form = parseFormBody(body, isBase64Encoded);
  if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
    return authorizationService.denyAccess(context, WOONBEHOEFTE_MANAGE_CHECK);
  }

  const expectedVersionRaw = Number(form.get('expectedVersion'));
  if (!Number.isInteger(expectedVersionRaw)) {
    return Response.error(400);
  }

  return { context, form, expectedVersion: expectedVersionRaw, back: sanitizeWoonbehoefteFilterQuery(form.get('back') ?? undefined) };
}

export function isActionRejected(result: WoonbehoefteActionRequest | ApiGatewayV2Response): result is ApiGatewayV2Response {
  return 'statusCode' in result;
}

/** `back`, if given, must already be sanitized (`sanitizeWoonbehoefteFilterQuery`) - this never trusts a raw query string. */
export function redirectToWoonbehoefteCase(
  caseReference: string, options: { status?: string; back?: string; saved?: string } = {},
): ApiGatewayV2Response {
  const params = new URLSearchParams();
  if (options.status) {
    params.set('status', options.status);
  }
  if (options.back) {
    params.set('back', options.back);
  }
  if (options.saved) {
    params.set('saved', options.saved);
  }
  const query = params.toString();
  return Response.redirect(`/woonbehoefte/cases/${encodeURIComponent(caseReference)}${query ? `?${query}` : ''}`, 303);
}

export function redirectAfterMutation(caseReference: string, result: CaseMutationResult, back?: string, saved?: string): ApiGatewayV2Response {
  return redirectToWoonbehoefteCase(
    caseReference, { status: result === 'STALE_VERSION' ? 'stale' : undefined, back, ...(result === 'OK' ? { saved } : {}) },
  );
}
