import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../shared/rendering/Renderer';
import { CSRF_FORM_FIELD, issueCsrfToken } from '../../../shared/security/csrf/CsrfProtection';
import { PermissionAdministrationService } from '../administration/PermissionAdministrationService';
import { visiblePermissionsFeature } from '../PermissionsNavigationFeature';
import permissionCreateTemplate from '../templates/permission-create.mustache';

/**
 * Handles GET /permissions/users/new. An actor who manages only one resource still gets it automatically.
 * An actor who manages several needs an explicit `?resource=` (the overview links to one URL per
 * resource); without a matching one, this redirects back to the overview rather than silently defaulting
 * to whichever resource happens to be first.
 */
export class PermissionUserCreateOpenHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly administrationService: PermissionAdministrationService,
  ) { }

  async handleRequest(identity: EmployeeIdentity, queryStringParameters?: Record<string, string | undefined>): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const manageable = this.administrationService.manageableResources(context.evaluator);

    if (manageable.length === 0) {
      return this.authorizationService.denyAccess(context, { resource: 'permissions', action: 'create' });
    }

    const requestedResource = queryStringParameters?.resource;
    // An explicit ?resource= is always validated against manageableResources, even when the actor only manages one:
    // a mismatched query never silently falls back to "the one resource I do manage" instead of rejecting it.
    const resource = requestedResource
      ? manageable.find((definition) => definition.resource === requestedResource)
      : (manageable.length === 1 ? manageable[0] : undefined);
    if (!resource) {
      return Response.redirect('/permissions', 303);
    }

    const csrfToken = issueCsrfToken();
    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];

    const html = render(
      permissionCreateTemplate,
      { title: `Nieuwe gebruiker voor ${resource.label}`, features, currentPath: '/permissions/users/new', actorEmail: identity.email },
      {
        resource: resource.resource,
        label: resource.label,
        actions: resource.actions,
        scopes: resource.scopes,
        csrfField: CSRF_FORM_FIELD,
        csrfToken: csrfToken.value,
        showInvalid: queryStringParameters?.status === 'invalid',
      },
    );
    return Response.html(html, 200, csrfToken.cookie);
  }
}
