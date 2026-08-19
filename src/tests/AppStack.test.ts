import { Criticality } from '@gemeentenijmegen/aws-constructs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AppStack } from '../AppStack';
import { AppStage } from '../AppStage';

describe('AppStack authorizer wiring', () => {
  const configuration = {
    branchName: 'test',
    buildEnvironment: { account: '123456789012', region: 'eu-central-1' },
    deploymentEnvironment: { account: '123456789012', region: 'eu-central-1' },
    criticality: new Criticality('low'),
    logLevel: 'DEBUG' as const,
  };

  const stage = new AppStage(new App(), 'TestAppStage', { configuration });
  const appStack = stage.node.findChild('app-stack') as AppStack;
  const template = Template.fromStack(appStack);

  it('creates exactly one Lambda authorizer for the session cookie', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', Match.objectLike({
      AuthorizerType: 'REQUEST',
      AuthorizerPayloadFormatVersion: '2.0',
      EnableSimpleResponses: true,
      IdentitySource: ['$request.header.Cookie'],
      AuthorizerResultTtlInSeconds: 0,
    }));
  });

  it('protects the default (home) route with the session authorizer', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', Match.objectLike({
      RouteKey: '$default',
      AuthorizationType: 'CUSTOM',
      AuthorizerId: Match.anyValue(),
    }));
  });

  it.each([
    'GET /login',
    'GET /auth/callback',
    'GET /logout',
  ])('leaves %s public', (routeKey) => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', Match.objectLike({
      RouteKey: routeKey,
      AuthorizationType: 'NONE',
    }));
  });

  it.each([
    'src/app/home/home.lambda.ts',
    'src/app/login/login.lambda.ts',
    'src/app/auth/auth.lambda.ts',
    'src/app/authorizer/authorizer.lambda.ts',
    'src/app/logout/logout.lambda.ts',
  ])('enables X-Ray active tracing on %s', (description) => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: description,
      TracingConfig: { Mode: 'Active' },
    }));
  });

  it('creates an explicit LogGroup with a fixed retention for every route Lambda', () => {
    const logGroups = template.findResources('AWS::Logs::LogGroup', Match.objectLike({
      Properties: { RetentionInDays: 30 },
    }));
    expect(Object.keys(logGroups)).toHaveLength(5);
  });

  it('creates exactly 8 alarms: 5 per-Lambda error rates plus audit-write-failure, login-failure-rate and API 5xx', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 8);
  });

  it.each([
    'home-function-error-alarm',
    'login-function-error-alarm',
    'auth-function-error-alarm',
    'logout-function-error-alarm',
    'authorizer-function-error-alarm',
  ])('creates an error-rate alarm for %s with the branch criticality suffix', (alarmId) => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: `increased-error-rate-${alarmId}-low-lvl`,
    }));
  });

  it('creates an AuditWriteFailure alarm that triggers on any failure', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: 'audit-write-failure-low-lvl',
      Namespace: 'open-forms-management',
      MetricName: 'AuditWriteFailure',
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 0,
    }));
  });

  it('creates a LoginFailure rate alarm', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: 'login-failure-rate-low-lvl',
      Namespace: 'open-forms-management',
      MetricName: 'LoginFailure',
    }));
  });

  it('creates an API 5xx alarm on the management HTTP API', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: 'management-api-5xx-low-lvl',
      Namespace: 'AWS/ApiGateway',
      MetricName: '5xx',
    }));
  });

  it('logs CloudFront access to a private bucket without cookies, with a 90-day expiration', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', Match.objectLike({
      DistributionConfig: Match.objectLike({
        Logging: Match.objectLike({ IncludeCookies: false, Bucket: Match.anyValue() }),
      }),
    }));
    template.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({
      OwnershipControls: { Rules: [{ ObjectOwnership: 'ObjectWriter' }] },
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true }),
      LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Status: 'Enabled', ExpirationInDays: 90 })]) },
    }));
  });

  it('logs API access to a LogGroup with a safe format and no headers/cookies', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', Match.objectLike({ RetentionInDays: 90 }));
    const stages = template.findResources('AWS::ApiGatewayV2::Stage');
    const [apiStage]: any[] = Object.values(stages);
    expect(apiStage.Properties.StageName).toBe('$default');
    expect(apiStage.Properties.AccessLogSettings.DestinationArn).toBeDefined();
    const format = JSON.stringify(apiStage.Properties.AccessLogSettings.Format);
    expect(format.toLowerCase()).not.toMatch(/cookie|authorization/);
  });

  it('deploys the static assets to the static-resources bucket under a static/ prefix, invalidating /static/* on deploy', () => {
    template.hasResourceProperties('Custom::CDKBucketDeployment', Match.objectLike({
      DestinationBucketKeyPrefix: 'static',
      DistributionPaths: ['/static/*'],
    }));
  });
});
