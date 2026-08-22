import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SportReportsBucket } from '../SportReportsBucket';

describe('SportReportsBucket', () => {
  const stack = new Stack(new App(), 'TestStack');
  const sportReportsBucket = new SportReportsBucket(stack, 'sport-reports');
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
  sportReportsBucket.grantWorkerAccess(worker);
  sportReportsBucket.grantFrontendAccess(frontend);
  const template = Template.fromStack(stack);

  it('blocks all public access, encrypts at rest and enforces SSL', () => {
    template.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }),
        ]),
      }),
    }));
    template.hasResourceProperties('AWS::S3::BucketPolicy', Match.objectLike({
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      }),
    }));
  });

  it('expires objects after 30 days', () => {
    template.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({
      LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Status: 'Enabled', ExpirationInDays: 30 })]) },
    }));
  });

  it('grants the worker only PutObject, never GetObject/DeleteObject', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('worker') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toContain('s3:PutObject');
    expect(actions).not.toContain('s3:GetObject');
    expect(actions).not.toContain('s3:DeleteObject*');
  });

  it('grants the frontend GetObject/DeleteObject but never PutObject or ListBucket', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('frontend') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining(['s3:GetObject', 's3:DeleteObject*']));
    expect(actions).not.toContain('s3:PutObject');
    expect(actions).not.toContain('s3:List*');
    expect(actions).not.toContain('s3:ListBucket');
  });
});
