import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Statics } from '../../Statics';
import { AuditTrailTable } from '../AuditTrailTable';

describe('AuditTrailTable', () => {
  const stack = new Stack(new App(), 'TestStack');
  const auditTrailTable = new AuditTrailTable(stack, 'audit-trail');
  const writerFunction = new Function(stack, 'writer-function', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
  });
  auditTrailTable.grantPut(writerFunction);
  const template = Template.fromStack(stack);

  it('creates exactly one table with a constant partition key and occurredAt#eventId as sort key', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      TableName: Statics.auditTrailTableName,
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    }));
  });

  it('has no global secondary indexes', () => {
    const table = Object.values(template.findResources('AWS::DynamoDB::Table'))[0] as any;
    expect(table.Properties.GlobalSecondaryIndexes).toBeUndefined();
  });

  it('retains the table on stack deletion', () => {
    template.hasResource('AWS::DynamoDB::Table', Match.objectLike({
      DeletionPolicy: 'Retain',
    }));
  });

  it('has a 2-year retention TTL on the ttl attribute', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    }));
  });

  it('grants only PutItem to a writer function, no update/delete/batch/query actions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', Match.objectLike({
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'dynamodb:PutItem',
          }),
        ]),
      }),
    }));

    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    const grantedActions = policies.flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));

    expect(grantedActions).not.toEqual(expect.arrayContaining([
      'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem', 'dynamodb:Query', 'dynamodb:GetItem',
    ]));
  });
});
