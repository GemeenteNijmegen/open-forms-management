import { HttpMethod, HttpNoneAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { LogoutFunction } from '../app/logout/logout-function';
import { Configuration } from '../Configuration';
import { ManagementApi } from './ManagementApi';
import { SessionsTable } from './SessionsTable';
import { applyLambdaLoggingDefaults, createLambdaLogGroup } from '../observability/LambdaLogging';

/**
 * Wires the logout Lambda and adds its public route. Unlike login/auth
 * callback it never talks to the OIDC provider, so it only needs session
 * table access.
 */
export function addLogoutRoute(scope: Construct, managementApi: ManagementApi, sessionsTable: SessionsTable, configuration: Configuration) {
  const logoutFunction = new LogoutFunction(scope, 'logout-function', {
    tracing: Tracing.ACTIVE,
    logGroup: createLambdaLogGroup(scope, 'logout-function'),
  });
  applyLambdaLoggingDefaults(logoutFunction, configuration);
  sessionsTable.table.grantReadWriteData(logoutFunction);
  logoutFunction.addEnvironment('SESSION_TABLE', sessionsTable.table.tableName);

  managementApi.api.addRoutes({
    path: '/logout',
    methods: [HttpMethod.GET],
    integration: new HttpLambdaIntegration('integration-logout-function', logoutFunction),
    authorizer: new HttpNoneAuthorizer(),
  });
}
