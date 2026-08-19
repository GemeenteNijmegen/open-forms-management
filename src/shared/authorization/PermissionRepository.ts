import { PermissionGrant } from './PermissionGrant';

export interface PermissionRepository {
  getGrants(email: string): Promise<PermissionGrant[]>;
  putGrant(email: string, grant: PermissionGrant, createdBy?: string): Promise<void>;
}
