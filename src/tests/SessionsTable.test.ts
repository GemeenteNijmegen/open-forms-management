import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SessionsTable } from '../SessionsTable';
import { Statics } from '../Statics';

describe('SessionsTable', () => {
  const stack = new Stack(new App(), 'TestStack');
  new SessionsTable(stack, 'sessions');
  const template = Template.fromStack(stack);

  it('creates exactly one table with sessionid as partition key and ttl as the TTL attribute', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      TableName: Statics.sessionsTableName,
      KeySchema: [{ AttributeName: 'sessionid', KeyType: 'HASH' }],
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    }));
  });
});
