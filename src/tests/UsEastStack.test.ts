import { Criticality } from '@gemeentenijmegen/aws-constructs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Statics } from '../Statics';
import { UsEastStack } from '../UsEastStack';

function configurationWithHealthCheck(loginHealthCheckEnabled: boolean) {
  return {
    branchName: 'test',
    buildEnvironment: { account: '123456789012', region: 'eu-central-1' },
    deploymentEnvironment: { account: '123456789012', region: 'eu-central-1' },
    criticality: new Criticality('low'),
    logLevel: 'DEBUG' as const,
    loginHealthCheckEnabled,
  };
}

describe('UsEastStack', () => {
  const stack = new UsEastStack(new App(), 'TestUsEastStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    configuration: configurationWithHealthCheck(true),
  });
  const template = Template.fromStack(stack);

  it('deploys in us-east-1', () => {
    expect(stack.region).toBe('us-east-1');
  });

  it('creates exactly one DNS-validated certificate', () => {
    template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      ValidationMethod: 'DNS',
    });
  });

  it('writes the certificate arn to the Statics-defined parameter name', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: Statics.ssmManagementCertificateArn,
    });
  });

  it('creates exactly one CloudFront-scoped web acl with the agreed rules', () => {
    template.resourceCountIs('AWS::WAFv2::WebACL', 1);
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'CLOUDFRONT',
      DefaultAction: { Allow: {} },
      Rules: Match.arrayWith([
        Match.objectLike({ Name: 'AWS-CommonRuleSet' }),
        Match.objectLike({ Name: 'AWS-KnownBadInputsRuleSet' }),
        Match.objectLike({ Name: 'RateLimit' }),
      ]),
    });
  });

  it('writes the waf web acl arn to the Statics-defined parameter name', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: Statics.ssmManagementWafWebAclArn,
    });
  });
});

describe('UsEastStack login healthcheck', () => {
  it('creates the healthcheck and alarm when enabled', () => {
    const template = Template.fromStack(new UsEastStack(new App(), 'TestUsEastStackEnabled', {
      env: { account: '123456789012', region: 'us-east-1' },
      configuration: configurationWithHealthCheck(true),
    }));

    template.resourceCountIs('AWS::Route53::HealthCheck', 1);
    template.hasResourceProperties('AWS::Route53::HealthCheck', {
      HealthCheckConfig: Match.objectLike({
        Type: 'HTTPS',
        ResourcePath: '/login',
        Port: 443,
        EnableSNI: true,
      }),
    });

    template.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: 'login-healthcheck-failed-low-lvl',
      Namespace: 'AWS/Route53',
      MetricName: 'HealthCheckStatus',
      ComparisonOperator: 'LessThanThreshold',
      Threshold: 1,
    }));
  });

  it('creates neither the healthcheck nor the alarm when disabled', () => {
    const template = Template.fromStack(new UsEastStack(new App(), 'TestUsEastStackDisabled', {
      env: { account: '123456789012', region: 'us-east-1' },
      configuration: configurationWithHealthCheck(false),
    }));

    template.resourceCountIs('AWS::Route53::HealthCheck', 0);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
  });
});
