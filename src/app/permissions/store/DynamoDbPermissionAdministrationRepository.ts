import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { PermissionAdministrationRepository, PermissionAdministrationUser } from './PermissionAdministrationRepository';
import { logger } from '../../../observability/Logger';
import { isSubjectItem, toPermissionGrant } from '../../../shared/authorization/PermissionTableItem';

/**
 * Aggregates the whole permissions table in memory for the beheeroverzicht. The table has no GSI and the number
 * of beheeraccounts is small, so a paginated Scan is preferred over adding one just for this screen.
 */
export class DynamoDbPermissionAdministrationRepository implements PermissionAdministrationRepository {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  async listAllUsers(): Promise<PermissionAdministrationUser[]> {
    const items = await this.scanAll();
    return this.groupByEmail(items);
  }

  async listUsersForResource(resource: string): Promise<PermissionAdministrationUser[]> {
    const items = await this.scanAll();
    return this.groupByEmail(items)
      .filter((user) => user.grants.some((grant) => grant.resource === resource))
      .map((user) => ({ ...user, grants: user.grants.filter((grant) => grant.resource === resource) }));
  }

  private groupByEmail(items: Record<string, unknown>[]): PermissionAdministrationUser[] {
    const usersByEmail = new Map<string, PermissionAdministrationUser>();

    for (const item of items) {
      if (typeof item.pk !== 'string' || item.pk.length === 0) {
        logger.warn('Ignoring permission table item with an invalid pk', { sk: item.sk });
        continue;
      }

      const user = usersByEmail.get(item.pk) ?? { email: item.pk, hasSubject: false, grants: [] };

      if (isSubjectItem(item)) {
        user.hasSubject = true;
      } else {
        const grant = toPermissionGrant(item);
        if (grant) {
          user.grants.push(grant);
        }
      }

      usersByEmail.set(item.pk, user);
    }

    return Array.from(usersByEmail.values());
  }

  private async scanAll(): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.documentClient.send(new ScanCommand({
        TableName: this.tableName,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));
      items.push(...(result.Items ?? []));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
  }
}
