import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { buildWoonbehoefteDetailViewModel, WoonbehoefteSourceAvailability } from './WoonbehoefteDetailViewModel';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../shared/rendering/Renderer';
import { issueCsrfToken } from '../../../shared/security/csrf/CsrfProtection';
import notFoundTemplate from '../../home/templates/notFound.mustache';
import { visiblePermissionsFeature } from '../../permissions/PermissionsNavigationFeature';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { loadWoonbehoefteDocuments } from '../documents/WoonbehoefteDocumentsLoader';
import { isFailedSource, isReadySource, WoonbehoefteSourceRecord } from '../domain/WoonbehoefteSource';
import { sanitizeWoonbehoefteFilterQuery } from '../overview/WoonbehoefteOverviewFilter';
import { WoonbehoefteSourceCacheStore } from '../source/WoonbehoefteSourceCacheStore';
import detailTemplate from '../templates/woonbehoefte-detail.mustache';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;
const WOONBEHOEFTE_MANAGE_CHECK = { resource: 'woonbehoefte', action: 'manage' } as const;

/** Keyed by the `saved` redirect marker every mutation handler sets on success, see `redirectAfterMutation`. */
const SAVED_MESSAGES: Record<string, string> = {
  'claim': 'Aanvraag opgepakt.',
  'release': 'Claim vrijgegeven.',
  'take-over': 'Behandeling overgenomen.',
  'status': 'Status gewijzigd.',
  'check-requested': 'Check gevraagd.',
  'check-completed': 'Check afgerond.',
  'note': 'Aantekening toegevoegd.',
  'assessment': 'Beoordeling opgeslagen. Controleer of de status van de aanvraag nog klopt.',
};

/** Handles `GET /woonbehoefte/cases/{caseReference}`. A normal read, so no ACCESS_GRANTED audit. */
export class WoonbehoefteDetailHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly sourceCacheStore: WoonbehoefteSourceCacheStore,
    private readonly openZaakClient: OpenZaakClient,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, caseReference: string | undefined, queryStringParameters: Record<string, string | undefined> | undefined,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    if (!caseReference) {
      return Response.error(400);
    }

    const caseItems = await this.caseRepository.getCaseItems(caseReference);
    if (!caseItems.woonbehoefteCase) {
      const html = render(
        notFoundTemplate, { title: 'Aanvraag niet gevonden', features: [], currentPath: `/woonbehoefte/cases/${caseReference}`, actorEmail: identity.email },
      );
      return Response.html(html, 404);
    }

    const primaryLink = caseItems.sourceLinks.find((link) => link.relation === 'PRIMARY');
    let source: WoonbehoefteSourceRecord | undefined;
    let availability: WoonbehoefteSourceAvailability = 'MISSING';

    if (primaryLink) {
      const sourceItems = await this.sourceCacheStore.getItems([primaryLink.submissionId]);
      const item = sourceItems.get(primaryLink.submissionId);
      if (item && isReadySource(item)) {
        source = item;
        availability = 'READY';
      } else if (item && isFailedSource(item)) {
        availability = 'FAILED';
      }
    }

    const documents = source ? await loadWoonbehoefteDocuments(this.openZaakClient, source, caseReference, identity) : [];
    const canManage = context.evaluator.evaluate(WOONBEHOEFTE_MANAGE_CHECK) === 'ALLOW';
    const csrf = canManage ? issueCsrfToken() : undefined;
    const backQuery = sanitizeWoonbehoefteFilterQuery(queryStringParameters?.back);
    // Same actor-id fallback as every mutation handler uses for claimedBy, so the own-claim UI also works for an identity without an email.
    const actorId = identity.email ?? identity.principalId;
    const viewModel = buildWoonbehoefteDetailViewModel(
      caseItems.woonbehoefteCase, source, availability, documents, caseItems.notes, caseItems.activities, canManage, actorId, backQuery,
      csrf?.value,
    );

    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      detailTemplate,
      { title: `${viewModel.caseReference} - Woonbehoefte`, features, currentPath: `/woonbehoefte/cases/${caseReference}`, actorEmail: identity.email },
      {
        ...viewModel,
        showStaleWarning: queryStringParameters?.status === 'stale',
        ...(queryStringParameters?.saved && SAVED_MESSAGES[queryStringParameters.saved]
          ? { savedMessage: SAVED_MESSAGES[queryStringParameters.saved] }
          : {}),
      },
    );
    return csrf ? Response.html(html, 200, csrf.cookie) : Response.html(html);
  }
}
