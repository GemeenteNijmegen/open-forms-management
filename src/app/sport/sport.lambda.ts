import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { SportPdfDownloadHandler } from './aanmeldingen/SportPdfDownloadHandler';
import { SportRequestHandler } from './aanmeldingen/SportRequestHandler';
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

export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<ApiGatewayV2Response> {
  bindRequestLogging(context);
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

    const [objectsClient, openZaakClient] = await Promise.all([getObjectsClient(), getOpenZaakClient()]);
    const requestHandler = new SportRequestHandler(authorizationService, objectsClient, openZaakClient);
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
