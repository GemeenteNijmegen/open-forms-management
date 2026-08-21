import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createAuditTrail } from '../createAuditTrail';
import { DynamoDbAuditTrail } from '../DynamoDbAuditTrail';

describe('createAuditTrail', () => {
  const originalEnv = process.env.AUDIT_TRAIL_TABLE;

  afterEach(() => {
    process.env.AUDIT_TRAIL_TABLE = originalEnv;
  });

  it('builds a DynamoDbAuditTrail when the table name is configured', () => {
    process.env.AUDIT_TRAIL_TABLE = 'test-audit-trail-table';

    expect(createAuditTrail(new DynamoDBClient({}))).toBeInstanceOf(DynamoDbAuditTrail);
  });

  it('throws instead of silently building a client with an undefined table name', () => {
    delete process.env.AUDIT_TRAIL_TABLE;

    expect(() => createAuditTrail(new DynamoDBClient({}))).toThrow('AUDIT_TRAIL_TABLE environment variable is not set');
  });
});
