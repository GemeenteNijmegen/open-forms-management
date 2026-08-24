import { PermissionCatalog } from '../PermissionCatalog';

describe('PermissionCatalog', () => {
  it('registers sport with the view action and the districts scope, and treats unknown values as invalid', () => {
    const catalog = new PermissionCatalog();

    expect(catalog.isRegisteredResource('sport')).toBe(true);
    expect(catalog.isValidAction('sport', 'view')).toBe(true);
    expect(catalog.isValidScopeValue('sport', 'districts', 'dukenburg')).toBe(true);

    expect(catalog.isRegisteredResource('app2')).toBe(false);
    expect(catalog.isValidAction('sport', 'edit')).toBe(false);
    expect(catalog.isValidScopeValue('sport', 'districts', 'atlantis')).toBe(false);
    // `*` is resource-admin system semantics, never a catalog-registered action.
    expect(catalog.isValidAction('sport', '*')).toBe(false);
  });

  it('stays generic for a fictional resource with its own scope key, without any sport-specific assumptions', () => {
    const catalog = new PermissionCatalog([
      {
        resource: 'app2',
        label: 'App2',
        actions: [{ action: 'edit', label: 'Wijzigen' }],
        scopes: [{ key: 'organisations', label: 'Organisaties', values: [{ value: 'organisatie-a', label: 'Organisatie A' }] }],
      },
    ]);

    expect(catalog.isValidAction('app2', 'edit')).toBe(true);
    expect(catalog.isValidScopeValue('app2', 'organisations', 'organisatie-a')).toBe(true);
    expect(catalog.scopeLabel('app2', 'organisations')).toBe('Organisaties');
    expect(catalog.isRegisteredResource('sport')).toBe(false);
  });
});
