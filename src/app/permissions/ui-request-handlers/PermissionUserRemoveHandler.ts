import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationContext } from '../../../shared/authorization/AuthorizationContext';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../shared/lambda/parseFormBody';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../shared/rendering/Renderer';
import { CSRF_FORM_FIELD, issueCsrfToken, isValidCsrfSubmission } from '../../../shared/security/csrf/CsrfProtection';
import { PermissionAdministrationService } from '../administration/PermissionAdministrationService';
import { PermissionCatalog } from '../catalog/PermissionCatalog';
import { visiblePermissionsFeature } from '../PermissionsNavigationFeature';
import { PermissionAdministrationRepository } from '../store/PermissionAdministrationRepository';
import permissionRemoveConfirmTemplate from '../templates/permission-remove-confirm.mustache';

const PERMISSIONS_REMOVE_CHECK = { resource: 'permissions', action: 'remove' };

/**
 * Handles POST /permissions/users/remove in two steps on the same route, no separate confirm route needed:
 * without a confirmed field it renders a confirmation page with a fresh CSRF token; with it, it actually
 * removes. Both steps require a valid CSRF token, since both originate from a form this server just rendered.
 * The redirect and rendered feedback never say whether the subject record was also removed: that only changes
 * which audit event type gets recorded, not what the actor sees.
 */
export class PermissionUserRemoveHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly administrationService: PermissionAdministrationService,
    private readonly catalog: PermissionCatalog,
    private readonly repository: PermissionAdministrationRepository,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const form = parseFormBody(body, isBase64Encoded);

    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      return this.authorizationService.denyAccess(context, PERMISSIONS_REMOVE_CHECK);
    }

    const targetEmail = form.get('targetEmail');
    const resource = form.get('resource');
    if (!targetEmail || !resource || !this.catalog.isRegisteredResource(resource)) {
      return Response.redirect('/permissions?status=invalid', 303);
    }

    // A hidden resource field is never trusted as authorization proof; the actor's current grants decide again.
    const canManage = this.administrationService.manageableResources(context.evaluator).some((definition) => definition.resource === resource);
    if (!canManage) {
      return this.authorizationService.denyAccess(context, { resource, action: 'remove' });
    }

    if (form.get('confirmed') !== '1') {
      return this.renderConfirmation(identity, context, targetEmail, resource);
    }

    const { subjectRemoved } = await this.repository.removeResourceGrants(targetEmail, resource);

    await recordAudit(this.auditTrail, {
      eventType: subjectRemoved ? 'PERMISSION_SUBJECT_REMOVED' : 'PERMISSION_RESOURCE_REMOVED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource,
      targetEmail,
      ...(identity.email ? { actorEmail: identity.email } : {}),
    });

    return Response.redirect('/permissions?status=removed', 303);
  }

  private renderConfirmation(identity: EmployeeIdentity, context: AuthorizationContext, targetEmail: string, resource: string): ApiGatewayV2Response {
    const csrfToken = issueCsrfToken();
    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const resourceLabel = this.catalog.resourceLabel(resource);

    const html = render(
      permissionRemoveConfirmTemplate,
      { title: `Verwijderen uit ${resourceLabel}`, features, currentPath: '/permissions', actorEmail: identity.email },
      { targetEmail, resource, resourceLabel, csrfField: CSRF_FORM_FIELD, csrfToken: csrfToken.value },
    );
    return Response.html(html, 200, csrfToken.cookie);
  }
}
