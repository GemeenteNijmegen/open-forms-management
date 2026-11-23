import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { buildEsfViewModel, EsfViewInput } from './EsfViewModel';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../shared/authorization/PermissionEvaluator';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../shared/rendering/Renderer';
import { issueCsrfToken } from '../../../shared/security/csrf/CsrfProtection';
import { visiblePermissionsFeature } from '../../permissions/PermissionsNavigationFeature';
import esfTemplate from '../templates/esf.mustache';

export const ESF_VIEW_CHECK = { resource: 'esf', action: 'view' } as const;

export class EsfPageHandler {
  constructor(private readonly authorizationService: AuthorizationService) { }

  async handleRequest(identity: EmployeeIdentity): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, ESF_VIEW_CHECK);
    if (denied) {
      return denied;
    }
    return renderEsfPage(identity, context.evaluator, {}, 200);
  }
}

// Search results contain clientnummer and dossiernummer, so no response of this page may be cached.
export function renderEsfPage(
  identity: EmployeeIdentity, evaluator: PermissionEvaluator, input: Omit<EsfViewInput, 'csrfToken'>, statusCode: number,
): ApiGatewayV2Response {
  const features = [...visibleFeatures(REGISTERED_FEATURES, evaluator), ...visiblePermissionsFeature(evaluator)];
  const csrfToken = issueCsrfToken();
  const html = render(
    esfTemplate,
    { title: 'ESF-controle', features, currentPath: '/esf', actorEmail: identity.email },
    buildEsfViewModel({ ...input, csrfToken: csrfToken.value }),
  );
  const response = Response.html(html, statusCode, csrfToken.cookie);
  return { ...response, headers: { ...response.headers, 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache' } };
}
