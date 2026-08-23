import { PermissionGrant } from '../../../shared/authorization/PermissionGrant';

export interface PermissionAdministrationUser {
  email: string;
  hasSubject: boolean;
  grants: PermissionGrant[];
}

export interface PermissionAdministrationRepository {
  listAllUsers(): Promise<PermissionAdministrationUser[]>;
  listUsersForResource(resource: string): Promise<PermissionAdministrationUser[]>;
}
