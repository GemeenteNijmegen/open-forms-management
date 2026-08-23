import { PermissionGrant } from './PermissionGrant';

export interface PermissionRepository {
  getGrants(email: string): Promise<PermissionGrant[]>;
}
