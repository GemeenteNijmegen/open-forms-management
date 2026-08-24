import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { PermissionAdministrationRepository, PermissionAdministrationUser } from './PermissionAdministrationRepository';
import { logger } from '../../../observability/Logger';
import { PermissionGrant } from '../../../shared/authorization/PermissionGrant';
import { grantToItem, isSubjectItem, subjectToItem, SUBJECT_SORT_KEY, toPermissionGrant } from '../../../shared/authorization/PermissionTableItem';

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

  async addResourceGrants(email: string, grants: PermissionGrant[], createdBy: string): Promise<{ subjectCreated: boolean }> {
    const hasSubject = await this.subjectExists(email);
    const grantItems = grants.map((grant) => grantToItem(email, grant, createdBy));

    /**
     * attribute_not_exists(sk) guards the astronomically unlikely sk (uuid) collision, same as the old runtime
     * putGrant() did. The subject Put also protects the small race window between the subjectExists() read
     * above and this write: two concurrent first-resource writes for the same medewerker can't both succeed.
     */
    const subjectItem = hasSubject ? [] : [{ Put: { TableName: this.tableName, Item: subjectToItem(email, createdBy), ConditionExpression: 'attribute_not_exists(sk)' } }];
    await this.documentClient.send(new TransactWriteCommand({
      TransactItems: [
        ...subjectItem,
        ...grantItems.map((item) => ({ Put: { TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(sk)' } })),
      ],
    }));

    logger.debug('Permission resource grants added', { hasSubject });
    return { subjectCreated: !hasSubject };
  }

  async replaceResourceGrants(email: string, resource: string, grants: PermissionGrant[], createdBy: string): Promise<void> {
    const existingKeys = await this.queryResourceGrantKeys(email, resource);
    const grantItems = grants.map((grant) => grantToItem(email, grant, createdBy));

    await this.documentClient.send(new TransactWriteCommand({
      TransactItems: [
        ...existingKeys.map((key) => ({ Delete: { TableName: this.tableName, Key: key } })),
        ...grantItems.map((item) => ({ Put: { TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(sk)' } })),
      ],
    }));

    logger.debug('Permission resource grants replaced', { resource, replacedCount: existingKeys.length });
  }

  async removeResourceGrants(email: string, resource: string): Promise<{ subjectRemoved: boolean }> {
    const items = await this.queryAllItems(email);
    const resourceKeys = items
      .filter((item) => typeof item.sk === 'string' && item.sk.startsWith(`${resource}#`))
      .map((item) => ({ pk: email, sk: item.sk as string }));
    const hasOtherResourceGrants = items.some((item) => !isSubjectItem(item) && typeof item.resource === 'string' && item.resource !== resource);
    const subjectRemoved = !hasOtherResourceGrants;

    await this.documentClient.send(new TransactWriteCommand({
      TransactItems: [
        ...resourceKeys.map((key) => ({ Delete: { TableName: this.tableName, Key: key } })),
        ...(subjectRemoved ? [{ Delete: { TableName: this.tableName, Key: { pk: email, sk: SUBJECT_SORT_KEY } } } as const] : []),
      ],
    }));

    logger.debug('Permission resource grants removed', { resource, removedCount: resourceKeys.length, subjectRemoved });
    return { subjectRemoved };
  }

  private async queryAllItems(email: string): Promise<Record<string, unknown>[]> {
    const result = await this.documentClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': email },
    }));
    return result.Items ?? [];
  }

  private async subjectExists(email: string): Promise<boolean> {
    const result = await this.documentClient.send(new GetCommand({ TableName: this.tableName, Key: { pk: email, sk: SUBJECT_SORT_KEY } }));
    return result.Item !== undefined;
  }

  // Resource-scoped without a GSI: sk is `<resource>#<uuid>`, see PermissionsTable.ts.
  private async queryResourceGrantKeys(email: string, resource: string): Promise<{ pk: string; sk: string }[]> {
    const result = await this.documentClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': email, ':prefix': `${resource}#` },
    }));
    return (result.Items ?? []).map((item) => ({ pk: item.pk as string, sk: item.sk as string }));
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
