import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Statics } from '../../../Statics';
import { SportCacheTable } from '../SportCacheTable';

describe('SportCacheTable', () => {
  const stack = new Stack(new App(), 'TestStack');
  const sportCacheTable = new SportCacheTable(stack, 'sport-cache');
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
  sportCacheTable.grantWorkerAccess(worker);
  sportCacheTable.grantFrontendAccess(frontend);
  const template = Template.fromStack(stack);

  it('creates exactly one table with pk/sk as its keys and no GSI', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      TableName: Statics.sportCacheTableName,
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    }));
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      GlobalSecondaryIndexes: Match.absent(),
    }));
  });

  it('has TTL enabled on the expiresAt attribute', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    }));
  });

  it('retains the table on stack deletion', () => {
    template.hasResource('AWS::DynamoDB::Table', Match.objectLike({ DeletionPolicy: 'Retain' }));
  });

  it('grants the worker only GetItem/BatchGetItem/PutItem/UpdateItem, never Query/Scan/DeleteItem', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('worker') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem']));
    expect(actions).not.toEqual(expect.arrayContaining(['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:DeleteItem']));
  });

  it('grants the frontend only GetItem/Query/UpdateItem, never PutItem/Scan/DeleteItem', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('frontend') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem']));
    expect(actions).not.toEqual(expect.arrayContaining(['dynamodb:PutItem', 'dynamodb:Scan', 'dynamodb:DeleteItem']));
  });
});
