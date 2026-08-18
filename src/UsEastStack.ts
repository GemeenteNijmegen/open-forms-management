import { RemoteParameters } from '@gemeentenijmegen/cross-region-parameters';
import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { Configurable } from './Configuration';
import { Statics } from './Statics';

export interface UsEastStackProps extends StackProps, Configurable { }

/**
 * CloudFront-global resources (ACM certificate, WAF WebACL) must live in
 * us-east-1. This stack only writes the resulting ARNs to SSM in us-east-1;
 * AppStack reads them cross-region.
 */
export class UsEastStack extends Stack {
  constructor(scope: Construct, id: string, private readonly props: UsEastStackProps) {
    super(scope, id, props);

    this.certificate();
    this.webAcl();
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
    const domainName = `${Statics.domainPrefix}.${zone.zoneName}`;

    const certificate = new Certificate(this, 'certificate', {
      domainName,
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
}
