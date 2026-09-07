import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import {
  AdditionalEvidenceCaseLookupViewModel, AdditionalEvidenceSourceAvailability,
  buildAdditionalEvidenceCaseLookup, buildAdditionalEvidenceDetailViewModel, emptyCaseLookup,
} from './AdditionalEvidenceDetailViewModel';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { visibleFeatures } from '../../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../../shared/rendering/Renderer';
import { issueCsrfToken } from '../../../../shared/security/csrf/CsrfProtection';
import notFoundTemplate from '../../../home/templates/notFound.mustache';
import { visiblePermissionsFeature } from '../../../permissions/PermissionsNavigationFeature';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { isFailedSource, isReadySource } from '../../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { loadAdditionalEvidenceDocuments } from '../documents/AdditionalEvidenceDocumentsLoader';
import { isFailedAdditionalEvidenceSource, isReadyAdditionalEvidenceSource } from '../domain/AdditionalEvidenceSource';
import { sanitizeAdditionalEvidenceFilterQuery } from '../overview/AdditionalEvidenceOverviewFilter';
import { AdditionalEvidenceRepository } from '../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../source/AdditionalEvidenceSourceCacheStore';
import detailTemplate from '../templates/woonbehoefte-additional-evidence-detail.mustache';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

/**
 * Handles `GET /woonbehoefte/additional-evidence/{submissionId}`. A normal read, so no ACCESS_GRANTED
 * audit. Reads the primary `WoonbehoefteCaseRepository`/`WoonbehoefteSourceCacheStore` for the "zoek
 * hoofdzaak"-lookup only: it never writes to them, and never creates a case there.
 */
export class AdditionalEvidenceDetailHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly repository: AdditionalEvidenceRepository,
    private readonly sourceCacheStore: AdditionalEvidenceSourceCacheStore,
    private readonly openZaakClient: OpenZaakClient,
    private readonly primaryCaseRepository: WoonbehoefteCaseRepository,
    private readonly primarySourceCacheStore: WoonbehoefteSourceCacheStore,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, submissionId: string | undefined, queryStringParameters: Record<string, string | undefined> | undefined,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    if (!submissionId) {
      return Response.error(400);
    }

    const workItem = await this.repository.getWorkItem(submissionId);
    if (!workItem) {
      const html = render(
        notFoundTemplate,
        { title: 'Extra bewijzen niet gevonden', features: [], currentPath: `/woonbehoefte/additional-evidence/${submissionId}`, actorEmail: identity.email },
      );
      return Response.html(html, 404);
    }

    const sourceItems = await this.sourceCacheStore.getItems([submissionId]);
    const item = sourceItems.get(submissionId);
    const source = item && isReadyAdditionalEvidenceSource(item) ? item : undefined;
    const availability: AdditionalEvidenceSourceAvailability = source ? 'READY' : item && isFailedAdditionalEvidenceSource(item) ? 'FAILED' : 'MISSING';

    // A FAILED source can still carry pdfDocument/attachments if the Object envelope itself was valid.
    const documentSource = item && (item.pdfDocument || item.attachments?.length)
      ? { pdfDocument: item.pdfDocument, attachments: item.attachments ?? [] }
      : undefined;
    const documents = documentSource
      ? await loadAdditionalEvidenceDocuments(this.openZaakClient, documentSource, submissionId, identity)
      : [];

    const caseLookup = queryStringParameters?.searchCaseReference !== undefined
      ? await this.lookupCase(queryStringParameters.searchCaseReference)
      : emptyCaseLookup();

    const csrf = issueCsrfToken();
    const backQuery = sanitizeAdditionalEvidenceFilterQuery(queryStringParameters?.back);
    const viewModel = buildAdditionalEvidenceDetailViewModel(workItem, source, availability, documents, backQuery, csrf.value, caseLookup);

    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      detailTemplate,
      {
        title: `${viewModel.submissionReference} - Woonbehoefte`,
        features,
        currentPath: `/woonbehoefte/additional-evidence/${submissionId}`,
        actorEmail: identity.email,
      },
      { ...viewModel },
    );
    return Response.html(html, 200, csrf.cookie);
  }

  /** Read-only: never creates or changes the target case. A later koppeling re-validates it independently again. */
  private async lookupCase(rawSearchedReference: string): Promise<AdditionalEvidenceCaseLookupViewModel> {
    const searchedReference = rawSearchedReference.trim();
    if (!searchedReference) {
      return buildAdditionalEvidenceCaseLookup(searchedReference, undefined, undefined, false);
    }

    const targetCase = await this.primaryCaseRepository.getCase(searchedReference);
    if (!targetCase) {
      return buildAdditionalEvidenceCaseLookup(searchedReference, undefined, undefined, false);
    }

    const caseItems = await this.primaryCaseRepository.getCaseItems(searchedReference);
    const primaryLink = caseItems.sourceLinks.find((link) => link.relation === 'PRIMARY');
    let primarySource;
    let primarySourceAvailable = false;
    if (primaryLink) {
      const primarySourceItems = await this.primarySourceCacheStore.getItems([primaryLink.submissionId]);
      const primaryItem = primarySourceItems.get(primaryLink.submissionId);
      if (primaryItem && isReadySource(primaryItem)) {
        primarySource = primaryItem;
        primarySourceAvailable = true;
      } else if (primaryItem && isFailedSource(primaryItem)) {
        primarySourceAvailable = false;
      }
    }

    return buildAdditionalEvidenceCaseLookup(searchedReference, targetCase, primarySource, primarySourceAvailable);
  }
}
