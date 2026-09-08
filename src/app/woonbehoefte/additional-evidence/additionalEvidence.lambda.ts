import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { AdditionalEvidenceDetailHandler } from './detail/AdditionalEvidenceDetailHandler';
import { AdditionalEvidenceSearchCaseHandler } from './detail/AdditionalEvidenceSearchCaseHandler';
import { AdditionalEvidenceStatusHandler } from './detail/AdditionalEvidenceStatusHandler';
import { AdditionalEvidenceDocumentDownloadHandler } from './documents/AdditionalEvidenceDocumentDownloadHandler';
import { AdditionalEvidenceLinkHandler } from './link/AdditionalEvidenceLinkHandler';
import { createAdditionalEvidenceLinkRepository } from './link/createAdditionalEvidenceLinkRepository';
import { AdditionalEvidenceOverviewHandler } from './overview/AdditionalEvidenceOverviewHandler';
import { AdditionalEvidenceRefreshHandler } from './overview/AdditionalEvidenceRefreshHandler';
import { createAdditionalEvidenceRepository } from './persistence/createAdditionalEvidenceRepository';
import { createAdditionalEvidenceSourceCacheStore } from './source/createAdditionalEvidenceSourceCacheStore';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { countMetric, metrics } from '../../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../../observability/RequestLogging';
import { createAuditTrail } from '../../../shared/audit/createAuditTrail';
import { requireSession } from '../../../shared/auth/requireSession';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { createPermissionRepository } from '../../../shared/authorization/createPermissionRepository';
import { getOpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClientFactory';
import { render } from '../../../shared/rendering/Renderer';
import notFoundTemplate from '../../home/templates/notFound.mustache';
import { createWoonbehoefteCaseRepository } from '../cases/createWoonbehoefteCaseRepository';
import { createWoonbehoefteSourceCacheStore } from '../source/createWoonbehoefteSourceCacheStore';

const dynamoDBClient = new DynamoDBClient({});
const lambdaClient = new LambdaClient({});
const s3Client = new S3Client({});
const auditTrail = createAuditTrail(dynamoDBClient);
const authorizationService = new AuthorizationService(createPermissionRepository(dynamoDBClient), auditTrail);
const repository = createAdditionalEvidenceRepository(dynamoDBClient);
const sourceCacheStore = createAdditionalEvidenceSourceCacheStore(dynamoDBClient);
// Read-only reuse for the "zoek hoofdzaak"-lookup, and read/write reuse for the link transaction's target case.
const primaryCaseRepository = createWoonbehoefteCaseRepository(dynamoDBClient);
const primarySourceCacheStore = createWoonbehoefteSourceCacheStore(dynamoDBClient);
const linkRepository = createAdditionalEvidenceLinkRepository(dynamoDBClient);
const overviewHandler = new AdditionalEvidenceOverviewHandler(authorizationService, repository, sourceCacheStore);
const searchCaseHandler = new AdditionalEvidenceSearchCaseHandler(authorizationService);
const statusHandler = new AdditionalEvidenceStatusHandler(authorizationService, repository, auditTrail);
const linkHandler = new AdditionalEvidenceLinkHandler(
  authorizationService, repository, sourceCacheStore, primaryCaseRepository, linkRepository, auditTrail,
);

/**
 * Dispatches every Additional Evidence route. Every route, including koppelen, is functionally real.
 */
export async function handler(event: APIGatewayProxyEventV2, lambdaContext: Context): Promise<ApiGatewayV2Response> {
  const correlationId = bindRequestLogging(lambdaContext);
  try {
    const cookieHeader = event.cookies?.join(';');
    const identity = await requireSession(cookieHeader, dynamoDBClient, auditTrail);
    if (!identity) {
      return Response.redirect('/login', 302);
    }

    const submissionId = event.pathParameters?.submissionId;
    const documentId = event.pathParameters?.documentId;
    const isBase64Encoded = Boolean(event.isBase64Encoded);

    logger.appendKeys({
      routeKey: event.routeKey,
      ...(submissionId ? { submissionId } : {}),
      ...(documentId ? { documentId } : {}),
    });

    if (event.routeKey === 'GET /woonbehoefte/additional-evidence') {
      return await overviewHandler.handleRequest(identity, event.queryStringParameters);
    }
    if (event.routeKey === 'POST /woonbehoefte/additional-evidence/refresh') {
      const env = environmentVariables(['WOONBEHOEFTE_ADDITIONAL_EVIDENCE_SYNC_WORKER_FUNCTION_NAME'] as const);
      const refreshHandler = new AdditionalEvidenceRefreshHandler(
        authorizationService, sourceCacheStore, lambdaClient, env.WOONBEHOEFTE_ADDITIONAL_EVIDENCE_SYNC_WORKER_FUNCTION_NAME,
      );
      return await refreshHandler.handleRequest(identity, cookieHeader, event.body, isBase64Encoded, correlationId);
    }
    if (event.routeKey === 'GET /woonbehoefte/additional-evidence/{submissionId}') {
      const openZaakClient = await getOpenZaakClient();
      const detailHandler = new AdditionalEvidenceDetailHandler(
        authorizationService, repository, sourceCacheStore, openZaakClient, primaryCaseRepository, primarySourceCacheStore,
      );
      return await detailHandler.handleRequest(identity, submissionId, event.queryStringParameters);
    }
    if (event.routeKey === 'GET /woonbehoefte/additional-evidence/{submissionId}/documents/{documentId}') {
      const openZaakClient = await getOpenZaakClient();
      const env = environmentVariables(['WOONBEHOEFTE_TEMP_DOWNLOAD_BUCKET'] as const);
      const downloadHandler = new AdditionalEvidenceDocumentDownloadHandler(
        authorizationService, repository, sourceCacheStore, openZaakClient, auditTrail, s3Client, env.WOONBEHOEFTE_TEMP_DOWNLOAD_BUCKET,
      );
      return await downloadHandler.handleRequest(identity, submissionId, documentId);
    }
    if (event.routeKey === 'POST /woonbehoefte/additional-evidence/{submissionId}/search-case') {
      return await searchCaseHandler.handleRequest(identity, submissionId, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'POST /woonbehoefte/additional-evidence/{submissionId}/status') {
      return await statusHandler.handleRequest(identity, submissionId, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'POST /woonbehoefte/additional-evidence/{submissionId}/link') {
      return await linkHandler.handleRequest(identity, submissionId, cookieHeader, event.body, isBase64Encoded);
    }

    const html = render(notFoundTemplate, { title: 'Pagina niet gevonden', features: [], currentPath: event.rawPath, actorEmail: identity.email });
    return Response.html(html, 404);
  } catch (error) {
    logger.error('Unhandled error in additionalEvidence', {
      reason: errorReason(error),
      ...(error instanceof Error ? { errorName: error.name, stack: error.stack } : {}),
    });
    countMetric('UnhandledError');
    return Response.error(500);
  } finally {
    metrics.publishStoredMetrics();
    resetRequestLogging();
  }
}
