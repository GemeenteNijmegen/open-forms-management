import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { parsePermissionGrantRequest } from './PermissionRequestValidation';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { PermissionGrant } from '../../../shared/authorization/PermissionGrant';
import { parseFormBody } from '../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../shared/security/csrf/CsrfProtection';
import { PermissionAdministrationService } from '../administration/PermissionAdministrationService';
import { PermissionCatalog } from '../catalog/PermissionCatalog';
import { PermissionAdministrationRepository } from '../store/PermissionAdministrationRepository';

const PERMISSIONS_UPDATE_CHECK = { resource: 'permissions', action: 'update' };

/**
 * Handles POST /permissions/users/update: CSRF, then parse, then policy check, then replace, then audit, then
 * redirect. Replaces every existing grant of exactly one resource; other resources are never part of the
 * write. On any validation or authorization failure this redirects to the overview instead of back to the edit
 * page: the edit page only opens through a POST with the target email in the body, so a plain GET redirect has
 * no way to reopen it with the same target.
 */
export class PermissionUserUpdateHandler {
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
      return this.authorizationService.denyAccess(context, PERMISSIONS_UPDATE_CHECK);
    }

    const parsed = parsePermissionGrantRequest(form, this.catalog);
    if (!parsed) {
      return Response.redirect('/permissions?status=invalid', 303);
    }

    /**
     * A hidden resource field in the form is never trusted as authorization proof; the actor's actual,
     * current grants decide this again on every request.
     */
    const canManage = this.administrationService.manageableResources(context.evaluator).some((definition) => definition.resource === parsed.resource);
    if (!canManage) {
      return this.authorizationService.denyAccess(context, { resource: parsed.resource, action: 'update' });
    }

    const grant: PermissionGrant = parsed.isResourceAdmin
      ? { resource: parsed.resource, actions: ['*'] }
      : { resource: parsed.resource, actions: parsed.actions, ...(parsed.scopes ? { scopes: parsed.scopes } : {}) };

    await this.repository.replaceResourceGrants(parsed.targetEmail, parsed.resource, [grant], identity.email ?? identity.principalId);

    await recordAudit(this.auditTrail, {
      eventType: 'PERMISSION_RESOURCE_CHANGED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: parsed.resource,
      targetEmail: parsed.targetEmail,
      ...(identity.email ? { actorEmail: identity.email } : {}),
    });

    return Response.redirect('/permissions?status=updated', 303);
  }
}
