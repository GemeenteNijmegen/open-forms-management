import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { ProjectDetailsStore } from './ProjectDetailsStore';

export function createProjectDetailsStore(dynamoDBClient: DynamoDBClient): ProjectDetailsStore {
  const env = environmentVariables(['WOONBEHOEFTE_PROJECT_DETAILS_TABLE'] as const);
  return new ProjectDetailsStore(DynamoDBDocumentClient.from(dynamoDBClient), env.WOONBEHOEFTE_PROJECT_DETAILS_TABLE);
}
