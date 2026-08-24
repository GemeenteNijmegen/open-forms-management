import { PermissionGrant } from '../../../../shared/authorization/PermissionGrant';
import { PermissionAdministrationRepository, PermissionAdministrationUser } from '../PermissionAdministrationRepository';

/**
 * In-memory PermissionAdministrationRepository for tests of code that depends on it, without talking to
 * DynamoDB. Mirrors the real repository's filtering: listUsersForResource() only returns users with an
 * explicit grant for that resource, never a user who only has it implicitly through *:*.
 */
export class FakePermissionAdministrationRepository implements PermissionAdministrationRepository {
  private readonly users = new Map<string, PermissionAdministrationUser>();

  seedUsers(...users: PermissionAdministrationUser[]): void {
    for (const user of users) {
      this.users.set(user.email, user);
    }
  }

  async listAllUsers(): Promise<PermissionAdministrationUser[]> {
    return Array.from(this.users.values());
  }

  async listUsersForResource(resource: string): Promise<PermissionAdministrationUser[]> {
    return Array.from(this.users.values())
      .filter((user) => user.grants.some((grant) => grant.resource === resource))
      .map((user) => ({ ...user, grants: user.grants.filter((grant) => grant.resource === resource) }));
  }

  async addResourceGrants(email: string, grants: PermissionGrant[]): Promise<{ subjectCreated: boolean }> {
    const existing = this.users.get(email);
    this.users.set(email, existing
      ? { ...existing, grants: [...existing.grants, ...grants] }
      : { email, hasSubject: true, grants });
    return { subjectCreated: existing === undefined };
  }

  async replaceResourceGrants(email: string, resource: string, grants: PermissionGrant[]): Promise<void> {
    const existing = this.users.get(email) ?? { email, hasSubject: true, grants: [] };
    const otherResourceGrants = existing.grants.filter((grant) => grant.resource !== resource);
    this.users.set(email, { ...existing, grants: [...otherResourceGrants, ...grants] });
  }

  async removeResourceGrants(email: string, resource: string): Promise<{ subjectRemoved: boolean }> {
    const existing = this.users.get(email);
    if (!existing) {
      return { subjectRemoved: false };
    }

    const remainingGrants = existing.grants.filter((grant) => grant.resource !== resource);
    const subjectRemoved = remainingGrants.length === 0;
    if (subjectRemoved) {
      this.users.delete(email);
    } else {
      this.users.set(email, { ...existing, grants: remainingGrants });
    }
    return { subjectRemoved };
  }
}
