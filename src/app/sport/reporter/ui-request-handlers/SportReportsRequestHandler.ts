import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { buildSportReportsViewModel } from './SportReportsViewModel';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../../shared/rendering/Renderer';
import { visiblePermissionsFeature } from '../../../permissions/PermissionsNavigationFeature';
import { resolveAllowedDistricts } from '../../sportdata/SportDistrictAuthorization';
import { currentSportSeasonStart } from '../../sportdata/SportSeason';
import sportReportsTemplate from '../../templates/sport-reports.mustache';
import { SportReportStore } from '../store/SportReportStore';

const FLASH_MESSAGES: Record<string, string> = {
  queued: 'Het Excel-overzicht wordt op de achtergrond gemaakt. Gebruik de knop Overzichten opnieuw laden om de status te controleren.',
  duplicate: 'Er loopt al een opdracht met dezelfde wijken en periode. Gebruik de knop Overzichten opnieuw laden om de status te controleren.',
  invalid: 'Kies minimaal één wijk en een geldige periode (van mag niet na tot liggen).',
  worker_start_error: 'Het overzicht kon niet gestart worden. Probeer het opnieuw.',
};

/** Handles `GET /sport/overzichten`: the reporter's own list/form page, no reportdata generation here. */
export class SportReportsRequestHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly reportStore: SportReportStore,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, queryStringParameters: Record<string, string | undefined> | undefined,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, { resource: 'sport', action: 'view' });
    if (denied) {
      return denied;
    }

    const allowedDistricts = resolveAllowedDistricts(context.evaluator);
    const reports = await this.reportStore.listRecent();

    const now = new Date();
    const defaults = {
      from: queryStringParameters?.from ?? currentSportSeasonStart(now),
      to: queryStringParameters?.to ?? now.toISOString().slice(0, 10),
    };
    const message = queryStringParameters?.status ? FLASH_MESSAGES[queryStringParameters.status] : undefined;

    const viewModel = buildSportReportsViewModel(reports, allowedDistricts, defaults, message);
    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      sportReportsTemplate,
      { title: 'Sport - Excel-overzichten', features, currentPath: '/sport', actorEmail: identity.email },
      { ...viewModel, isOverzichtenTab: true },
    );
    return Response.html(html);
  }
}
