import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Statics } from '../../../Statics';
import { WoonbehoefteCasesTable } from '../WoonbehoefteCasesTable';

describe('WoonbehoefteCasesTable', () => {
  const stack = new Stack(new App(), 'TestStack');
  const casesTable = new WoonbehoefteCasesTable(stack, 'cases');
  const worker = new Function(stack, 'worker', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
  });
  const frontend = new Function(stack, 'frontend', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
  });
  casesTable.grantWorkerAccess(worker);
  casesTable.grantFrontendAccess(frontend);
  const template = Template.fromStack(stack);

  it('creates exactly one table with pk/sk as its keys, PITR enabled and no GSI', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      TableName: Statics.woonbehoefteCasesTableName,
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      GlobalSecondaryIndexes: Match.absent(),
      StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
    }));
  });

  it('retains the table on stack deletion, unlike the SourceCache table', () => {
    template.hasResource('AWS::DynamoDB::Table', Match.objectLike({ DeletionPolicy: 'Retain' }));
  });

  it('grants the sync worker only GetItem/PutItem: it may conditionally create a case and read back an existing link, never update, query or scan', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('worker') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem']));
    expect(actions).not.toEqual(expect.arrayContaining(['dynamodb:UpdateItem', 'dynamodb:Query', 'dynamodb:Scan']));
  });

  it('grants the frontend the full set of human-mutation actions plus Scan for the overview', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('frontend') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining([
      'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:TransactWriteItems',
      'dynamodb:ConditionCheckItem',
    ]));
    expect(actions).not.toEqual(expect.arrayContaining(['dynamodb:DeleteItem']));
  });
});
