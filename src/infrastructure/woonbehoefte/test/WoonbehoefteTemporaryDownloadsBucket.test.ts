import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { WoonbehoefteTemporaryDownloadsBucket } from '../WoonbehoefteTemporaryDownloadsBucket';

describe('WoonbehoefteTemporaryDownloadsBucket', () => {
  const stack = new Stack(new App(), 'TestStack');
  const downloadsBucket = new WoonbehoefteTemporaryDownloadsBucket(stack, 'woonbehoefte-downloads');
  const frontend = new Function(stack, 'frontend', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
  });
  downloadsBucket.grantFrontendAccess(frontend);
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

  it('expires objects after 1 day', () => {
    template.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({
      LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Status: 'Enabled', ExpirationInDays: 1 })]) },
    }));
  });

  it('grants the frontend only object-level PutObject/GetObject, never ListBucket or DeleteObject', () => {
    const policies = template.findResources('AWS::IAM::Policy', Match.objectLike({
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('frontend') })]) },
    }));
    const actions = Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement
      .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])));
    expect(actions).toEqual(expect.arrayContaining(['s3:PutObject', 's3:GetObject']));
    expect(actions).not.toContain('s3:ListBucket');
    expect(actions).not.toContain('s3:List*');
    expect(actions).not.toContain('s3:DeleteObject');
    expect(actions).not.toContain('s3:DeleteObject*');
  });
});
