import { Function } from 'aws-cdk-lib/aws-lambda';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Statics } from '../../Statics';

// Alleen het ESF-token, nooit Statics.secretObjectsCredentials of Open Zaak.
export function applyEsfDataSourceAccess(scope: Construct, fn: Function): void {
  fn.addEnvironment('OBJECTS_BASE_URL', StringParameter.valueForStringParameter(scope, Statics.ssmObjectsBaseUrl));
  fn.addEnvironment('ESF_OBJECTTYPE_URL', StringParameter.valueForStringParameter(scope, Statics.ssmEsfObjectTypeUrl));
  const credentials = Secret.fromSecretNameV2(scope, `esf-objects-credentials-for-${fn.node.id}`, Statics.secretEsfObjectsCredentials);
  credentials.grantRead(fn);
  fn.addEnvironment('ESF_OBJECTS_CREDENTIALS_SECRET_NAME', Statics.secretEsfObjectsCredentials);
}
