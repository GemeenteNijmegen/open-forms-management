import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { WoonbehoefteClaimHandler } from './actions/WoonbehoefteClaimHandler';
import { WoonbehoefteStatusHandler } from './actions/WoonbehoefteStatusHandler';
import { WoonbehoefteAssessmentHandler } from './assessment/WoonbehoefteAssessmentHandler';
import { createWoonbehoefteCaseRepository } from './cases/createWoonbehoefteCaseRepository';
import { WoonbehoefteCheckHandler } from './checks/WoonbehoefteCheckHandler';
import { WoonbehoefteDetailHandler } from './detail/WoonbehoefteDetailHandler';
import { WoonbehoefteDocumentDownloadHandler } from './documents/WoonbehoefteDocumentDownloadHandler';
import { WoonbehoefteNoteHandler } from './notes/WoonbehoefteNoteHandler';
import { WoonbehoefteOverviewHandler } from './overview/WoonbehoefteOverviewHandler';
import { WoonbehoefteRefreshHandler } from './overview/WoonbehoefteRefreshHandler';
import { createWoonbehoefteSourceCacheStore } from './source/createWoonbehoefteSourceCacheStore';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../observability/RequestLogging';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';
import { requireSession } from '../../shared/auth/requireSession';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { createPermissionRepository } from '../../shared/authorization/createPermissionRepository';
import { getOpenZaakClient } from '../../shared/clients/open-zaak/OpenZaakClientFactory';
import { render } from '../../shared/rendering/Renderer';
import notFoundTemplate from '../home/templates/notFound.mustache';

const dynamoDBClient = new DynamoDBClient({});
const lambdaClient = new LambdaClient({});
const s3Client = new S3Client({});
const auditTrail = createAuditTrail(dynamoDBClient);
const authorizationService = new AuthorizationService(createPermissionRepository(dynamoDBClient), auditTrail);
const caseRepository = createWoonbehoefteCaseRepository(dynamoDBClient);
const sourceCacheStore = createWoonbehoefteSourceCacheStore(dynamoDBClient);

const overviewHandler = new WoonbehoefteOverviewHandler(authorizationService, caseRepository, sourceCacheStore);
const claimHandler = new WoonbehoefteClaimHandler(authorizationService, caseRepository, auditTrail);
const statusHandler = new WoonbehoefteStatusHandler(authorizationService, caseRepository, auditTrail);
const assessmentHandler = new WoonbehoefteAssessmentHandler(authorizationService, caseRepository, auditTrail);
const noteHandler = new WoonbehoefteNoteHandler(authorizationService, caseRepository, auditTrail);
const checkHandler = new WoonbehoefteCheckHandler(authorizationService, caseRepository, auditTrail);

/**
 * Dispatches every Woonbehoefte page/action route, the same single-Lambda-multiple-routes shape
 * `sport.lambda.ts` uses. Objects/Open Zaak clients are only constructed for routes that actually need
 * them, the same lazy pattern `sport.lambda.ts` follows.
 */
export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<ApiGatewayV2Response> {
  const correlationId = bindRequestLogging(context);
  try {
    const cookieHeader = event.cookies?.join(';');
    const identity = await requireSession(cookieHeader, dynamoDBClient, auditTrail);
    if (!identity) {
      return Response.redirect('/login', 302);
    }

    const caseReference = event.pathParameters?.caseReference;
    const documentId = event.pathParameters?.documentId;
    const isBase64Encoded = Boolean(event.isBase64Encoded);

    logger.appendKeys({
      routeKey: event.routeKey,
      ...(caseReference ? { caseReference } : {}),
      ...(documentId ? { documentId } : {}),
    });

    if (event.routeKey === 'GET /woonbehoefte') {
      return await overviewHandler.handleRequest(identity, event.queryStringParameters);
    }
    if (event.routeKey === 'POST /woonbehoefte/refresh') {
      const env = environmentVariables(['WOONBEHOEFTE_SYNC_WORKER_FUNCTION_NAME'] as const);
      const refreshHandler = new WoonbehoefteRefreshHandler(
        authorizationService, sourceCacheStore, lambdaClient, env.WOONBEHOEFTE_SYNC_WORKER_FUNCTION_NAME,
      );
      return await refreshHandler.handleRequest(identity, cookieHeader, event.body, isBase64Encoded, correlationId);
    }
    if (event.routeKey === 'GET /woonbehoefte/cases/{caseReference}') {
      const openZaakClient = await getOpenZaakClient();
      const detailHandler = new WoonbehoefteDetailHandler(authorizationService, caseRepository, sourceCacheStore, openZaakClient);
      return await detailHandler.handleRequest(identity, caseReference, event.queryStringParameters);
    }
    if (event.routeKey === 'GET /woonbehoefte/cases/{caseReference}/documents/{documentId}') {
      const openZaakClient = await getOpenZaakClient();
      const env = environmentVariables(['WOONBEHOEFTE_TEMP_DOWNLOAD_BUCKET'] as const);
      const downloadHandler = new WoonbehoefteDocumentDownloadHandler(
        authorizationService, caseRepository, sourceCacheStore, openZaakClient, auditTrail,
        s3Client, env.WOONBEHOEFTE_TEMP_DOWNLOAD_BUCKET,
      );
      return await downloadHandler.handleRequest(identity, caseReference, documentId);
    }
    if (event.routeKey === 'POST /woonbehoefte/cases/{caseReference}/claim') {
      return await claimHandler.handleRequest('claim', identity, caseReference, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'POST /woonbehoefte/cases/{caseReference}/release') {
      return await claimHandler.handleRequest('release', identity, caseReference, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'POST /woonbehoefte/cases/{caseReference}/take-over') {
      return await claimHandler.handleRequest('takeOver', identity, caseReference, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'POST /woonbehoefte/cases/{caseReference}/assessment') {
      return await assessmentHandler.handleRequest(identity, caseReference, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'POST /woonbehoefte/cases/{caseReference}/status') {
      return await statusHandler.handleChangeStatus(identity, caseReference, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'POST /woonbehoefte/cases/{caseReference}/inadmissible/confirm') {
      return await statusHandler.handleConfirmInadmissible(identity, caseReference, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'POST /woonbehoefte/cases/{caseReference}/notes') {
      return await noteHandler.handleRequest(identity, caseReference, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'POST /woonbehoefte/cases/{caseReference}/check/request') {
      return await checkHandler.handleRequest('request', identity, caseReference, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'POST /woonbehoefte/cases/{caseReference}/check/complete') {
      return await checkHandler.handleRequest('complete', identity, caseReference, cookieHeader, event.body, isBase64Encoded);
    }

    const html = render(notFoundTemplate, { title: 'Pagina niet gevonden', features: [], currentPath: event.rawPath, actorEmail: identity.email });
    return Response.html(html, 404);
  } catch (error) {
    logger.error('Unhandled error in woonbehoefte', {
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
