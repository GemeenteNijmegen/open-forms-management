import { RemoteParameters } from '@gemeentenijmegen/cross-region-parameters';
import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { HomeFunction } from './app/home/home-function';
import { Configurable } from './Configuration';
import { ManagementApi } from './ManagementApi';
import { ManagementDistribution } from './ManagementDistribution';
import { Statics } from './Statics';

interface AppStackProps extends StackProps, Configurable { }

export class AppStack extends Stack {
  /**
   * Certificate ARN and WAF WebACL ARN, produced by UsEastStack in
   * us-east-1 and read here cross-region via SSM (no CDK object sharing
   * or CloudFormation cross-region export/import between the stacks).
   */
  public readonly certificateArn: string;
  public readonly wafWebAclArn: string;

  constructor(scope: Construct, id: string, private readonly props: AppStackProps) {
    super(scope, id, props);

    const usEastOutputs = new RemoteParameters(this, 'us-east-1-outputs', {
      path: `${Statics.ssmUsEastOutputsPath}/`,
      region: 'us-east-1',
      timeout: Duration.seconds(10),
    });
    this.certificateArn = usEastOutputs.get(Statics.ssmManagementCertificateArn);
    this.wafWebAclArn = usEastOutputs.get(Statics.ssmManagementWafWebAclArn);

    const homeFunction = new HomeFunction(this, 'home-function');

    const managementApi = new ManagementApi(this, 'management-api', {
      defaultFunction: homeFunction,
    });

    new ManagementDistribution(this, 'management-distribution', {
      api: managementApi.api,
      certificateArn: this.certificateArn,
      wafWebAclArn: this.wafWebAclArn,
      domainName: `${Statics.domainPrefix}.${Statics.hostedZoneLabel(this.props.configuration.branchName)}.csp-nijmegen.nl`,
      hostedZone: this.hostedZone(),
    });
  }

  private hostedZone() {
    const zoneId = StringParameter.valueForStringParameter(this, Statics.accountHostedzoneId);
    const zoneName = StringParameter.valueForStringParameter(this, Statics.accountHostedzoneName);
    return HostedZone.fromHostedZoneAttributes(this, 'account-hostedzone', {
      hostedZoneId: zoneId,
      zoneName,
    });
  }
}
