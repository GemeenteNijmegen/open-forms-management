import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PermissionGrant } from './PermissionGrant';
import { PermissionRepository } from './PermissionRepository';
import { isSubjectItem, toPermissionGrant } from './PermissionTableItem';
import { logger } from '../../observability/Logger';

export class DynamoDbPermissionRepository implements PermissionRepository {
  constructor(private readonly documentClient: DynamoDBDocumentClient, private readonly tableName: string) { }

  async getGrants(email: string): Promise<PermissionGrant[]> {
    const result = await this.documentClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': email },
    }));

    logger.debug('Permission query completed', { itemCount: result.Items?.length ?? 0 });

    return (result.Items ?? [])
      .filter((item) => !isSubjectItem(item))
      .map((item) => toPermissionGrant(item))
      .filter((grant): grant is PermissionGrant => grant !== undefined);
  }
}
