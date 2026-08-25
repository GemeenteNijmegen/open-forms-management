import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Statics } from '../../../Statics';
import { WoonbehoefteCaseVersionsTable } from '../WoonbehoefteCaseVersionsTable';

describe('WoonbehoefteCaseVersionsTable', () => {
  const stack = new Stack(new App(), 'TestStack');
  const versionsTable = new WoonbehoefteCaseVersionsTable(stack, 'case-versions');
  const worker = new Function(stack, 'worker', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
  });
  versionsTable.grantWriterAccess(worker);
  const template = Template.fromStack(stack);

  it('creates exactly one table with pk/sk as its keys, PITR enabled and no GSI', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      TableName: Statics.woonbehoefteCaseVersionsTableName,
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      GlobalSecondaryIndexes: Match.absent(),
    }));
  });

  it('retains the table on stack deletion', () => {
    template.hasResource('AWS::DynamoDB::Table', Match.objectLike({ DeletionPolicy: 'Retain' }));
  });

  it('grants the version worker only PutItem, never read, update, delete, query or scan', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('worker') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:PutItem']));
    expect(actions).not.toEqual(expect.arrayContaining([
      'dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:Scan',
      'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:TransactWriteItems',
    ]));
  });
});
