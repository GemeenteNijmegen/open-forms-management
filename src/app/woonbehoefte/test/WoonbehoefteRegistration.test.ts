import { PermissionEvaluator } from '../../../shared/authorization/PermissionEvaluator';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { REGISTERED_PERMISSION_RESOURCES } from '../../permissions/catalog/RegisteredPermissionResources';
import { visiblePermissionsFeature } from '../../permissions/PermissionsNavigationFeature';

describe('Woonbehoefte permission/navigation registration', () => {
  it('registers woonbehoefte with view and manage actions and no scopes', () => {
    const resource = REGISTERED_PERMISSION_RESOURCES.find((entry) => entry.resource === 'woonbehoefte');
    expect(resource).toEqual({
      resource: 'woonbehoefte',
      label: 'Woonbehoefte',
      actions: [
        { action: 'view', label: 'Bekijken' },
        { action: 'manage', label: 'Behandelen' },
      ],
      scopes: [],
    });
  });

  it('registers the woonbehoefte nav item gated on woonbehoefte:view', () => {
    const feature = REGISTERED_FEATURES.find((entry) => entry.id === 'woonbehoefte');
    expect(feature).toEqual(expect.objectContaining({ route: '/woonbehoefte', resource: 'woonbehoefte', action: 'view' }));
  });

  it('shows the nav item for a medewerker with woonbehoefte:view', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['view'] }]);
    expect(visibleFeatures(REGISTERED_FEATURES, evaluator).map((f) => f.id)).toContain('woonbehoefte');
  });

  it('does not show the nav item for a medewerker with only woonbehoefte:manage: manage does not imply view', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['manage'] }]);
    expect(visibleFeatures(REGISTERED_FEATURES, evaluator).map((f) => f.id)).not.toContain('woonbehoefte');
  });

  it('shows the nav item for a woonbehoefte resource-admin via the wildcard action', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['*'] }]);
    expect(visibleFeatures(REGISTERED_FEATURES, evaluator).map((f) => f.id)).toContain('woonbehoefte');
  });

  it('shows Gebruikers for a woonbehoefte resource-admin, so they can manage woonbehoefte grants', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['*'] }]);
    expect(visiblePermissionsFeature(evaluator)).toHaveLength(1);
  });
});
