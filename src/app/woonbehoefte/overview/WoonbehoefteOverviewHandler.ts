import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { resolveWoonbehoefteOverviewFilter, serializeWoonbehoefteOverviewFilter } from './WoonbehoefteOverviewFilter';
import { buildWoonbehoefteOverviewViewModel, joinCasesWithSources } from './WoonbehoefteOverviewViewModel';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../shared/rendering/Renderer';
import { issueCsrfToken } from '../../../shared/security/csrf/CsrfProtection';
import { visiblePermissionsFeature } from '../../permissions/PermissionsNavigationFeature';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { formatDutchDateTime } from '../domain/WoonbehoefteFormatting';
import { deriveProjectDetailsBatchDisplayStatus, ProjectDetailsBatchState } from '../project-details/domain/ProjectDetails';
import { ProjectDetailsStore } from '../project-details/persistence/ProjectDetailsStore';
import { RankingStore } from '../ranking/RankingStore';
import { WoonbehoefteSourceCacheStore } from '../source/WoonbehoefteSourceCacheStore';
import overviewTemplate from '../templates/woonbehoefte-overview.mustache';
import { buildWoonbehoefteTabs } from '../WoonbehoefteTabs';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;
const WOONBEHOEFTE_MANAGE_CHECK = { resource: 'woonbehoefte', action: 'manage' } as const;
const WOONBEHOEFTE_EXCELOVERZICHT_CHECK = { resource: 'woonbehoefte', action: 'exceloverzicht' } as const;

/** Handles `GET /woonbehoefte`: the werkvoorraad overview. A normal read, so no ACCESS_GRANTED audit. */
export class WoonbehoefteOverviewHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly sourceCacheStore: WoonbehoefteSourceCacheStore,
    private readonly projectDetailsStore: ProjectDetailsStore,
    private readonly rankingStore: RankingStore,
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
    const canExcelOverview = context.evaluator.evaluate(WOONBEHOEFTE_EXCELOVERZICHT_CHECK) === 'ALLOW';
    const filter = resolveWoonbehoefteOverviewFilter(queryStringParameters);
    // Every viewer reaches this line with at least woonbehoefte:view, and refresh (unlike case mutations) only needs that.
    const csrf = issueCsrfToken();

    // Een leesfout hier mag de rest van het overzicht niet meeslepen: de batchstatus is puur presentatie, geen kernfunctionaliteit.
    const projectDetailsBatchStatePromise = this.projectDetailsStore.getBatchState().catch((error): ProjectDetailsBatchState | undefined => {
      logger.error('Projectdetails: batchstatus kon niet worden gelezen', { reason: errorReason(error) });
      return undefined;
    });
    // Zelfde redenering: een leesfout op de ranking mag het overzicht niet breken, dossiers tonen dan gewoon als ongerangschikt.
    const rankingListPromise = this.rankingStore.getCurrentList().catch((error) => {
      logger.error('Ranking kon niet worden gelezen voor het overzicht', { reason: errorReason(error) });
      return undefined;
    });

    const [cases, { submissions }, refreshState, projectDetailsBatchState, rankingList] = await Promise.all([
      this.caseRepository.listCases(),
      this.sourceCacheStore.readReadySubmissions(),
      this.sourceCacheStore.getState(),
      projectDetailsBatchStatePromise,
      rankingListPromise,
    ]);

    const batchDisplayStatus = deriveProjectDetailsBatchDisplayStatus(projectDetailsBatchState);
    const rankByCaseReference = new Map(rankingList?.orderedCaseReferences.map((caseReference, index) => [caseReference, index + 1]) ?? []);

    const entries = joinCasesWithSources(cases, submissions);
    // Same actor-id fallback as every mutation handler uses for claimedBy, so "Door mij" also works for an identity without an email.
    const actorId = identity.email ?? identity.principalId;
    const viewModel = buildWoonbehoefteOverviewViewModel(entries, filter, actorId, rankByCaseReference);

    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      overviewTemplate,
      { title: 'Woonbehoefte', features, currentPath: '/woonbehoefte', actorEmail: identity.email },
      {
        ...viewModel,
        canManage,
        tabs: buildWoonbehoefteTabs('aanvragen', true, canExcelOverview),
        csrfToken: csrf.value,
        isRefreshing: refreshState?.status === 'REFRESHING',
        refreshStarted: queryStringParameters?.refresh === 'started',
        refreshAlreadyRunning: queryStringParameters?.refresh === 'already-running',
        refreshFailed: queryStringParameters?.refresh === 'failed',
        projectDetailsStarted: queryStringParameters?.projectDetails === 'started',
        projectDetailsFailed: queryStringParameters?.projectDetails === 'failed',
        projectDetailsBatchRunning: batchDisplayStatus === 'RUNNING',
        projectDetailsBatchStale: batchDisplayStatus === 'STALE_RUNNING',
        // CUTOFF/READY_WITH_ERRORS stay a visible alert; a plain READY only gets the closed samenvatting below,
        // never both, so the same counts are never shown twice.
        projectDetailsBatchWarning: batchDisplayStatus === 'CUTOFF' || batchDisplayStatus === 'READY_WITH_ERRORS',
        projectDetailsBatchSummary: batchDisplayStatus === 'READY',
        ...(batchDisplayStatus === 'CUTOFF' ? { projectDetailsBatchCutoff: true } : {}),
        ...((batchDisplayStatus === 'CUTOFF' || batchDisplayStatus === 'READY_WITH_ERRORS' || batchDisplayStatus === 'READY')
          ? {
            projectDetailsBatchCreated: projectDetailsBatchState?.created ?? 0,
            projectDetailsBatchSkipped: projectDetailsBatchState?.skipped ?? 0,
            projectDetailsBatchFailed: projectDetailsBatchState?.failed ?? 0,
            ...(batchDisplayStatus === 'READY' && projectDetailsBatchState?.completedAt
              ? { projectDetailsBatchCompletedAtLabel: formatDutchDateTime(projectDetailsBatchState.completedAt) }
              : {}),
          }
          : {}),
        ...(viewModel.hasMore
          ? {
            nextHref:
              `/woonbehoefte?${serializeWoonbehoefteOverviewFilter({ ...filter, visibleCount: viewModel.nextVisibleCount! })}`
              + `#${viewModel.nextCardAnchorId}`,
          }
          : {}),
      },
    );

    return Response.html(html, 200, csrf.cookie);
  }
}
