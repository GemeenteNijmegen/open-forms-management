import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { DynamoDbPermissionRepository } from './DynamoDbPermissionRepository';

export function createPermissionRepository(dynamoDBClient: DynamoDBClient): DynamoDbPermissionRepository {
  const env = environmentVariables(['PERMISSIONS_TABLE'] as const);
  return new DynamoDbPermissionRepository(DynamoDBDocumentClient.from(dynamoDBClient), env.PERMISSIONS_TABLE);
}
