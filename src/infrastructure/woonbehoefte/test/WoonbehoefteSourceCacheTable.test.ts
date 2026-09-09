import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Statics } from '../../../Statics';
import { WoonbehoefteSourceCacheTable } from '../WoonbehoefteSourceCacheTable';

describe('WoonbehoefteSourceCacheTable', () => {
  const stack = new Stack(new App(), 'TestStack');
  const sourceCacheTable = new WoonbehoefteSourceCacheTable(stack, 'source-cache');
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
  const reportreader = new Function(stack, 'reportreader', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
  });
  sourceCacheTable.grantWorkerAccess(worker);
  sourceCacheTable.grantFrontendAccess(frontend);
  sourceCacheTable.grantReportWorkerAccess(reportreader);
  const template = Template.fromStack(stack);

  it('creates exactly one table with pk/sk as its keys and no GSI', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      TableName: Statics.woonbehoefteSourceCacheTableName,
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: Match.absent(),
    }));
  });

  it('is destroyable on stack deletion, unlike the Cases table', () => {
    template.hasResource('AWS::DynamoDB::Table', Match.objectLike({ DeletionPolicy: 'Delete' }));
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

  it('grants the frontend only GetItem/BatchGetItem/Query/UpdateItem, never PutItem/Scan/DeleteItem', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('frontend') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:UpdateItem']));
    expect(actions).not.toEqual(expect.arrayContaining(['dynamodb:PutItem', 'dynamodb:Scan', 'dynamodb:DeleteItem']));
  });

  it('grants the Excel report worker only GetItem/BatchGetItem/Query, never a write', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('reportreader') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query']));
    expect(actions).not.toEqual(expect.arrayContaining(['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem']));
  });
});
