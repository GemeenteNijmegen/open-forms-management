import { PermissionGrant } from '../../../shared/authorization/PermissionGrant';

export interface PermissionAdministrationUser {
  email: string;
  hasSubject: boolean;
  grants: PermissionGrant[];
}

export interface PermissionAdministrationRepository {
  listAllUsers(): Promise<PermissionAdministrationUser[]>;
  listUsersForResource(resource: string): Promise<PermissionAdministrationUser[]>;

  /**
   * Adds grants for a resource the medewerker doesn't have yet. Creates a subject record too, atomically, if
   * this is their first resource; reuses an existing subject record silently otherwise. Never touches other
   * resources. subjectCreated tells the caller which of the two happened, for audit purposes only: the
   * response shown to the actor stays identical either way.
   */
  addResourceGrants(email: string, grants: PermissionGrant[], createdBy: string): Promise<{ subjectCreated: boolean }>;

  /**
   * Atomically replaces every existing grant of one resource for one medewerker with a new set. Other
   * resources' grants and the subject record are never part of this write.
   */
  replaceResourceGrants(email: string, resource: string, grants: PermissionGrant[], createdBy: string): Promise<void>;

  /**
   * Atomically removes every grant of one resource for one medewerker. Also removes the subject record in the
   * same write, but only when no other resource's grants remain. subjectRemoved tells the caller which
   * happened, for audit purposes only: the actor-facing response never reveals which other resource kept the
   * subject record alive. resourceRemoved is false when the target had no grants for this resource at all, in
   * which case nothing is written and subjectRemoved is always false too.
   */
  removeResourceGrants(email: string, resource: string): Promise<RemoveResourceGrantsResult>;
}

export interface RemoveResourceGrantsResult {
  resourceRemoved: boolean;
  subjectRemoved: boolean;
}
