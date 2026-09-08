import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { buildWoonbehoefteReportRequestFormViewModel, buildWoonbehoefteReportsListViewModel } from './WoonbehoefteReportsViewModel';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../../shared/rendering/Renderer';
import { issueCsrfToken } from '../../../../shared/security/csrf/CsrfProtection';
import { visiblePermissionsFeature } from '../../../permissions/PermissionsNavigationFeature';
import { buildWoonbehoefteTabs } from '../../WoonbehoefteTabs';
import { WoonbehoefteReportStore } from '../store/WoonbehoefteReportStore';
import overviewTemplate from '../templates/woonbehoefte-reports-overview.mustache';

const WOONBEHOEFTE_EXCELOVERZICHT_CHECK = { resource: 'woonbehoefte', action: 'exceloverzicht' } as const;
const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

/** Keyed by the ?status= redirect marker WoonbehoefteReportCreateHandler sets on success/failure. */
const FLASH_MESSAGES: Record<string, string> = {
  queued: 'Het Excel-overzicht wordt op de achtergrond gemaakt. Ververs deze pagina zo nu en dan om de status te controleren.',
  duplicate: 'Er loopt al een opdracht met dezelfde filters en opties. Ververs deze pagina om de status te controleren.',
  worker_start_error: 'Het overzicht kon niet gestart worden. Probeer het opnieuw.',
};

/** Handles GET /woonbehoefte/overzichten: tabs, het aanvraagformulier, de rapportenlijst en hun CSRF-token. */
export class WoonbehoefteReportsOverviewHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly reportStore: WoonbehoefteReportStore,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, queryStringParameters: Record<string, string | undefined> | undefined,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_EXCELOVERZICHT_CHECK);
    if (denied) {
      return denied;
    }

    const canView = context.evaluator.evaluate(WOONBEHOEFTE_VIEW_CHECK) === 'ALLOW';
    const csrf = issueCsrfToken();
    const reports = await this.reportStore.listRecent();
    const listViewModel = buildWoonbehoefteReportsListViewModel(reports);
    const requestFormViewModel = buildWoonbehoefteReportRequestFormViewModel();
    const status = queryStringParameters?.status;

    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      overviewTemplate,
      { title: 'Woonbehoefte - Excel-overzichten', features, currentPath: '/woonbehoefte/overzichten', actorEmail: identity.email },
      {
        ...listViewModel,
        ...requestFormViewModel,
        tabs: buildWoonbehoefteTabs('exceloverzichten', canView, true),
        csrfToken: csrf.value,
        ...(status && FLASH_MESSAGES[status] ? { message: FLASH_MESSAGES[status] } : {}),
      },
    );
    return Response.html(html, 200, csrf.cookie);
  }
}
