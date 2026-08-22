import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Statics } from '../../../Statics';
import { SportReportsTable } from '../SportReportsTable';

describe('SportReportsTable', () => {
  const stack = new Stack(new App(), 'TestStack');
  const sportReportsTable = new SportReportsTable(stack, 'sport-reports');
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
  sportReportsTable.grantWorkerAccess(worker);
  sportReportsTable.grantFrontendAccess(frontend);
  const template = Template.fromStack(stack);

  it('creates exactly one table with reportId as its only key', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', Match.objectLike({
      TableName: Statics.sportReportsTableName,
      KeySchema: [{ AttributeName: 'reportId', KeyType: 'HASH' }],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
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

  it('grants the worker only GetItem/UpdateItem, never PutItem/Scan', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('worker') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:UpdateItem']));
    expect(actions).not.toEqual(expect.arrayContaining(['dynamodb:PutItem', 'dynamodb:Scan', 'dynamodb:DeleteItem']));
  });

  it('grants the frontend GetItem/PutItem/UpdateItem/Scan, but never a raw DeleteItem', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('frontend') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Scan']));
    expect(actions).not.toContain('dynamodb:DeleteItem');
  });
});
