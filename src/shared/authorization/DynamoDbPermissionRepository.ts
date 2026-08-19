import { randomUUID } from 'crypto';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PermissionGrant } from './PermissionGrant';
import { PermissionRepository } from './PermissionRepository';
import { logger } from '../../observability/Logger';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isScopesRecord(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => isStringArray(entry));
}

export class DynamoDbPermissionRepository implements PermissionRepository {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  async getGrants(email: string): Promise<PermissionGrant[]> {
    const result = await this.documentClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': email },
    }));

    logger.debug('Permission query completed', { grantCount: result.Items?.length ?? 0 });

    return (result.Items ?? [])
      .map((item) => this.toPermissionGrant(item))
      .filter((grant): grant is PermissionGrant => grant !== undefined);
  }

  async putGrant(email: string, grant: PermissionGrant, createdBy?: string): Promise<void> {
    if (grant.resource.length === 0) {
      throw new Error('Cannot write a permission grant with an empty resource');
    }
    if (grant.actions.length === 0) {
      throw new Error('Cannot write a permission grant with no actions');
    }

    const sk = `${grant.resource}#${randomUUID()}`;

    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: email,
        sk,
        resource: grant.resource,
        actions: grant.actions,
        ...(grant.scopes ? { scopes: grant.scopes } : {}),
        createdAt: new Date().toISOString(),
        ...(createdBy ? { createdBy } : {}),
      },
      // pk alone isn't unique per employee; this stops a sk collision from silently overwriting an existing grant.
      ConditionExpression: 'attribute_not_exists(sk)',
    }));

    logger.debug('Permission grant written', { resource: grant.resource });
  }

  private toPermissionGrant(item: Record<string, unknown>): PermissionGrant | undefined {
    if (typeof item.resource !== 'string' || item.resource.length === 0) {
      logger.warn('Ignoring permission grant with an invalid resource', { sk: item.sk });
      return undefined;
    }

    if (!isStringArray(item.actions) || item.actions.length === 0) {
      logger.warn('Ignoring permission grant with invalid actions', { sk: item.sk, resource: item.resource });
      return undefined;
    }

    if (item.scopes !== undefined && !isScopesRecord(item.scopes)) {
      logger.warn('Ignoring permission grant with invalid scopes', { sk: item.sk, resource: item.resource });
      return undefined;
    }

    return {
      resource: item.resource,
      actions: item.actions,
      ...(item.scopes ? { scopes: item.scopes as Record<string, string[]> } : {}),
    };
  }
}
