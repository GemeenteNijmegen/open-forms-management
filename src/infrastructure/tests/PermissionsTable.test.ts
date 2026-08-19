import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Statics } from '../../Statics';
import { PermissionsTable } from '../PermissionsTable';

describe('PermissionsTable', () => {
  const stack = new Stack(new App(), 'TestStack');
  const permissionsTable = new PermissionsTable(stack, 'permissions');
  const readerFunction = new Function(stack, 'reader-function', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
  });
  permissionsTable.table.grantReadData(readerFunction);
  const template = Template.fromStack(stack);

  it('creates exactly one table with email as partition key and resource#grantId as sort key', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      TableName: Statics.permissionsTableName,
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    }));
  });

  it('retains the table on stack deletion', () => {
    template.hasResource('AWS::DynamoDB::Table', Match.objectLike({
      DeletionPolicy: 'Retain',
    }));
  });

  it('grants only read actions to a reader function, no write actions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', Match.objectLike({
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.arrayWith(['dynamodb:Query', 'dynamodb:GetItem']),
          }),
        ]),
      }),
    }));

    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    const grantedActions = policies.flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));

    expect(grantedActions).not.toEqual(expect.arrayContaining([
      'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem',
    ]));
  });
});
