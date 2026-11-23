import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../shared/rendering/Renderer';
import { CSRF_FORM_FIELD, issueCsrfToken } from '../../../shared/security/csrf/CsrfProtection';
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

    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const csrfToken = issueCsrfToken();
    const html = render(
      esfTemplate,
      { title: 'ESF-controle', features, currentPath: '/esf', actorEmail: identity.email },
      { csrfField: CSRF_FORM_FIELD, csrfToken: csrfToken.value },
    );
    return Response.html(html, 200, csrfToken.cookie);
  }
}
