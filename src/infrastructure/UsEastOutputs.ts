import { RemoteParameters } from '@gemeentenijmegen/cross-region-parameters';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Statics } from '../Statics';

export interface UsEastOutputs {
  certificateArn: string;
  wafWebAclArn: string;
}

/**
 * Reads the certificate and WAF WebACL ARN produced by UsEastStack in
 * us-east-1, via SSM (no CDK object sharing or CloudFormation cross-region
 * export/import between the stacks).
 */
export function resolveUsEastOutputs(scope: Construct): UsEastOutputs {
  const parameters = new RemoteParameters(scope, 'us-east-1-outputs', {
    path: `${Statics.ssmUsEastOutputsPath}/`,
    region: 'us-east-1',
    timeout: Duration.seconds(10),
  });
  return {
    certificateArn: parameters.get(Statics.ssmManagementCertificateArn),
    wafWebAclArn: parameters.get(Statics.ssmManagementWafWebAclArn),
  };
}
