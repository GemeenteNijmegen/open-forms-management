import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { PermissionAdministrationPolicy } from './administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from './administration/PermissionAdministrationService';
import { PermissionCatalog } from './catalog/PermissionCatalog';
import { DynamoDbPermissionAdministrationRepository } from './store/DynamoDbPermissionAdministrationRepository';
import { PermissionsOverviewHandler } from './ui-request-handlers/PermissionsOverviewHandler';
import { PermissionUserCreateHandler } from './ui-request-handlers/PermissionUserCreateHandler';
import { PermissionUserCreateOpenHandler } from './ui-request-handlers/PermissionUserCreateOpenHandler';
import { PermissionUserEditOpenHandler } from './ui-request-handlers/PermissionUserEditOpenHandler';
import { PermissionUserRemoveHandler } from './ui-request-handlers/PermissionUserRemoveHandler';
import { PermissionUserUpdateHandler } from './ui-request-handlers/PermissionUserUpdateHandler';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../observability/RequestLogging';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';
import { requireSession } from '../../shared/auth/requireSession';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { createPermissionRepository } from '../../shared/authorization/createPermissionRepository';
import { render } from '../../shared/rendering/Renderer';
import notFoundTemplate from '../home/templates/notFound.mustache';

const dynamoDBClient = new DynamoDBClient({});
const auditTrail = createAuditTrail(dynamoDBClient);
const authorizationService = new AuthorizationService(createPermissionRepository(dynamoDBClient), auditTrail);

// No factory function for this repository: it only has this one caller, so a wrapper would not remove any duplication.
const env = environmentVariables(['PERMISSIONS_TABLE'] as const);
const administrationRepository = new DynamoDbPermissionAdministrationRepository(DynamoDBDocumentClient.from(dynamoDBClient), env.PERMISSIONS_TABLE);
const catalog = new PermissionCatalog();
const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));

const overviewHandler = new PermissionsOverviewHandler(authorizationService, administrationService, administrationRepository);
const createOpenHandler = new PermissionUserCreateOpenHandler(authorizationService, administrationService);
const createHandler = new PermissionUserCreateHandler(authorizationService, administrationService, catalog, administrationRepository, auditTrail);
const editOpenHandler = new PermissionUserEditOpenHandler(authorizationService, administrationService, administrationRepository);
const updateHandler = new PermissionUserUpdateHandler(authorizationService, administrationService, catalog, administrationRepository, auditTrail);
const removeHandler = new PermissionUserRemoveHandler(authorizationService, administrationService, catalog, administrationRepository, auditTrail);

export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<ApiGatewayV2Response> {
  bindRequestLogging(context);
  try {
    const cookieHeader = event.cookies?.join(';');
    const identity = await requireSession(cookieHeader, dynamoDBClient, auditTrail);
    if (!identity) {
      return Response.redirect('/login', 302);
    }

    const isBase64Encoded = Boolean(event.isBase64Encoded);
    switch (event.routeKey) {
      case 'GET /permissions':
        return await overviewHandler.handleRequest(identity);
      case 'GET /permissions/users/new':
        return await createOpenHandler.handleRequest(identity, event.queryStringParameters);
      case 'POST /permissions/users/edit':
        return await editOpenHandler.handleRequest(identity, event.body, isBase64Encoded);
      case 'POST /permissions/users/create':
        return await createHandler.handleRequest(identity, cookieHeader, event.body, isBase64Encoded);
      case 'POST /permissions/users/update':
        return await updateHandler.handleRequest(identity, cookieHeader, event.body, isBase64Encoded);
      case 'POST /permissions/users/remove':
        return await removeHandler.handleRequest(identity, cookieHeader, event.body, isBase64Encoded);
      default: {
        const html = render(notFoundTemplate, { title: 'Pagina niet gevonden', features: [], currentPath: event.rawPath, actorEmail: identity.email });
        return Response.html(html, 404);
      }
    }
  } catch (error) {
    logger.error('Unhandled error in permissions', { reason: errorReason(error) });
    countMetric('UnhandledError');
    return Response.error(500);
  } finally {
    metrics.publishStoredMetrics();
    resetRequestLogging();
  }
}
