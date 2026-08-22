import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { buildSportSubmissions } from './buildSportSubmissions';
import { fetchSportCsvDocuments } from './fetchSportCsvDocuments';
import { resolveAllowedDistricts } from './SportDistrictAuthorization';
import { resolveSportFilter } from './SportFilter';
import { collectSportObjects } from './SportObjectsQuery';
import { buildSportViewModel } from './SportViewModel';
import sportTemplate from './templates/sport.mustache';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { EmployeeIdentity } from '../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { ObjectsClient } from '../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../shared/clients/open-zaak/OpenZaakClient';
import { visibleFeatures } from '../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../shared/navigation/RegisteredFeatures';
import { render } from '../../shared/rendering/Renderer';

export class SportRequestHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly objectsClient: ObjectsClient,
    private readonly openZaakClient: OpenZaakClient,
  ) { }

  async handleRequest(identity: EmployeeIdentity, queryStringParameters?: Record<string, string | undefined>): Promise<ApiGatewayV2Response> {
    const requestStartedAt = Date.now();
    const context = await this.authorizationService.loadContext(identity);
    const permissionCheck = { resource: 'sport', action: 'view' } as const;
    const denied = await this.authorizationService.requireAuthorization(context, permissionCheck);
    if (denied) {
      return denied;
    }
    await this.authorizationService.recordAccessGranted(context, permissionCheck);

    const allowedDistricts = resolveAllowedDistricts(context.evaluator);
    const filter = resolveSportFilter(queryStringParameters, allowedDistricts);
    logger.debug('Sport allowed districts resolved', {
      districtCount: allowedDistricts.length,
      filteredDistrictCount: filter.districts.length,
      filteredTypeCount: filter.types.length,
    });

    let objects: ObjectResource[];
    try {
      objects = await collectSportObjects(this.objectsClient);
    } catch (error) {
      logger.error('Sport objects query failed', { reason: errorReason(error) });
      return Response.error(500);
    }

    const fetchResult = await fetchSportCsvDocuments(this.openZaakClient, objects, identity);

    const mappingStartedAt = Date.now();
    const mappingResult = buildSportSubmissions(fetchResult.documents, filter.districts, filter.types);
    const { submissions } = mappingResult;
    logger.debug('Sport mapping/filtering finished', { submissionCount: submissions.length, durationMs: Date.now() - mappingStartedAt });

    const failedDocuments = [...fetchResult.failedDocuments, ...mappingResult.failedDocuments];
    const viewModel = buildSportViewModel(
      allowedDistricts, filter, submissions, fetchResult.failedCount + mappingResult.failedCount, failedDocuments,
    );
    const features = visibleFeatures(REGISTERED_FEATURES, context.evaluator);

    const renderStartedAt = Date.now();
    const html = render(sportTemplate, { title: 'Sport', features, currentPath: '/sport', actorEmail: identity.email }, viewModel);
    logger.debug('Sport render finished', { durationMs: Date.now() - renderStartedAt });

    logger.debug('Sport request finished', { durationMs: Date.now() - requestStartedAt });
    return Response.html(html);
  }
}
