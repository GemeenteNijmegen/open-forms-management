import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { resolveSportFilter } from './SportFilter';
import { buildSportShellViewModel, formatDutchDate } from './SportViewModel';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../shared/rendering/Renderer';
import { resolveAllowedDistricts } from '../sportdata/SportDistrictAuthorization';
import { sportOverviewVisibleFrom } from '../sportdata/SportOverviewPolicy';
import sportTemplate from '../templates/sport.mustache';

/**
 * Handles `GET /sport`: renders only the shell (tabs, visible-period text, filter form, refresh button and
 * an empty submissions container). The browser's own `sport-submissions.js` fetches the actual list from
 * `/sport/submissions` right after, so this handler never touches Objects or Open Zaak itself.
 */
export class SportRequestHandler {
  constructor(private readonly authorizationService: AuthorizationService) { }

  async handleRequest(identity: EmployeeIdentity, queryStringParameters?: Record<string, string | undefined>): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const permissionCheck = { resource: 'sport', action: 'view' } as const;
    const denied = await this.authorizationService.requireAuthorization(context, permissionCheck);
    if (denied) {
      return denied;
    }
    await this.authorizationService.recordAccessGranted(context, permissionCheck);

    const allowedDistricts = resolveAllowedDistricts(context.evaluator);
    const filter = resolveSportFilter(queryStringParameters, allowedDistricts);
    const visibleFromLabel = formatDutchDate(sportOverviewVisibleFrom(new Date()).toISOString().slice(0, 10));

    const viewModel = buildSportShellViewModel(allowedDistricts, filter, visibleFromLabel);
    const features = visibleFeatures(REGISTERED_FEATURES, context.evaluator);

    const html = render(
      sportTemplate,
      { title: 'Sport', features, currentPath: '/sport', actorEmail: identity.email },
      { ...viewModel, isAanmeldingenTab: true },
    );
    return Response.html(html);
  }
}
