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
import { deriveProjectDetailsBatchDisplayStatus, ProjectDetailsBatchState } from '../project-details/domain/ProjectDetails';
import { ProjectDetailsStore } from '../project-details/persistence/ProjectDetailsStore';
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

    const [cases, { submissions }, refreshState, projectDetailsBatchState] = await Promise.all([
      this.caseRepository.listCases(),
      this.sourceCacheStore.readReadySubmissions(),
      this.sourceCacheStore.getState(),
      projectDetailsBatchStatePromise,
    ]);

    const batchDisplayStatus = deriveProjectDetailsBatchDisplayStatus(projectDetailsBatchState);

    const entries = joinCasesWithSources(cases, submissions);
    // Same actor-id fallback as every mutation handler uses for claimedBy, so "Door mij" also works for an identity without an email.
    const actorId = identity.email ?? identity.principalId;
    const viewModel = buildWoonbehoefteOverviewViewModel(entries, filter, actorId);

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
        projectDetailsBatchCutoff: batchDisplayStatus === 'CUTOFF',
        ...(batchDisplayStatus && batchDisplayStatus !== 'RUNNING' && batchDisplayStatus !== 'STALE_RUNNING'
          ? {
            projectDetailsBatchDone: true,
            projectDetailsBatchHasErrors: batchDisplayStatus === 'READY_WITH_ERRORS' || batchDisplayStatus === 'CUTOFF',
            projectDetailsBatchCreated: projectDetailsBatchState?.created ?? 0,
            projectDetailsBatchSkipped: projectDetailsBatchState?.skipped ?? 0,
            projectDetailsBatchFailed: projectDetailsBatchState?.failed ?? 0,
          }
          : {}),
        ...(viewModel.hasMore
          ? { nextHref: `/woonbehoefte?${serializeWoonbehoefteOverviewFilter({ ...filter, visibleCount: viewModel.nextVisibleCount! })}` }
          : {}),
      },
    );

    return Response.html(html, 200, csrf.cookie);
  }
}
