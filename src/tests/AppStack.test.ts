import { Criticality } from '@gemeentenijmegen/aws-constructs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AppStack } from '../AppStack';
import { AppStage } from '../AppStage';

describe('AppStack authentication and routing wiring', () => {
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

  it('creates no HTTP API authorizer - each page lambda validates its own session', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 0);
  });

  it.each([
    '$default',
    'GET /login',
    'GET /auth/callback',
    'GET /logout',
  ])('leaves %s public at the API - authentication happens inside the lambda', (routeKey) => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', Match.objectLike({
      RouteKey: routeKey,
      AuthorizationType: 'NONE',
    }));
  });

  it.each([
    'src/app/home/home.lambda.ts',
    'src/app/login/login.lambda.ts',
    'src/app/auth/auth.lambda.ts',
    'src/app/logout/logout.lambda.ts',
    'src/app/sport/sport.lambda.ts',
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

  it('creates exactly 6 alarms: 3 per-Lambda error rates plus audit-write-failure, login-failure-rate and API 5xx', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 6);
  });

  it.each([
    'login-function-error-alarm',
    'auth-function-error-alarm',
    'logout-function-error-alarm',
  ])('creates an error-rate alarm for %s with the branch criticality suffix', (alarmId) => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: `increased-error-rate-${alarmId}-low-lvl`,
    }));
  });

  // Home is a content page, not an auth-critical Lambda: no dedicated alarm by default, see ADR-027.
  // The API-wide 5xx alarm in ApplicationAlarms.ts still covers it.
  it('does not create a dedicated error-rate alarm for home-function', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm', Match.objectLike({
      Properties: { AlarmName: 'increased-error-rate-home-function-error-alarm-low-lvl' },
    }));
    expect(Object.keys(alarms)).toHaveLength(0);
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

  it('gives home-function read access to the PermissionsTable and the PERMISSIONS_TABLE env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/home/home.lambda.ts',
      Environment: Match.objectLike({ Variables: Match.objectLike({ PERMISSIONS_TABLE: Match.anyValue() }) }),
    }));
    template.hasResourceProperties('AWS::IAM::Policy', Match.objectLike({
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Allow', Action: Match.arrayWith(['dynamodb:Query']) }),
        ]),
      }),
    }));
  });

  it('gives home-function write access to the AuditTrailTable and the AUDIT_TRAIL_TABLE env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/home/home.lambda.ts',
      Environment: Match.objectLike({ Variables: Match.objectLike({ AUDIT_TRAIL_TABLE: Match.anyValue() }) }),
    }));
  });

  it('gives home-function read access to the SessionsTable and the SESSION_TABLE env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/home/home.lambda.ts',
      Environment: Match.objectLike({ Variables: Match.objectLike({ SESSION_TABLE: Match.anyValue() }) }),
    }));
  });

  it('serves a static fallback page for 500 responses, since a Lambda crash never reaches a handler that renders one', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', Match.objectLike({
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 500, ResponseCode: 500, ResponsePagePath: '/static/http-errors/500.html' }),
        ]),
      }),
    }));
  });

  // 401/403 no longer come from an authorizer at all (ADR-031); this only guards AuthorizationService's own
  // 403 "Geen toegang" page against being swallowed by a CustomErrorResponse.
  it('does not configure a custom error response for 401 or 403', () => {
    const distributions = template.findResources('AWS::CloudFront::Distribution');
    const [distribution]: any[] = Object.values(distributions);
    const errorCodes = distribution.Properties.DistributionConfig.CustomErrorResponses.map((response: any) => response.ErrorCode);
    expect(errorCodes).not.toContain(401);
    expect(errorCodes).not.toContain(403);
  });

  it('applies the same security headers policy to the dynamic and static behaviors', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', Match.objectLike({
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ResponseHeadersPolicyId: Match.anyValue() }),
        CacheBehaviors: Match.arrayWith([Match.objectLike({ ResponseHeadersPolicyId: Match.anyValue() })]),
      }),
    }));
  });

  it('sets a CSP without unsafe-inline or wildcard origins, plus the other standard security headers', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', Match.objectLike({
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: Match.objectLike({
            ContentSecurityPolicy: Match.stringLikeRegexp("default-src 'none'"),
            Override: true,
          }),
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000, Override: true }),
        }),
      }),
    }));

    const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
    const [policy]: any[] = Object.values(policies);
    const csp = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
    expect(csp).not.toMatch(/unsafe-inline/);
    expect(csp).not.toContain('*');
  });
});
