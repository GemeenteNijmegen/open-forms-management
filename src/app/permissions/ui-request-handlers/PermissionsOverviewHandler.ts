import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { buildOverviewRecord, PermissionOverviewUserViewModel } from './PermissionsViewModel';
import { loadManageableUsers } from './PermissionUsersLoader';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../shared/authorization/PermissionEvaluator';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { render } from '../../../shared/rendering/Renderer';
import { PermissionAdministrationService } from '../administration/PermissionAdministrationService';
import { visiblePermissionsFeature } from '../PermissionsNavigationFeature';
import { PermissionAdministrationRepository, PermissionAdministrationUser } from '../store/PermissionAdministrationRepository';
import permissionsTemplate from '../templates/permissions.mustache';

/** Purely descriptive audit metadata: "permissions" is not a catalog resource or a grant, just a label for the log. */
const PERMISSIONS_ACCESS_CHECK = { resource: 'permissions', action: 'view' };

/** Matches the ?status= values the create/update/remove handlers redirect back here with. */
const FLASH_MESSAGES: Record<string, string> = {
  created: 'Gebruiker en rechten opgeslagen.',
  updated: 'Rechten opgeslagen.',
  removed: 'Rechten verwijderd.',
  invalid: 'De aanvraag kon niet worden verwerkt.',
};

export class PermissionsOverviewHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly administrationService: PermissionAdministrationService,
    private readonly repository: PermissionAdministrationRepository,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, queryStringParameters?: Record<string, string | undefined>,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const manageable = this.administrationService.manageableResources(context.evaluator);

    if (manageable.length === 0) {
      return this.authorizationService.denyAccess(context, PERMISSIONS_ACCESS_CHECK);
    }

    const isGlobalAdmin = this.administrationService.isGlobalAdmin(context.evaluator);
    const users = await loadManageableUsers(this.repository, isGlobalAdmin, manageable.map((definition) => definition.resource));

    const records = users
      .map((user) => this.buildRecord(context.evaluator, user))
      .sort((a, b) => a.email.localeCompare(b.email));

    const status = queryStringParameters?.status;
    const message = status ? FLASH_MESSAGES[status] : undefined;
    const alertVariant = status === 'invalid' ? 'error' : 'ok';
    const alertRole = status === 'invalid' ? 'alert' : 'status';
    const features = [...visibleFeatures(REGISTERED_FEATURES, context.evaluator), ...visiblePermissionsFeature(context.evaluator)];
    const html = render(
      permissionsTemplate,
      { title: 'Gebruikers en rechten', features, currentPath: '/permissions', actorEmail: identity.email },
      { records, message, alertVariant, alertRole },
    );
    return Response.html(html);
  }

  private buildRecord(actor: PermissionEvaluator, user: PermissionAdministrationUser): PermissionOverviewUserViewModel {
    const permissions = this.administrationService.projectUser(actor, user.grants);
    return buildOverviewRecord(user.email, permissions);
  }
}
