import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbAuditTrail } from './DynamoDbAuditTrail';
import { logger } from '../../observability/Logger';

export function createAuditTrail(dynamoDBClient: DynamoDBClient): DynamoDbAuditTrail {
  const tableName = process.env.AUDIT_TRAIL_TABLE;
  if (!tableName) {
    logger.error('AUDIT_TRAIL_TABLE environment variable is not set');
    throw new Error('AUDIT_TRAIL_TABLE environment variable is not set');
  }

  return new DynamoDbAuditTrail(DynamoDBDocumentClient.from(dynamoDBClient), tableName);
}
