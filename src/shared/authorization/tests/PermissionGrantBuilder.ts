import { PermissionGrant } from '../PermissionGrant';

export function aPermissionGrant(overrides: Partial<PermissionGrant> = {}): PermissionGrant {
  return {
    resource: 'testresource',
    actions: ['view'],
    ...overrides,
  };
}
