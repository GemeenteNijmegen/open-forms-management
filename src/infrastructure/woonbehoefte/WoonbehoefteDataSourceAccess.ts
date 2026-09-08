import { Function } from 'aws-cdk-lib/aws-lambda';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Statics } from '../../Statics';

/*
 * Opgesplitst zodat de Additional Evidence page Lambda alleen Open Zaak-toegang kan krijgen, zonder
 * Objects (alleen de sync worker praat met Objects). `applyWoonbehoefteDataSourceAccess` roept hieronder
 * gewoon beide na elkaar aan, dus voor de bestaande primary Lambda's verandert er niets.
 */

/** Grants read access to Objects config/credentials, zelfde patroon als Sport's `SportDataSourceAccess`. */
export function applyWoonbehoefteObjectsDataSourceAccess(scope: Construct, fn: Function): void {
  fn.addEnvironment('OBJECTS_BASE_URL', StringParameter.valueForStringParameter(scope, Statics.ssmObjectsBaseUrl));
  const objectsCredentials = Secret.fromSecretNameV2(scope, `objects-credentials-for-${fn.node.id}`, Statics.secretObjectsCredentials);
  objectsCredentials.grantRead(fn);
  fn.addEnvironment('OBJECTS_CREDENTIALS_SECRET_NAME', Statics.secretObjectsCredentials);
}

/** Grants read access to Open Zaak config/credentials, zelfde patroon als Sport's `SportDataSourceAccess`. */
export function applyWoonbehoefteOpenZaakDataSourceAccess(scope: Construct, fn: Function): void {
  fn.addEnvironment('OPEN_ZAAK_DOCUMENTEN_BASE_URL', StringParameter.valueForStringParameter(scope, Statics.ssmOpenZaakDocumentenBaseUrl));
  const openZaakCredentials = Secret.fromSecretNameV2(scope, `open-zaak-credentials-for-${fn.node.id}`, Statics.secretOpenZaakCredentials);
  openZaakCredentials.grantRead(fn);
  fn.addEnvironment('OPEN_ZAAK_CREDENTIALS_SECRET_NAME', Statics.secretOpenZaakCredentials);
}

/**
 * Grants read access to zowel Objects als Open Zaak, kept as its own Woonbehoefte-local copy so the
 * feature has no import dependency on `src/infrastructure/sport/**`. Voor Lambda's die (zoals de
 * primary en Additional Evidence sync workers) daadwerkelijk beide bronnen nodig hebben.
 */
export function applyWoonbehoefteDataSourceAccess(scope: Construct, fn: Function): void {
  applyWoonbehoefteObjectsDataSourceAccess(scope, fn);
  applyWoonbehoefteOpenZaakDataSourceAccess(scope, fn);
}
