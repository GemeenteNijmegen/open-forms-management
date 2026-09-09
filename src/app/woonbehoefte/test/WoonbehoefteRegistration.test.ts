import { PermissionEvaluator } from '../../../shared/authorization/PermissionEvaluator';
import { visibleFeatures } from '../../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../../shared/navigation/RegisteredFeatures';
import { REGISTERED_PERMISSION_RESOURCES } from '../../permissions/catalog/RegisteredPermissionResources';
import { visiblePermissionsFeature } from '../../permissions/PermissionsNavigationFeature';

describe('Woonbehoefte permission/navigation registration', () => {
  it('registers woonbehoefte with view, manage and exceloverzicht actions and no scopes', () => {
    const resource = REGISTERED_PERMISSION_RESOURCES.find((entry) => entry.resource === 'woonbehoefte');
    expect(resource).toEqual({
      resource: 'woonbehoefte',
      label: 'Woonbehoefte',
      actions: [
        { action: 'view', label: 'Bekijken' },
        { action: 'manage', label: 'Behandelen' },
        { action: 'exceloverzicht', label: 'Excel-overzichten' },
      ],
      scopes: [],
    });
  });

  it('registers two woonbehoefte nav entries sharing a dedupeKey: view -> /woonbehoefte, exceloverzicht -> /woonbehoefte/overzichten', () => {
    const woonbehoefteEntries = REGISTERED_FEATURES.filter((entry) => entry.resource === 'woonbehoefte');
    expect(woonbehoefteEntries).toEqual([
      expect.objectContaining({ route: '/woonbehoefte', action: 'view', dedupeKey: 'woonbehoefte' }),
      expect.objectContaining({ route: '/woonbehoefte/overzichten', action: 'exceloverzicht', dedupeKey: 'woonbehoefte' }),
    ]);
  });

  it('routes a medewerker with woonbehoefte:view to /woonbehoefte', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['view'] }]);
    expect(visibleFeatures(REGISTERED_FEATURES, evaluator)).toEqual([
      expect.objectContaining({ route: '/woonbehoefte', resource: 'woonbehoefte', action: 'view' }),
    ]);
  });

  it('routes a medewerker with only woonbehoefte:exceloverzicht to /woonbehoefte/overzichten', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]);
    expect(visibleFeatures(REGISTERED_FEATURES, evaluator)).toEqual([
      expect.objectContaining({ route: '/woonbehoefte/overzichten', resource: 'woonbehoefte', action: 'exceloverzicht' }),
    ]);
  });

  it('routes a medewerker with both woonbehoefte:view and woonbehoefte:exceloverzicht to a single item at /woonbehoefte', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['view', 'exceloverzicht'] }]);
    expect(visibleFeatures(REGISTERED_FEATURES, evaluator)).toEqual([
      expect.objectContaining({ route: '/woonbehoefte', resource: 'woonbehoefte', action: 'view' }),
    ]);
  });

  it('shows no woonbehoefte nav item for a medewerker with only woonbehoefte:manage: manage implies neither view nor exceloverzicht', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['manage'] }]);
    expect(visibleFeatures(REGISTERED_FEATURES, evaluator).filter((f) => f.resource === 'woonbehoefte')).toEqual([]);
  });

  it('routes a woonbehoefte resource-admin via the wildcard action to /woonbehoefte', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['*'] }]);
    expect(visibleFeatures(REGISTERED_FEATURES, evaluator)).toEqual([
      expect.objectContaining({ route: '/woonbehoefte', resource: 'woonbehoefte', action: 'view' }),
    ]);
  });

  it('shows Gebruikers for a woonbehoefte resource-admin, so they can manage woonbehoefte grants', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['*'] }]);
    expect(visiblePermissionsFeature(evaluator)).toHaveLength(1);
  });

  it('still shows sport, unaffected by the woonbehoefte dedupe entries', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'sport', actions: ['view'] }]);
    expect(visibleFeatures(REGISTERED_FEATURES, evaluator).map((f) => f.id)).toEqual(['sport']);
  });
});
