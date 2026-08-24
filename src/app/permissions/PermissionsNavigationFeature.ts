import { PermissionAdministrationPolicy } from './administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from './administration/PermissionAdministrationService';
import { PermissionCatalog } from './catalog/PermissionCatalog';
import { PermissionEvaluator } from '../../shared/authorization/PermissionEvaluator';
import { Feature } from '../../shared/navigation/Feature';

/**
 * resource/action here are never evaluated (this Feature is never passed through visibleFeatures()); they
 * exist only to satisfy Feature's shape, since this page's visibility rule does not fit a single
 * resource/action check.
 */
const PERMISSIONS_FEATURE: Feature = { id: 'permissions', label: 'Gebruikers', route: '/permissions', resource: 'permissions', action: 'view' };

const catalog = new PermissionCatalog();
const administrationService = new PermissionAdministrationService(catalog, new PermissionAdministrationPolicy(catalog));

/**
 * "Gebruikers" has no single resource/action pair to check through the normal Feature/visibleFeatures
 * gate: it is visible for a global admin grant, or for at least one registered resource's own admin grant, an
 * OR across a dynamic resource list. Every page handler merges this in alongside visibleFeatures().
 */
export function visiblePermissionsFeature(evaluator: PermissionEvaluator): Feature[] {
  return administrationService.manageableResources(evaluator).length > 0 ? [PERMISSIONS_FEATURE] : [];
}
