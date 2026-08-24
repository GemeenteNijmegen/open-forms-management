import { PermissionGrant } from '../PermissionGrant';
import { PermissionRepository } from '../PermissionRepository';

/**
 * In-memory PermissionRepository for tests of code that depends on
 * PermissionRepository, without talking to DynamoDB.
 */
export class FakePermissionRepository implements PermissionRepository {
  private readonly grantsByEmail = new Map<string, PermissionGrant[]>();

  // Sets a medewerker's grants straight into the map for test setup, no repository round-trip.
  seedGrants(email: string, grants: PermissionGrant[]): void {
    this.grantsByEmail.set(email, grants);
  }

  async getGrants(email: string): Promise<PermissionGrant[]> {
    return this.grantsByEmail.get(email) ?? [];
  }
}
