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

const PERMISSIONS_CREATE_CHECK = { resource: 'permissions', action: 'create' };

/** Handles `POST /permissions/users/create`: CSRF -> parse -> policy -> write -> audit -> redirect. */
export class PermissionUserCreateHandler {
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
      return this.authorizationService.denyAccess(context, PERMISSIONS_CREATE_CHECK);
    }

    const parsed = parsePermissionGrantRequest(form, this.catalog);
    if (!parsed) {
      return Response.redirect('/permissions/users/new?status=invalid', 303);
    }

    /**
     * The catalog only proved the resource is registered; this proves the actor may actually manage it. A
     * browser-supplied resource field is never trusted as authorization on its own.
     */
    const canManage = this.administrationService.manageableResources(context.evaluator).some((definition) => definition.resource === parsed.resource);
    if (!canManage) {
      return this.authorizationService.denyAccess(context, { resource: parsed.resource, action: 'create' });
    }

    const grant: PermissionGrant = parsed.isResourceAdmin
      ? { resource: parsed.resource, actions: ['*'] }
      : { resource: parsed.resource, actions: parsed.actions, ...(parsed.scopes ? { scopes: parsed.scopes } : {}) };

    const { subjectCreated } = await this.repository.addResourceGrants(parsed.targetEmail, [grant], identity.email ?? identity.principalId);

    /**
     * The actor never learns whether the subject already existed for another resource; only the audit event
     * type differs here, the response is the same either way.
     */
    await recordAudit(this.auditTrail, {
      eventType: subjectCreated ? 'PERMISSION_SUBJECT_CREATED' : 'PERMISSION_RESOURCE_ADDED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: parsed.resource,
      targetEmail: parsed.targetEmail,
      ...(identity.email ? { actorEmail: identity.email } : {}),
    });

    return Response.redirect('/permissions?status=created', 303);
  }
}
