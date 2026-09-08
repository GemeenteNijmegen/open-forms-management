import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../../shared/rendering/Renderer';
import { visiblePermissionsFeature } from '../../../permissions/PermissionsNavigationFeature';
import { buildWoonbehoefteTabs } from '../../WoonbehoefteTabs';
import overviewTemplate from '../templates/woonbehoefte-reports-overview.mustache';

const WOONBEHOEFTE_EXCELOVERZICHT_CHECK = { resource: 'woonbehoefte', action: 'exceloverzicht' } as const;
const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

/** Handles GET /woonbehoefte/overzichten. Report list/aanvragen komt in een latere handler; dit rendert de lege pagina met tabs. */
export class WoonbehoefteReportsOverviewHandler {
  constructor(private readonly authorizationService: AuthorizationService) { }

  async handleRequest(identity: EmployeeIdentity): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_EXCELOVERZICHT_CHECK);
    if (denied) {
      return denied;
    }

    const canView = context.evaluator.evaluate(WOONBEHOEFTE_VIEW_CHECK) === 'ALLOW';
    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      overviewTemplate,
      { title: 'Woonbehoefte - Excel-overzichten', features, currentPath: '/woonbehoefte/overzichten', actorEmail: identity.email },
      { tabs: buildWoonbehoefteTabs('exceloverzichten', canView, true) },
    );
    return Response.html(html);
  }
}
