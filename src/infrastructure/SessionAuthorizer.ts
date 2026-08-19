import { ErrorMonitoringAlarm } from '@gemeentenijmegen/aws-constructs';
import { Duration } from 'aws-cdk-lib';
import { IHttpRouteAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { AuthorizerFunction } from '../app/authorizer/authorizer-function';
import { Configuration } from '../Configuration';
import { AuditTrailTable } from './AuditTrailTable';
import { SessionsTable } from './SessionsTable';
import { applyLambdaLoggingDefaults, createLambdaLogGroup } from '../observability/LambdaLogging';

export function createSessionAuthorizer(
  scope: Construct,
  sessionsTable: SessionsTable,
  auditTrailTable: AuditTrailTable,
  configuration: Configuration,
): IHttpRouteAuthorizer {
  const authorizerFunction = new AuthorizerFunction(scope, 'authorizer-function', {
    tracing: Tracing.ACTIVE,
    logGroup: createLambdaLogGroup(scope, 'authorizer-function'),
  });
  applyLambdaLoggingDefaults(authorizerFunction, configuration);
  sessionsTable.table.grantReadData(authorizerFunction);
  authorizerFunction.addEnvironment('SESSION_TABLE', sessionsTable.table.tableName);
  auditTrailTable.grantPut(authorizerFunction);
  authorizerFunction.addEnvironment('AUDIT_TRAIL_TABLE', auditTrailTable.table.tableName);
  new ErrorMonitoringAlarm(scope, 'authorizer-function-error-alarm', { lambda: authorizerFunction, criticality: configuration.criticality });

  return new HttpLambdaAuthorizer('session-authorizer', authorizerFunction, {
    identitySource: ['$request.header.Cookie'],
    resultsCacheTtl: Duration.seconds(0),
    responseTypes: [HttpLambdaResponseType.SIMPLE],
  });
}
