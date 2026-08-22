import { RemoteParameters } from '@gemeentenijmegen/cross-region-parameters';
import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { CfnHealthCheck, HostedZone } from 'aws-cdk-lib/aws-route53';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { Configurable } from './Configuration';
import { Statics } from './Statics';

export interface UsEastStackProps extends StackProps, Configurable { }

/**
 * CloudFront-global resources (ACM certificate, WAF WebACL) must live in
 * us-east-1. This stack only writes the resulting ARNs to SSM in us-east-1;
 * AppStack reads them cross-region. Route53 health checks also always
 * report their CloudWatch metric to us-east-1, so the login healthcheck
 * alarm lives here too rather than needing a cross-region metric read.
 */
export class UsEastStack extends Stack {
  constructor(scope: Construct, id: string, private readonly props: UsEastStackProps) {
    super(scope, id, props);

    this.certificate();
    this.webAcl();
    if (this.props.configuration.loginHealthCheckEnabled) {
      this.loginHealthCheck();
    }
  }

  /**
   * The account hosted zone id/name are published in the account's home
   * region (eu-central-1), not in us-east-1, so they need a cross-region read.
   */
  private hostedZone() {
    const parameters = new RemoteParameters(this, 'account-hostedzone-params', {
      path: `${Statics.accountHostedzonePath}/`,
      region: this.props.configuration.deploymentEnvironment.region,
      timeout: Duration.seconds(10),
    });
    return HostedZone.fromHostedZoneAttributes(this, 'account-hostedzone', {
      hostedZoneId: parameters.get(Statics.accountHostedzoneId),
      zoneName: parameters.get(Statics.accountHostedzoneName),
    });
  }

  private certificate() {
    const zone = this.hostedZone();

    const certificate = new Certificate(this, 'certificate', {
      domainName: `${Statics.domainPrefix}.${Statics.hostedZoneLabel(this.props.configuration.branchName)}.csp-nijmegen.nl`,
      validation: CertificateValidation.fromDns(zone),
    });

    new StringParameter(this, 'certificate-arn', {
      parameterName: Statics.ssmManagementCertificateArn,
      stringValue: certificate.certificateArn,
    });
  }

  /**
   * Managed rules and the rate-based rule start in Count mode: there is no
   * production traffic yet to base a Block threshold on.
   */
  private webAcl() {
    const webAcl = new CfnWebACL(this, 'web-acl', {
      name: `${Statics.projectName}-${this.props.configuration.branchName}`,
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${Statics.projectName}-webacl`,
      },
      rules: [
        {
          name: 'AWS-CommonRuleSet',
          priority: 0,
          overrideAction: { count: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-CommonRuleSet',
          },
        },
        {
          name: 'AWS-KnownBadInputsRuleSet',
          priority: 1,
          overrideAction: { count: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-KnownBadInputsRuleSet',
          },
        },
        {
          name: 'RateLimit',
          priority: 2,
          action: { count: {} },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              evaluationWindowSec: 300,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimit',
          },
        },
      ],
    });

    new StringParameter(this, 'waf-web-acl-arn', {
      parameterName: Statics.ssmManagementWafWebAclArn,
      stringValue: webAcl.attrArn,
    });
  }

  // /login is a side-effect-free page render (no OIDC involved), so a plain status-code healthcheck on it
  // is enough: it proves Route53 -> CloudFront -> API Gateway -> login Lambda, not Microsoft Entra/OIDC.
  private loginHealthCheck() {
    const domainName = `${Statics.domainPrefix}.${Statics.hostedZoneLabel(this.props.configuration.branchName)}.csp-nijmegen.nl`;

    const healthCheck = new CfnHealthCheck(this, 'login-healthcheck', {
      healthCheckConfig: {
        type: 'HTTPS',
        fullyQualifiedDomainName: domainName,
        resourcePath: '/login',
        port: 443,
        requestInterval: 30,
        failureThreshold: 3,
        // CloudFront is SNI-based virtual hosting: without this the handshake fails before /login is ever requested.
        enableSni: true,
      },
    });

    new Alarm(this, 'login-healthcheck-alarm', {
      metric: new Metric({
        namespace: 'AWS/Route53',
        metricName: 'HealthCheckStatus',
        dimensionsMap: { HealthCheckId: healthCheck.attrHealthCheckId },
        statistic: 'Minimum',
        period: Duration.minutes(1),
      }),
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      threshold: 1,
      evaluationPeriods: 3,
      alarmName: `login-healthcheck-failed${this.props.configuration.criticality.alarmSuffix()}`,
      alarmDescription: 'The public /login route is not returning a healthy response.',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
  }
}
