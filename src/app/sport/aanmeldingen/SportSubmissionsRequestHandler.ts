import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { buildSportSubmissionsFromCache } from './buildSportSubmissionsFromCache';
import { resolveSportFilter } from './SportFilter';
import { paginateSportSubmissions } from './SportSubmissionsOrdering';
import { buildSportSubmissionsFragmentViewModel } from './SportViewModel';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { withCorrelationId } from '../../../observability/withCorrelationId';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { renderFragment } from '../../../shared/rendering/Renderer';
import { SportCacheStore } from '../cache/SportCacheStore';
import { isStaleRefresh } from '../cache/SportRefreshState';
import { resolveAllowedDistricts } from '../sportdata/SportDistrictAuthorization';
import sportSubmissionsTemplate from '../templates/sport-submissions.mustache';

const RETRY_AFTER_SECONDS = 2;

function waitingForRefresh(): ApiGatewayV2Response {
  return { ...Response.ok(202), headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) } };
}

/**
 * Handles `GET /sport/submissions`: reads the cache and returns the server-rendered submissions fragment.
 * Never downloads a CSV from Open Zaak itself; that only happens in `SportCacheWorker`.
 */
export class SportSubmissionsRequestHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly cacheStore: SportCacheStore,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, queryStringParameters: Record<string, string | undefined> | undefined, correlationId: string,
  ): Promise<ApiGatewayV2Response> {
    const startedAt = Date.now();
    const context = await this.authorizationService.loadContext(identity);
    const permissionCheck = { resource: 'sport', action: 'view' } as const;
    const denied = await this.authorizationService.requireAuthorization(context, permissionCheck);
    if (denied) {
      return withCorrelationId(denied, correlationId);
    }

    const allowedDistricts = resolveAllowedDistricts(context.evaluator);
    const filter = resolveSportFilter(queryStringParameters, allowedDistricts);

    const now = new Date();
    const state = await this.cacheStore.getState();
    if (state?.status === 'REFRESHING' && !isStaleRefresh(state, now)) {
      logger.debug('Sport submissions request waiting for an active refresh', { runId: state.runId });
      return withCorrelationId(waitingForRefresh(), correlationId);
    }

    let cachedSubmissions;
    let failedMarkers;
    try {
      ({ submissions: cachedSubmissions, failedMarkers } = await this.cacheStore.readActiveItems(now));
    } catch (error) {
      logger.error('Sport cache read failed', { reason: errorReason(error) });
      return withCorrelationId(Response.error(500), correlationId);
    }

    const submissions = buildSportSubmissionsFromCache(cachedSubmissions, filter.districts, filter.types);
    const page = paginateSportSubmissions(submissions, queryStringParameters?.cursor);
    const staleWarning = state?.status === 'FAILED';

    const viewModel = buildSportSubmissionsFragmentViewModel(page, staleWarning, failedMarkers);
    const html = renderFragment(sportSubmissionsTemplate, viewModel);

    logger.debug('Sport submissions fragment finished', {
      cacheCount: cachedSubmissions.length,
      filteredCount: submissions.length,
      resultCount: page.submissions.length,
      hasMore: page.hasMore,
      staleWarning,
      failedCount: failedMarkers.length,
      durationMs: Date.now() - startedAt,
    });
    return withCorrelationId(Response.html(html), correlationId);
  }
}
