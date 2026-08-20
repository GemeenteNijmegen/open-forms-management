import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbPermissionRepository } from './DynamoDbPermissionRepository';
import { logger } from '../../observability/Logger';

export function createPermissionRepository(dynamoDBClient: DynamoDBClient): DynamoDbPermissionRepository {
  const tableName = process.env.PERMISSIONS_TABLE;
  if (!tableName) {
    logger.error('PERMISSIONS_TABLE environment variable is not set');
    throw new Error('PERMISSIONS_TABLE environment variable is not set');
  }

  return new DynamoDbPermissionRepository(DynamoDBDocumentClient.from(dynamoDBClient), tableName);
}
