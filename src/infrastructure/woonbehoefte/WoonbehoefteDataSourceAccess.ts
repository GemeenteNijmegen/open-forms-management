import { Function } from 'aws-cdk-lib/aws-lambda';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Statics } from '../../Statics';

/**
 * Grants read access to the same Objects/Open Zaak configuration and credentials Sport's
 * `SportDataSourceAccess` grants, kept as its own Woonbehoefte-local copy so the feature has no
 * import dependency on `src/infrastructure/sport/**`.
 */
export function applyWoonbehoefteDataSourceAccess(scope: Construct, fn: Function): void {
  fn.addEnvironment('OBJECTS_BASE_URL', StringParameter.valueForStringParameter(scope, Statics.ssmObjectsBaseUrl));
  const objectsCredentials = Secret.fromSecretNameV2(scope, `objects-credentials-for-${fn.node.id}`, Statics.secretObjectsCredentials);
  objectsCredentials.grantRead(fn);
  fn.addEnvironment('OBJECTS_CREDENTIALS_SECRET_NAME', Statics.secretObjectsCredentials);

  fn.addEnvironment('OPEN_ZAAK_DOCUMENTEN_BASE_URL', StringParameter.valueForStringParameter(scope, Statics.ssmOpenZaakDocumentenBaseUrl));
  const openZaakCredentials = Secret.fromSecretNameV2(scope, `open-zaak-credentials-for-${fn.node.id}`, Statics.secretOpenZaakCredentials);
  openZaakCredentials.grantRead(fn);
  fn.addEnvironment('OPEN_ZAAK_CREDENTIALS_SECRET_NAME', Statics.secretOpenZaakCredentials);
}
