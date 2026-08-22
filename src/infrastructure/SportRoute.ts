import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Function } from 'aws-cdk-lib/aws-lambda';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { AuditTrailTable } from './AuditTrailTable';
import { ManagementApi } from './ManagementApi';
import { applyPageLambdaDefaults } from './PageLambda';
import { PermissionsTable } from './PermissionsTable';
import { SessionsTable } from './SessionsTable';
import { Configuration } from '../Configuration';
import { applyLambdaLoggingDefaults } from '../observability/LambdaLogging';
import { Statics } from '../Statics';

/**
 * Wires the standard page-lambda session/permission/audit access onto the Sport Lambda, plus read
 * access to the Objects and Open Zaak credentials it needs to fetch Sportinzendingen, and adds its
 * routes: the overview and the PDF download, both handled by the same Lambda.
 */
export function addSportRoute(
  scope: Construct,
  managementApi: ManagementApi,
  fn: Function,
  permissionsTable: PermissionsTable,
  auditTrailTable: AuditTrailTable,
  sessionsTable: SessionsTable,
  configuration: Configuration,
) {
  applyLambdaLoggingDefaults(fn, configuration);
  applyPageLambdaDefaults(scope, fn, permissionsTable, auditTrailTable, sessionsTable, configuration);

  fn.addEnvironment('OBJECTS_BASE_URL', StringParameter.valueForStringParameter(scope, Statics.ssmObjectsBaseUrl));
  const objectsCredentials = Secret.fromSecretNameV2(scope, `objects-credentials-for-${fn.node.id}`, Statics.secretObjectsCredentials);
  objectsCredentials.grantRead(fn);
  fn.addEnvironment('OBJECTS_CREDENTIALS_SECRET_NAME', Statics.secretObjectsCredentials);

  fn.addEnvironment('OPEN_ZAAK_DOCUMENTEN_BASE_URL', StringParameter.valueForStringParameter(scope, Statics.ssmOpenZaakDocumentenBaseUrl));
  const openZaakCredentials = Secret.fromSecretNameV2(scope, `open-zaak-credentials-for-${fn.node.id}`, Statics.secretOpenZaakCredentials);
  openZaakCredentials.grantRead(fn);
  fn.addEnvironment('OPEN_ZAAK_CREDENTIALS_SECRET_NAME', Statics.secretOpenZaakCredentials);

  managementApi.api.addRoutes({
    path: '/sport',
    methods: [HttpMethod.GET],
    integration: new HttpLambdaIntegration('integration-sport-function', fn),
  });

  managementApi.api.addRoutes({
    path: '/sport/submissions/{objectUuid}/pdf',
    methods: [HttpMethod.GET],
    integration: new HttpLambdaIntegration('integration-sport-function-pdf', fn),
  });
}
