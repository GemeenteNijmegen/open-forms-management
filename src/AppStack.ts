import { RemoteParameters } from '@gemeentenijmegen/cross-region-parameters';
import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { HomeFunction } from './app/home/home-function';
import { Configurable } from './Configuration';
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

    new HomeFunction(this, 'home-function');
  }
}
