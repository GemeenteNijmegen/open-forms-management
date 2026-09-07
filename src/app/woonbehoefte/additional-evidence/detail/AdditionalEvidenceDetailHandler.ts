import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { AdditionalEvidenceSourceAvailability, buildAdditionalEvidenceDetailViewModel } from './AdditionalEvidenceDetailViewModel';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { visibleFeatures } from '../../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../../shared/rendering/Renderer';
import { issueCsrfToken } from '../../../../shared/security/csrf/CsrfProtection';
import notFoundTemplate from '../../../home/templates/notFound.mustache';
import { visiblePermissionsFeature } from '../../../permissions/PermissionsNavigationFeature';
import { loadAdditionalEvidenceDocuments } from '../documents/AdditionalEvidenceDocumentsLoader';
import { isFailedAdditionalEvidenceSource, isReadyAdditionalEvidenceSource } from '../domain/AdditionalEvidenceSource';
import { sanitizeAdditionalEvidenceFilterQuery } from '../overview/AdditionalEvidenceOverviewFilter';
import { AdditionalEvidenceRepository } from '../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../source/AdditionalEvidenceSourceCacheStore';
import detailTemplate from '../templates/woonbehoefte-additional-evidence-detail.mustache';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

/** Handles `GET /woonbehoefte/additional-evidence/{submissionId}`. A normal read, so no ACCESS_GRANTED audit. */
export class AdditionalEvidenceDetailHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly repository: AdditionalEvidenceRepository,
    private readonly sourceCacheStore: AdditionalEvidenceSourceCacheStore,
    private readonly openZaakClient: OpenZaakClient,
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

    const csrf = issueCsrfToken();
    const backQuery = sanitizeAdditionalEvidenceFilterQuery(queryStringParameters?.back);
    const viewModel = buildAdditionalEvidenceDetailViewModel(workItem, source, availability, documents, backQuery, csrf.value);

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
}
