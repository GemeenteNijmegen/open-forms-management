import { PermissionAdministrationRepository, PermissionAdministrationUser } from '../store/PermissionAdministrationRepository';

/**
 * Loads exactly the users an actor may see: every subject for a global admin, or a merge of
 * `listUsersForResource()` across a page admin's manageable resources (usually one, but the grant model allows
 * more than one `<resource>:*` per actor). Shared by the overview list and the edit-open handler so both apply
 * the same resource-isolation rule.
 */
export async function loadManageableUsers(
  repository: PermissionAdministrationRepository, isGlobalAdmin: boolean, manageableResources: string[],
): Promise<PermissionAdministrationUser[]> {
  if (isGlobalAdmin) {
    return repository.listAllUsers();
  }

  const usersByEmail = new Map<string, PermissionAdministrationUser>();
  for (const resource of manageableResources) {
    const users = await repository.listUsersForResource(resource);
    for (const user of users) {
      const existing = usersByEmail.get(user.email);
      usersByEmail.set(user.email, existing ? { ...existing, grants: [...existing.grants, ...user.grants] } : user);
    }
  }
  return Array.from(usersByEmail.values());
}
