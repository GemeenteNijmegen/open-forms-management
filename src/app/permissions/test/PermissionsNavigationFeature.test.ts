import { PermissionEvaluator } from '../../../shared/authorization/PermissionEvaluator';
import { visiblePermissionsFeature } from '../PermissionsNavigationFeature';

describe('visiblePermissionsFeature', () => {
  it('is visible for a global admin', () => {
    const evaluator = new PermissionEvaluator([{ resource: '*', actions: ['*'] }]);

    expect(visiblePermissionsFeature(evaluator)).toEqual([expect.objectContaining({ route: '/permissions', label: 'Gebruikers' })]);
  });

  it('is visible for a sport admin, via <resource>:*, without a fake permissions:view grant', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'sport', actions: ['*'] }]);

    expect(visiblePermissionsFeature(evaluator)).toHaveLength(1);
  });

  it('is not visible for a regular sport user with only the view action', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'sport', actions: ['view'] }]);

    expect(visiblePermissionsFeature(evaluator)).toEqual([]);
  });

  it('is not visible for a medewerker with no grants at all', () => {
    expect(visiblePermissionsFeature(new PermissionEvaluator([]))).toEqual([]);
  });
});
