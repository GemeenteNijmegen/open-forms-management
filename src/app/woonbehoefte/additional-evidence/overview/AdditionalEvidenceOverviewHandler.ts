import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { resolveAdditionalEvidenceOverviewFilter, serializeAdditionalEvidenceOverviewFilter } from './AdditionalEvidenceOverviewFilter';
import { buildAdditionalEvidenceOverviewViewModel, joinWorkItemsWithSources } from './AdditionalEvidenceOverviewViewModel';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../../shared/rendering/Renderer';
import { issueCsrfToken } from '../../../../shared/security/csrf/CsrfProtection';
import { visiblePermissionsFeature } from '../../../permissions/PermissionsNavigationFeature';
import { buildWoonbehoefteTabs } from '../../WoonbehoefteTabs';
import { AdditionalEvidenceSourceItem } from '../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceRepository } from '../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../source/AdditionalEvidenceSourceCacheStore';
import overviewTemplate from '../templates/woonbehoefte-additional-evidence-overview.mustache';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;
const WOONBEHOEFTE_EXCELOVERZICHT_CHECK = { resource: 'woonbehoefte', action: 'exceloverzicht' } as const;

/** Handles `GET /woonbehoefte/additional-evidence`. A normal read, so no ACCESS_GRANTED audit. */
export class AdditionalEvidenceOverviewHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly repository: AdditionalEvidenceRepository,
    private readonly sourceCacheStore: AdditionalEvidenceSourceCacheStore,
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
    const filter = resolveAdditionalEvidenceOverviewFilter(queryStringParameters);
    const csrf = issueCsrfToken();

    const [workItems, { submissions, failedMarkers }, refreshState] = await Promise.all([
      this.repository.listWorkItems(),
      this.sourceCacheStore.readReadySubmissions(),
      this.sourceCacheStore.getState(),
    ]);

    const sourceItems = new Map<string, AdditionalEvidenceSourceItem>();
    for (const item of [...submissions, ...failedMarkers]) {
      sourceItems.set(item.objectUuid, item);
    }

    const entries = joinWorkItemsWithSources(workItems, sourceItems);
    const backQuery = serializeAdditionalEvidenceOverviewFilter(filter);
    const viewModel = buildAdditionalEvidenceOverviewViewModel(entries, filter, backQuery);

    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      overviewTemplate,
      { title: 'Woonbehoefte - Extra bewijzen', features, currentPath: '/woonbehoefte', actorEmail: identity.email },
      {
        ...viewModel,
        tabs: buildWoonbehoefteTabs('additional-evidence', true, canExcelOverview),
        csrfToken: csrf.value,
        backQuery,
        isRefreshing: refreshState?.status === 'REFRESHING',
        refreshStarted: queryStringParameters?.refresh === 'started',
        refreshAlreadyRunning: queryStringParameters?.refresh === 'already-running',
        refreshFailed: queryStringParameters?.refresh === 'failed',
      },
    );
    return Response.html(html, 200, csrf.cookie);
  }
}
