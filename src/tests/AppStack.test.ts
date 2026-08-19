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
});
