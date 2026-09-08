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
import { isReadySource, WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { loadAdditionalEvidenceDocuments } from '../documents/AdditionalEvidenceDocumentsLoader';
import { isFailedAdditionalEvidenceSource, isReadyAdditionalEvidenceSource } from '../domain/AdditionalEvidenceSource';
import { sanitizeAdditionalEvidenceFilterQuery } from '../overview/AdditionalEvidenceOverviewFilter';
import { AdditionalEvidenceRepository } from '../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../source/AdditionalEvidenceSourceCacheStore';
import detailTemplate from '../templates/woonbehoefte-additional-evidence-detail.mustache';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;
const WOONBEHOEFTE_MANAGE_CHECK = { resource: 'woonbehoefte', action: 'manage' } as const;

/** Keyed by the `saved` redirect marker `AdditionalEvidenceStatusHandler`/`AdditionalEvidenceLinkHandler` set on success. */
const SAVED_MESSAGES: Record<string, string> = {
  status: 'Status gewijzigd.',
  linked: 'Extra bewijzen gekoppeld.',
};

/** Keyed by the `linkError` redirect marker `AdditionalEvidenceLinkHandler` sets when koppelen did not succeed. */
const LINK_ERROR_MESSAGES: Record<string, string> = {
  conflict: 'Deze inzending is ondertussen gewijzigd of gekoppeld. Ververs de pagina en controleer de huidige status.',
  failed: 'Koppelen is niet gelukt. Er is niets gewijzigd. Probeer het opnieuw.',
};

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

    const isLinked = workItem.status === 'LINKED';
    // Once linked, the zoek-hoofdzaak UI is gone (see mustache), so a stray searchCaseReference query is never looked up.
    const caseLookup = !isLinked && queryStringParameters?.searchCaseReference !== undefined
      ? await this.lookupCase(queryStringParameters.searchCaseReference)
      : emptyCaseLookup();
    const linkedPrimarySource = isLinked && workItem.linkedCaseReference
      ? (await this.loadPrimarySource(workItem.linkedCaseReference)).source
      : undefined;

    const canManage = context.evaluator.evaluate(WOONBEHOEFTE_MANAGE_CHECK) === 'ALLOW';
    const csrf = issueCsrfToken();
    const backQuery = sanitizeAdditionalEvidenceFilterQuery(queryStringParameters?.back);
    const viewModel = buildAdditionalEvidenceDetailViewModel(
      workItem, source, availability, documents, canManage, backQuery, csrf.value, caseLookup, linkedPrimarySource,
    );

    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      detailTemplate,
      {
        title: `${viewModel.submissionReference} - Woonbehoefte`,
        features,
        currentPath: `/woonbehoefte/additional-evidence/${submissionId}`,
        actorEmail: identity.email,
      },
      {
        ...viewModel,
        showLinkedConflictWarning: queryStringParameters?.status === 'linked-conflict',
        ...(queryStringParameters?.saved && SAVED_MESSAGES[queryStringParameters.saved]
          ? { savedMessage: SAVED_MESSAGES[queryStringParameters.saved] }
          : {}),
        ...(queryStringParameters?.linkError && LINK_ERROR_MESSAGES[queryStringParameters.linkError]
          ? { linkErrorMessage: LINK_ERROR_MESSAGES[queryStringParameters.linkError] }
          : {}),
      },
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

    const { source, available } = await this.loadPrimarySource(searchedReference);
    return buildAdditionalEvidenceCaseLookup(searchedReference, targetCase, source, available);
  }

  /** Shared by the zoek-hoofdzaak lookup and the na-koppelen info: always reads the PRIMARY source fresh, never cached from an earlier request. */
  private async loadPrimarySource(caseReference: string): Promise<{ source?: WoonbehoefteSourceRecord; available: boolean }> {
    const caseItems = await this.primaryCaseRepository.getCaseItems(caseReference);
    const primaryLink = caseItems.sourceLinks.find((link) => link.relation === 'PRIMARY');
    if (!primaryLink) {
      return { available: false };
    }
    const primarySourceItems = await this.primarySourceCacheStore.getItems([primaryLink.submissionId]);
    const primaryItem = primarySourceItems.get(primaryLink.submissionId);
    return primaryItem && isReadySource(primaryItem) ? { source: primaryItem, available: true } : { available: false };
  }
}
