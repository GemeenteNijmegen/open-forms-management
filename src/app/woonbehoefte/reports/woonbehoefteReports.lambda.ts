import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { createWoonbehoefteReportStore } from './store/createWoonbehoefteReportStore';
import { WoonbehoefteReportCreateHandler } from './ui-request-handlers/WoonbehoefteReportCreateHandler';
import { WoonbehoefteReportDeleteHandler } from './ui-request-handlers/WoonbehoefteReportDeleteHandler';
import { WoonbehoefteReportDownloadHandler } from './ui-request-handlers/WoonbehoefteReportDownloadHandler';
import { WoonbehoefteReportsOverviewHandler } from './ui-request-handlers/WoonbehoefteReportsOverviewHandler';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { countMetric, metrics } from '../../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../../observability/RequestLogging';
import { createAuditTrail } from '../../../shared/audit/createAuditTrail';
import { requireSession } from '../../../shared/auth/requireSession';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { createPermissionRepository } from '../../../shared/authorization/createPermissionRepository';
import { render } from '../../../shared/rendering/Renderer';
import notFoundTemplate from '../../home/templates/notFound.mustache';

const dynamoDBClient = new DynamoDBClient({});
const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});
const auditTrail = createAuditTrail(dynamoDBClient);
const authorizationService = new AuthorizationService(createPermissionRepository(dynamoDBClient), auditTrail);
const reportStore = createWoonbehoefteReportStore(dynamoDBClient);
const env = environmentVariables(['WOONBEHOEFTE_REPORTS_BUCKET', 'WOONBEHOEFTE_EXCEL_WORKER_FUNCTION_NAME'] as const);

const overviewHandler = new WoonbehoefteReportsOverviewHandler(authorizationService, reportStore);
const createHandler = new WoonbehoefteReportCreateHandler(
  authorizationService, reportStore, lambdaClient, auditTrail, env.WOONBEHOEFTE_EXCEL_WORKER_FUNCTION_NAME,
);
const downloadHandler = new WoonbehoefteReportDownloadHandler(
  authorizationService, reportStore, s3Client, auditTrail, env.WOONBEHOEFTE_REPORTS_BUCKET,
);
const deleteHandler = new WoonbehoefteReportDeleteHandler(authorizationService, reportStore, s3Client, auditTrail, env.WOONBEHOEFTE_REPORTS_BUCKET);

/**
 * Dispatcht de Woonbehoefte Excel-overzichtenroutes, los van de primary woonbehoefte.lambda.ts, zelfde
 * single-Lambda-multiple-routes vorm.
 */
export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<ApiGatewayV2Response> {
  bindRequestLogging(context);
  try {
    const cookieHeader = event.cookies?.join(';');
    const identity = await requireSession(cookieHeader, dynamoDBClient, auditTrail);
    if (!identity) {
      return Response.redirect('/login', 302);
    }

    const reportId = event.pathParameters?.reportId;
    const isBase64Encoded = Boolean(event.isBase64Encoded);
    logger.appendKeys({ routeKey: event.routeKey, ...(reportId ? { reportId } : {}) });

    if (event.routeKey === 'GET /woonbehoefte/overzichten') {
      return await overviewHandler.handleRequest(identity, event.queryStringParameters);
    }
    if (event.routeKey === 'POST /woonbehoefte/overzichten') {
      return await createHandler.handleRequest(identity, cookieHeader, event.body, isBase64Encoded);
    }
    if (event.routeKey === 'GET /woonbehoefte/overzichten/{reportId}/download') {
      return await downloadHandler.handleRequest(identity, reportId!);
    }
    if (event.routeKey === 'POST /woonbehoefte/overzichten/{reportId}/delete') {
      return await deleteHandler.handleRequest(identity, reportId!, cookieHeader, event.body, isBase64Encoded);
    }

    const html = render(notFoundTemplate, { title: 'Pagina niet gevonden', features: [], currentPath: event.rawPath, actorEmail: identity.email });
    return Response.html(html, 404);
  } catch (error) {
    logger.error('Unhandled error in woonbehoefteReports', {
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
