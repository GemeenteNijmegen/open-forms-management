import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { AdditionalEvidenceOverviewHandler } from './overview/AdditionalEvidenceOverviewHandler';
import { AdditionalEvidenceRefreshHandler } from './overview/AdditionalEvidenceRefreshHandler';
import { createAdditionalEvidenceRepository } from './persistence/createAdditionalEvidenceRepository';
import { createAdditionalEvidenceSourceCacheStore } from './source/createAdditionalEvidenceSourceCacheStore';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { countMetric, metrics } from '../../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../../observability/RequestLogging';
import { createAuditTrail } from '../../../shared/audit/createAuditTrail';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { requireSession } from '../../../shared/auth/requireSession';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { createPermissionRepository } from '../../../shared/authorization/createPermissionRepository';
import { PermissionCheck } from '../../../shared/authorization/PermissionEvaluator';
import { render } from '../../../shared/rendering/Renderer';
import notFoundTemplate from '../../home/templates/notFound.mustache';

const WOONBEHOEFTE_VIEW_CHECK: PermissionCheck = { resource: 'woonbehoefte', action: 'view' };
const WOONBEHOEFTE_MANAGE_CHECK: PermissionCheck = { resource: 'woonbehoefte', action: 'manage' };

const dynamoDBClient = new DynamoDBClient({});
const lambdaClient = new LambdaClient({});
const auditTrail = createAuditTrail(dynamoDBClient);
const authorizationService = new AuthorizationService(createPermissionRepository(dynamoDBClient), auditTrail);
const repository = createAdditionalEvidenceRepository(dynamoDBClient);
const sourceCacheStore = createAdditionalEvidenceSourceCacheStore(dynamoDBClient);
const overviewHandler = new AdditionalEvidenceOverviewHandler(authorizationService, repository, sourceCacheStore);

/** Nothing has been implemented yet for a specific submission, so any submissionId is 404 for now. */
async function respondSubmissionNotFound(identity: EmployeeIdentity, currentPath: string): Promise<ApiGatewayV2Response> {
  const html = render(notFoundTemplate, { title: 'Extra bewijzen niet gevonden', features: [], currentPath, actorEmail: identity.email });
  return Response.html(html, 404);
}

/** Authorizes, then reports the submission as not (yet) found; shared by every submissionId-scoped stub route. */
async function requireAuthorizationThenNotFound(
  identity: EmployeeIdentity, check: PermissionCheck, submissionId: string | undefined,
): Promise<ApiGatewayV2Response> {
  const authContext = await authorizationService.loadContext(identity);
  const denied = await authorizationService.requireAuthorization(authContext, check);
  if (denied) {
    return denied;
  }
  return respondSubmissionNotFound(identity, `/woonbehoefte/additional-evidence/${submissionId}`);
}

/**
 * Dispatches every Additional Evidence route. Overview and refresh are functionally real; the rest is
 * permission-checked and reports the submission as not (yet) found, honestly true since koppelen/status/
 * detail/documenten are not built yet. Nothing here mutates data outside the Additional Evidence sync/cache.
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
      return await requireAuthorizationThenNotFound(identity, WOONBEHOEFTE_VIEW_CHECK, submissionId);
    }
    if (event.routeKey === 'POST /woonbehoefte/additional-evidence/{submissionId}/search-case') {
      return await requireAuthorizationThenNotFound(identity, WOONBEHOEFTE_VIEW_CHECK, submissionId);
    }
    if (event.routeKey === 'POST /woonbehoefte/additional-evidence/{submissionId}/status') {
      return await requireAuthorizationThenNotFound(identity, WOONBEHOEFTE_MANAGE_CHECK, submissionId);
    }
    if (event.routeKey === 'POST /woonbehoefte/additional-evidence/{submissionId}/link') {
      return await requireAuthorizationThenNotFound(identity, WOONBEHOEFTE_MANAGE_CHECK, submissionId);
    }
    if (event.routeKey === 'GET /woonbehoefte/additional-evidence/{submissionId}/documents/{documentId}') {
      return await requireAuthorizationThenNotFound(identity, WOONBEHOEFTE_VIEW_CHECK, submissionId);
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
