import { PermissionEvaluator } from '../../../shared/authorization/PermissionEvaluator';
import { PermissionCatalog } from '../catalog/PermissionCatalog';

/**
 * Answers "may this actor manage resource X's grants?", not "may this actor perform action Y on resource X?"
 * (that's PermissionEvaluator's job, reused here instead of duplicated). Deny by default: an unregistered
 * resource is never manageable, even for a global admin.
 */
export class PermissionAdministrationPolicy {
  constructor(private readonly catalog: PermissionCatalog) { }

  canManageResource(actor: PermissionEvaluator, resource: string): boolean {
    if (!this.catalog.isRegisteredResource(resource)) {
      return false;
    }
    // Matches exactly: global admin (*:*), or a wildcard grant for this specific resource (<resource>:*).
    return actor.evaluate({ resource, action: '*' }) === 'ALLOW';
  }

  // Only a global admin may hand out *:*; a resource admin managing their own resource can never reach this.
  canGrantGlobalAdmin(actor: PermissionEvaluator): boolean {
    return actor.evaluate({ resource: '*', action: '*' }) === 'ALLOW';
  }
}
