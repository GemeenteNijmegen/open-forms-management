import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { SPORT_SAME_ORIGIN_HEADER } from './SportSameOriginHeader';
import { logger } from '../../../observability/Logger';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { isSameOriginRequest } from '../../../shared/security/SameOriginRequest';

const ALLOWED_EVENTS = [
  'INITIAL_LOAD_FAILED',
  'REFRESH_FAILED',
  'LOAD_MORE_FAILED',
  'UNEXPECTED_JAVASCRIPT_ERROR',
  'UNHANDLED_PROMISE_REJECTION',
] as const;

const MAX_BODY_LENGTH = 2000;
// X-Ray trace IDs look like "1-<hex>-<hex>"; a same-origin request's own X-Correlation-Id is always one of those.
const CORRELATION_ID_PATTERN = /^[\w-]{1,128}$/;

function parseBody(body: string | undefined, isBase64Encoded: boolean): Record<string, unknown> | undefined {
  if (!body) {
    return undefined;
  }
  const text = isBase64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;
  if (text.length > MAX_BODY_LENGTH) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function isAllowedEvent(value: unknown): value is typeof ALLOWED_EVENTS[number] {
  return typeof value === 'string' && (ALLOWED_EVENTS as readonly string[]).includes(value);
}

function extractRelatedCorrelationId(value: unknown): string | undefined {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value) ? value : undefined;
}

/**
 * Handles `POST /sport/client-errors`: a small, best-effort, allowlisted browser telemetry sink. Only
 * technical fields ever reach a log line here; this is operational WARN logging, not an audit event.
 */
export class SportClientErrorHandler {
  constructor(private readonly authorizationService: AuthorizationService) { }

  async handleRequest(
    identity: EmployeeIdentity,
    headers: Record<string, string | undefined> | undefined,
    body: string | undefined,
    isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, { resource: 'sport', action: 'view' });
    if (denied) {
      return denied;
    }

    if (!isSameOriginRequest(headers, SPORT_SAME_ORIGIN_HEADER)) {
      return Response.error(403);
    }

    const parsed = parseBody(body, isBase64Encoded);
    const event = parsed?.event;
    if (!isAllowedEvent(event)) {
      return Response.error(400);
    }

    const relatedCorrelationId = extractRelatedCorrelationId(parsed?.relatedCorrelationId);
    logger.warn('Sport client error reported', { event, ...(relatedCorrelationId ? { relatedCorrelationId } : {}) });

    return Response.ok(202);
  }
}
