import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { AuthorizationContext } from './AuthorizationContext';
import { PermissionCheck, PermissionEvaluator } from './PermissionEvaluator';
import { PermissionRepository } from './PermissionRepository';
import { logger } from '../../observability/Logger';
import { countMetric } from '../../observability/Metrics';
import { xRayTraceId } from '../../observability/xRayTraceId';
import { AuditTrail } from '../audit/AuditTrail';
import { recordAudit } from '../audit/recordAudit';
import { EmployeeIdentity } from '../auth/EmployeeIdentity';
import { render } from '../rendering/Renderer';
import forbiddenTemplate from '../rendering/templates/forbidden.mustache';

/**
 * Loads a medewerker's permission grants after session authentication, and
 * checks individual resource/action/scope requests against them. Route
 * handlers call this instead of writing their own admin/wildcard checks.
 */
export class AuthorizationService {
  constructor(private readonly permissionRepository: PermissionRepository, private readonly auditTrail: AuditTrail) { }

  async loadContext(identity: EmployeeIdentity): Promise<AuthorizationContext> {
    if (!identity.email) {
      logger.warn('Cannot load permission grants for an identity without an email');
      return { identity, evaluator: new PermissionEvaluator([]) };
    }

    const grants = await this.permissionRepository.getGrants(identity.email);
    return { identity, evaluator: new PermissionEvaluator(grants) };
  }

  /**
   * Returns a 403 response when denied, or undefined when the handler should proceed.
   */
  async requireAuthorization(context: AuthorizationContext, check: PermissionCheck): Promise<ApiGatewayV2Response | undefined> {
    const decision = context.evaluator.evaluate(check);
    logger.debug('Permission decision evaluated', { resource: check.resource, action: check.action, decision });

    if (decision === 'ALLOW') {
      return undefined;
    }

    logger.info('Access denied', { resource: check.resource, action: check.action });
    countMetric('AccessDenied');
    await recordAudit(this.auditTrail, {
      eventType: 'ACCESS_DENIED',
      outcome: 'DENIED',
      correlationId: xRayTraceId(),
      resource: check.resource,
      action: check.action,
      ...(context.identity.email ? { actorEmail: context.identity.email } : {}),
    });
    const html = render(forbiddenTemplate, { title: 'Geen toegang', features: [], currentPath: '/', actorEmail: context.identity.email });
    return Response.html(html, 403);
  }
}
