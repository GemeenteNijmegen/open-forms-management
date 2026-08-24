import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { resolveWoonbehoefteOverviewFilter } from './WoonbehoefteOverviewFilter';
import { buildWoonbehoefteOverviewViewModel, joinCasesWithSources } from './WoonbehoefteOverviewViewModel';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../shared/rendering/Renderer';
import { issueCsrfToken } from '../../../shared/security/csrf/CsrfProtection';
import { visiblePermissionsFeature } from '../../permissions/PermissionsNavigationFeature';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteSourceCacheStore } from '../source/WoonbehoefteSourceCacheStore';
import overviewTemplate from '../templates/woonbehoefte-overview.mustache';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;
const WOONBEHOEFTE_MANAGE_CHECK = { resource: 'woonbehoefte', action: 'manage' } as const;

/** Handles `GET /woonbehoefte`: the werkvoorraad overview. A normal read, so no ACCESS_GRANTED audit. */
export class WoonbehoefteOverviewHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly sourceCacheStore: WoonbehoefteSourceCacheStore,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, queryStringParameters: Record<string, string | undefined> | undefined,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    const canManage = context.evaluator.evaluate(WOONBEHOEFTE_MANAGE_CHECK) === 'ALLOW';
    const filter = resolveWoonbehoefteOverviewFilter(queryStringParameters);
    // Every viewer reaches this line with at least woonbehoefte:view, and refresh (unlike case mutations) only needs that.
    const csrf = issueCsrfToken();

    const [cases, { submissions }, refreshState] = await Promise.all([
      this.caseRepository.listCases(),
      this.sourceCacheStore.readReadySubmissions(),
      this.sourceCacheStore.getState(),
    ]);

    const entries = joinCasesWithSources(cases, submissions);
    const offsetRaw = Number(queryStringParameters?.offset);
    const offset = Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    const viewModel = buildWoonbehoefteOverviewViewModel(entries, filter, identity.email, offset);

    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      overviewTemplate,
      { title: 'Woonbehoefte', features, currentPath: '/woonbehoefte', actorEmail: identity.email },
      {
        ...viewModel,
        canManage,
        csrfToken: csrf.value,
        isRefreshing: refreshState?.status === 'REFRESHING',
        refreshStarted: queryStringParameters?.refresh === 'started',
        refreshAlreadyRunning: queryStringParameters?.refresh === 'already-running',
        ...(viewModel.hasMore
          ? { nextHref: `/woonbehoefte?${viewModel.backQuery}${viewModel.backQuery ? '&' : ''}offset=${viewModel.nextOffset}` }
          : {}),
      },
    );

    return Response.html(html, 200, csrf.cookie);
  }
}
