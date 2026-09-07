import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../../shared/rendering/Renderer';
import { visiblePermissionsFeature } from '../../../permissions/PermissionsNavigationFeature';
import overviewTemplate from '../templates/woonbehoefte-additional-evidence-overview.mustache';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

/**
 * Handles `GET /woonbehoefte/additional-evidence`. There is no Additional Evidence source data yet (the
 * sync worker doesn't fetch anything yet), so the overview always renders empty. The route, tab
 * navigation and permission gate are the real, final shape.
 */
export class AdditionalEvidenceOverviewHandler {
  constructor(private readonly authorizationService: AuthorizationService) { }

  async handleRequest(identity: EmployeeIdentity): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      overviewTemplate,
      { title: 'Woonbehoefte - Extra bewijzen', features, currentPath: '/woonbehoefte', actorEmail: identity.email },
    );
    return Response.html(html, 200);
  }
}
