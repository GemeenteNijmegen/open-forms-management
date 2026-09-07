import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../../shared/rendering/Renderer';
import { issueCsrfToken } from '../../../../shared/security/csrf/CsrfProtection';
import { visiblePermissionsFeature } from '../../../permissions/PermissionsNavigationFeature';
import { formatDutchDateTime } from '../../domain/WoonbehoefteFormatting';
import { AdditionalEvidenceRepository, AdditionalEvidenceWorkItem } from '../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../source/AdditionalEvidenceSourceCacheStore';
import overviewTemplate from '../templates/woonbehoefte-additional-evidence-overview.mustache';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

const STATUS_LABELS: Record<AdditionalEvidenceWorkItem['status'], string> = {
  NEW: 'Nieuw',
  UNKNOWN: 'Onbekend',
  LINKED: 'Gekoppeld',
};

interface AdditionalEvidenceOverviewRow {
  submissionReference: string;
  statusLabel: string;
  originalCaseReferenceLabel: string;
  submittedAtLabel: string;
}

function buildRow(workItem: AdditionalEvidenceWorkItem): AdditionalEvidenceOverviewRow {
  return {
    submissionReference: workItem.submissionReference,
    statusLabel: STATUS_LABELS[workItem.status],
    originalCaseReferenceLabel: workItem.originalCaseReference ?? '-',
    submittedAtLabel: workItem.submittedAt ? formatDutchDateTime(workItem.submittedAt) : '-',
  };
}

/**
 * Handles `GET /woonbehoefte/additional-evidence`. Minimal listing only: proves ingestion actually
 * happened (reference, opgegeven hoofdzaakkenmerk, inzenddatum, status). Filtering, uitklapbare details,
 * projectnaam en de koppelinteractie are not built here yet.
 */
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

    const csrf = issueCsrfToken();
    const [workItems, refreshState] = await Promise.all([
      this.repository.listWorkItems(),
      this.sourceCacheStore.getState(),
    ]);

    const rows = workItems
      .slice()
      .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))
      .map(buildRow);

    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      overviewTemplate,
      { title: 'Woonbehoefte - Extra bewijzen', features, currentPath: '/woonbehoefte', actorEmail: identity.email },
      {
        rows,
        hasRows: rows.length > 0,
        csrfToken: csrf.value,
        isRefreshing: refreshState?.status === 'REFRESHING',
        refreshStarted: queryStringParameters?.refresh === 'started',
        refreshAlreadyRunning: queryStringParameters?.refresh === 'already-running',
        refreshFailed: queryStringParameters?.refresh === 'failed',
      },
    );
    return Response.html(html, 200, csrf.cookie);
  }
}
