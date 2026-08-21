import { HostedZone, IHostedZone } from 'aws-cdk-lib/aws-route53';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Statics } from '../Statics';

export function resolveAccountHostedZone(scope: Construct): IHostedZone {
  const zoneId = StringParameter.valueForStringParameter(scope, Statics.accountHostedzoneId);
  const zoneName = StringParameter.valueForStringParameter(scope, Statics.accountHostedzoneName);
  return HostedZone.fromHostedZoneAttributes(scope, 'account-hostedzone', {
    hostedZoneId: zoneId,
    zoneName,
  });
}
