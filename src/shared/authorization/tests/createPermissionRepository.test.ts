import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createPermissionRepository } from '../createPermissionRepository';
import { DynamoDbPermissionRepository } from '../DynamoDbPermissionRepository';

describe('createPermissionRepository', () => {
  const originalEnv = process.env.PERMISSIONS_TABLE;

  afterEach(() => {
    process.env.PERMISSIONS_TABLE = originalEnv;
  });

  it('builds a DynamoDbPermissionRepository when the table name is configured', () => {
    process.env.PERMISSIONS_TABLE = 'test-permissions-table';

    expect(createPermissionRepository(new DynamoDBClient({}))).toBeInstanceOf(DynamoDbPermissionRepository);
  });

  it('throws instead of silently building a client with an undefined table name', () => {
    delete process.env.PERMISSIONS_TABLE;

    expect(() => createPermissionRepository(new DynamoDBClient({}))).toThrow('PERMISSIONS_TABLE environment variable is not set');
  });
});
