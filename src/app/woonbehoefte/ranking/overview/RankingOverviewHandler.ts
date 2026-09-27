import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { resolveRankingOverviewFilter } from './RankingOverviewFilter';
import { buildRankingOverviewViewModel } from './RankingOverviewViewModel';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../../shared/rendering/Renderer';
import { visiblePermissionsFeature } from '../../../permissions/PermissionsNavigationFeature';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { joinCasesWithSources } from '../../overview/WoonbehoefteOverviewViewModel';
import { ProjectDetailsWorkVersion } from '../../project-details/domain/ProjectDetails';
import { ProjectDetailsStore } from '../../project-details/persistence/ProjectDetailsStore';
import { fetchWoonbehoefteReportProjectDetails } from '../../reports/projectdetails/fetchWoonbehoefteReportProjectDetails';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import rankingOverviewTemplate from '../../templates/woonbehoefte-ranking-overview.mustache';
import { buildWoonbehoefteTabs } from '../../WoonbehoefteTabs';
import { RankingStore } from '../RankingStore';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;
const WOONBEHOEFTE_EXCELOVERZICHT_CHECK = { resource: 'woonbehoefte', action: 'exceloverzicht' } as const;

/**
 * Handles GET /woonbehoefte/ranking: a compact, read-only, unfiltered (besides "Ranking vanaf") list of
 * every dossier in rank order. Unlike the Aanvragen overview or the detail page, ranking is this page's
 * entire purpose, so a ranking read failure shows an explicit error instead of silently rendering
 * everyone as unranked. A projectdetails-werkversie read failure is not central to this page and degrades
 * to the source projectName for every row instead, same posture as elsewhere in the app.
 */
export class RankingOverviewHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly sourceCacheStore: WoonbehoefteSourceCacheStore,
    private readonly rankingStore: RankingStore,
    private readonly projectDetailsStore: ProjectDetailsStore,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, queryStringParameters: Record<string, string | undefined> | undefined,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    const canExcelOverview = context.evaluator.evaluate(WOONBEHOEFTE_EXCELOVERZICHT_CHECK) === 'ALLOW';
    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const page = { title: 'Woonbehoefte - Ranking', features, currentPath: '/woonbehoefte/ranking', actorEmail: identity.email };
    const tabs = buildWoonbehoefteTabs('ranking', true, canExcelOverview);

    let rankByCaseReference: Map<string, number>;
    try {
      const rankingList = await this.rankingStore.getCurrentList();
      rankByCaseReference = new Map(rankingList?.orderedCaseReferences.map((caseReference, index) => [caseReference, index + 1]) ?? []);
    } catch (error) {
      logger.error('Ranking kon niet worden gelezen voor het rankingtabblad', { reason: errorReason(error) });
      const html = render(rankingOverviewTemplate, page, { tabs, rankingUnavailable: true, rows: [], hasRows: false, totalCountLabel: '0 aanvragen' });
      return Response.html(html);
    }

    const [cases, { submissions }] = await Promise.all([this.caseRepository.listCases(), this.sourceCacheStore.readReadySubmissions()]);
    const entries = joinCasesWithSources(cases, submissions);

    let workVersionsByCaseReference = new Map<string, ProjectDetailsWorkVersion>();
    try {
      workVersionsByCaseReference = await fetchWoonbehoefteReportProjectDetails(this.projectDetailsStore, entries);
    } catch (error) {
      logger.error('Projectdetails-werkversies konden niet worden gelezen voor het rankingtabblad', { reason: errorReason(error) });
    }

    const filter = resolveRankingOverviewFilter(queryStringParameters);
    const viewModel = buildRankingOverviewViewModel(entries, rankByCaseReference, workVersionsByCaseReference, filter);

    const html = render(rankingOverviewTemplate, page, { ...viewModel, tabs });
    return Response.html(html);
  }
}
