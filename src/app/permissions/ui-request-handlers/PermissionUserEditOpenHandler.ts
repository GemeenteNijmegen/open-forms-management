import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { buildEditResources } from './PermissionsViewModel';
import { loadManageableUsers } from './PermissionUsersLoader';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../shared/lambda/parseFormBody';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../shared/rendering/Renderer';
import { issueCsrfToken, CSRF_FORM_FIELD } from '../../../shared/security/csrf/CsrfProtection';
import { PermissionAdministrationService } from '../administration/PermissionAdministrationService';
import { visiblePermissionsFeature } from '../PermissionsNavigationFeature';
import { PermissionAdministrationRepository } from '../store/PermissionAdministrationRepository';
import permissionEditTemplate from '../templates/permission-edit.mustache';

/**
 * Handles POST /permissions/users/edit: opens the edit page with the target's email in the POST body instead
 * of the URL. This is a read, not a write, so it needs no CSRF check itself; the save forms this page renders
 * each carry their own token for that.
 */
export class PermissionUserEditOpenHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly administrationService: PermissionAdministrationService,
    private readonly repository: PermissionAdministrationRepository,
  ) { }

  async handleRequest(identity: EmployeeIdentity, body: string | undefined, isBase64Encoded: boolean): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const manageable = this.administrationService.manageableResources(context.evaluator);

    if (manageable.length === 0) {
      return this.authorizationService.denyAccess(context, { resource: 'permissions', action: 'view' });
    }

    const targetEmail = parseFormBody(body, isBase64Encoded).get('targetEmail');
    if (!targetEmail) {
      return Response.redirect('/permissions?status=invalid', 303);
    }

    const isGlobalAdmin = this.administrationService.isGlobalAdmin(context.evaluator);
    const users = await loadManageableUsers(this.repository, isGlobalAdmin, manageable.map((definition) => definition.resource));
    const target = users.find((user) => user.email === targetEmail);
    /**
     * No distinction between "target does not exist" and "target exists but outside what this actor may
     * manage": either way, nothing about another resource leaks.
     */
    if (!target) {
      return Response.redirect('/permissions?status=invalid', 303);
    }

    const permissions = this.administrationService.projectUser(context.evaluator, target.grants);
    const csrfToken = issueCsrfToken();
    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];

    const html = render(
      permissionEditTemplate,
      { title: `Rechten van ${target.email}`, features, currentPath: '/permissions', actorEmail: identity.email },
      {
        targetEmail: target.email,
        generalGrants: permissions.generalGrants,
        resources: buildEditResources(manageable, target.grants),
        csrfField: CSRF_FORM_FIELD,
        csrfToken: csrfToken.value,
      },
    );
    return Response.html(html, 200, csrfToken.cookie);
  }
}
