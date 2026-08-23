import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { SportClientErrorHandler } from './aanmeldingen/SportClientErrorHandler';
import { SportPdfDownloadHandler } from './aanmeldingen/SportPdfDownloadHandler';
import { SportRefreshHandler } from './aanmeldingen/SportRefreshHandler';
import { SportRequestHandler } from './aanmeldingen/SportRequestHandler';
import { SportSubmissionsRequestHandler } from './aanmeldingen/SportSubmissionsRequestHandler';
import { createSportCacheStore } from './cache/createSportCacheStore';
import { createSportReportStore } from './reporter/store/createSportReportStore';
import { SportReportCreateHandler } from './reporter/ui-request-handlers/SportReportCreateHandler';
import { SportReportDeleteHandler } from './reporter/ui-request-handlers/SportReportDeleteHandler';
import { SportReportDownloadHandler } from './reporter/ui-request-handlers/SportReportDownloadHandler';
import { SportReportsRequestHandler } from './reporter/ui-request-handlers/SportReportsRequestHandler';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../observability/RequestLogging';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';
import { requireSession } from '../../shared/auth/requireSession';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { createPermissionRepository } from '../../shared/authorization/createPermissionRepository';
import { getObjectsClient } from '../../shared/clients/objects/ObjectsClientFactory';
import { getOpenZaakClient } from '../../shared/clients/open-zaak/OpenZaakClientFactory';

const dynamoDBClient = new DynamoDBClient({});
const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});
const auditTrail = createAuditTrail(dynamoDBClient);
const authorizationService = new AuthorizationService(createPermissionRepository(dynamoDBClient), auditTrail);
const reportStore = createSportReportStore(dynamoDBClient);
const cacheStore = createSportCacheStore(dynamoDBClient);

export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<ApiGatewayV2Response> {
  const correlationId = bindRequestLogging(context);
  try {
    const identity = await requireSession(event.cookies?.join(';'), dynamoDBClient, auditTrail);
    if (!identity) {
      return Response.redirect('/login', 302);
    }

    const objectUuid = event.pathParameters?.objectUuid;
    if (objectUuid !== undefined) {
      const [objectsClient, openZaakClient] = await Promise.all([getObjectsClient(), getOpenZaakClient()]);
      const pdfHandler = new SportPdfDownloadHandler(authorizationService, objectsClient, openZaakClient, auditTrail);
      return await pdfHandler.handleRequest(identity, objectUuid);
    }

    if (event.routeKey === 'POST /sport/submissions/refresh') {
      const env = environmentVariables(['SPORT_CACHE_WORKER_FUNCTION_NAME'] as const);
      const refreshHandler = new SportRefreshHandler(authorizationService, cacheStore, lambdaClient, env.SPORT_CACHE_WORKER_FUNCTION_NAME);
      return await refreshHandler.handleRequest(identity, event.headers, correlationId);
    }
    if (event.routeKey === 'GET /sport/submissions') {
      const submissionsHandler = new SportSubmissionsRequestHandler(authorizationService, cacheStore);
      return await submissionsHandler.handleRequest(identity, event.queryStringParameters, correlationId);
    }
    if (event.routeKey === 'POST /sport/client-errors') {
      const clientErrorHandler = new SportClientErrorHandler(authorizationService);
      return await clientErrorHandler.handleRequest(identity, event.headers, event.body, Boolean(event.isBase64Encoded));
    }

    const reportId = event.pathParameters?.reportId;
    if (reportId !== undefined && event.routeKey === 'GET /sport/overzichten/{reportId}/download') {
      const env = environmentVariables(['SPORT_REPORTS_BUCKET'] as const);
      const downloadHandler = new SportReportDownloadHandler(authorizationService, reportStore, s3Client, auditTrail, env.SPORT_REPORTS_BUCKET);
      return await downloadHandler.handleRequest(identity, reportId);
    }
    if (reportId !== undefined && event.routeKey === 'POST /sport/overzichten/{reportId}/delete') {
      const env = environmentVariables(['SPORT_REPORTS_BUCKET'] as const);
      const deleteHandler = new SportReportDeleteHandler(authorizationService, reportStore, s3Client, auditTrail, env.SPORT_REPORTS_BUCKET);
      return await deleteHandler.handleRequest(identity, reportId);
    }
    if (event.routeKey === 'POST /sport/overzichten') {
      const env = environmentVariables(['SPORT_EXCEL_WORKER_FUNCTION_NAME'] as const);
      const createHandler = new SportReportCreateHandler(
        authorizationService, reportStore, lambdaClient, auditTrail, env.SPORT_EXCEL_WORKER_FUNCTION_NAME,
      );
      return await createHandler.handleRequest(identity, event.body, Boolean(event.isBase64Encoded));
    }
    if (event.routeKey === 'GET /sport/overzichten') {
      const reportsHandler = new SportReportsRequestHandler(authorizationService, reportStore);
      return await reportsHandler.handleRequest(identity, event.queryStringParameters);
    }

    const requestHandler = new SportRequestHandler(authorizationService);
    return await requestHandler.handleRequest(identity, event.queryStringParameters);
  } catch (error) {
    logger.error('Unhandled error in sport', { reason: errorReason(error) });
    countMetric('UnhandledError');
    return Response.error(500);
  } finally {
    metrics.publishStoredMetrics();
    resetRequestLogging();
  }
}
