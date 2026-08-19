import { HttpMethod, HttpNoneAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Function } from 'aws-cdk-lib/aws-lambda';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { AuditTrailTable } from './AuditTrailTable';
import { Configuration } from '../Configuration';
import { applyLambdaLoggingDefaults } from '../observability/LambdaLogging';
import { Statics } from '../Statics';
import { ManagementApi } from './ManagementApi';
import { SessionsTable } from './SessionsTable';

/**
 * Wires the standard logging/session/OIDC environment and permissions onto
 * an OIDC-flow Lambda (login, auth callback) and adds its public route.
 */
export function addOidcRoute(
  scope: Construct,
  managementApi: ManagementApi,
  sessionsTable: SessionsTable,
  auditTrailTable: AuditTrailTable,
  configuration: Configuration,
  fn: Function,
  domainName: string,
  path: string,
) {
  applyLambdaLoggingDefaults(fn, configuration);

  sessionsTable.table.grantReadWriteData(fn);
  fn.addEnvironment('SESSION_TABLE', sessionsTable.table.tableName);
  auditTrailTable.grantPut(fn);
  fn.addEnvironment('AUDIT_TRAIL_TABLE', auditTrailTable.table.tableName);
  fn.addEnvironment('MANAGEMENT_DOMAIN', domainName);
  fn.addEnvironment('OIDC_ISSUER', StringParameter.valueForStringParameter(scope, Statics.ssmOidcIssuer));
  fn.addEnvironment('OIDC_CLIENT_ID', StringParameter.valueForStringParameter(scope, Statics.ssmOidcClientId));

  const oidcClientSecret = Secret.fromSecretNameV2(scope, `oidc-client-secret-for-${fn.node.id}`, Statics.secretOidcClientSecret);
  oidcClientSecret.grantRead(fn);
  fn.addEnvironment('OIDC_CLIENT_SECRET_ARN', oidcClientSecret.secretArn);

  managementApi.api.addRoutes({
    path,
    methods: [HttpMethod.GET],
    integration: new HttpLambdaIntegration(`integration-${fn.node.id}`, fn),
    authorizer: new HttpNoneAuthorizer(),
  });
}
