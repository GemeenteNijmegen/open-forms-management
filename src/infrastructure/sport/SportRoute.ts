import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Function } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { AuditTrailTable } from '../AuditTrailTable';
import { ManagementApi } from '../ManagementApi';
import { applyPageLambdaDefaults } from '../PageLambda';
import { PermissionsTable } from '../PermissionsTable';
import { SessionsTable } from '../SessionsTable';
import { SportCacheTable } from './SportCacheTable';
import { applySportDataSourceAccess } from './SportDataSourceAccess';
import { SportReportsBucket } from './SportReportsBucket';
import { SportReportsTable } from './SportReportsTable';
import { Configuration } from '../../Configuration';
import { applyLambdaLoggingDefaults } from '../../observability/LambdaLogging';

/**
 * Wires the standard page-lambda session/permission/audit access onto the Sport Lambda, its Objects/Open
 * Zaak data source access, and its routes: the overview, PDF download, cache refresh/read and reporter
 * routes, all handled by the same Lambda. Also wires the reporter's and the cache's table/bucket/worker access.
 */
export function addSportRoute(
  scope: Construct,
  managementApi: ManagementApi,
  fn: Function,
  permissionsTable: PermissionsTable,
  auditTrailTable: AuditTrailTable,
  sessionsTable: SessionsTable,
  configuration: Configuration,
  sportReportsTable: SportReportsTable,
  sportReportsBucket: SportReportsBucket,
  sportExcelWorker: Function,
  sportCacheTable: SportCacheTable,
  sportCacheWorker: Function,
) {
  applyLambdaLoggingDefaults(fn, configuration);
  applyPageLambdaDefaults(scope, fn, permissionsTable, auditTrailTable, sessionsTable, configuration);
  applySportDataSourceAccess(scope, fn);

  sportReportsTable.grantFrontendAccess(fn);
  fn.addEnvironment('SPORT_REPORTS_TABLE', sportReportsTable.table.tableName);
  sportReportsBucket.grantFrontendAccess(fn);
  fn.addEnvironment('SPORT_REPORTS_BUCKET', sportReportsBucket.bucket.bucketName);
  sportExcelWorker.grantInvoke(fn);
  fn.addEnvironment('SPORT_EXCEL_WORKER_FUNCTION_NAME', sportExcelWorker.functionName);

  sportCacheTable.grantFrontendAccess(fn);
  fn.addEnvironment('SPORT_CACHE_TABLE', sportCacheTable.table.tableName);
  sportCacheWorker.grantInvoke(fn);
  fn.addEnvironment('SPORT_CACHE_WORKER_FUNCTION_NAME', sportCacheWorker.functionName);

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

  managementApi.api.addRoutes({
    path: '/sport/submissions/refresh',
    methods: [HttpMethod.POST],
    integration: new HttpLambdaIntegration('integration-sport-function-refresh', fn),
  });

  managementApi.api.addRoutes({
    path: '/sport/submissions',
    methods: [HttpMethod.GET],
    integration: new HttpLambdaIntegration('integration-sport-function-submissions', fn),
  });

  managementApi.api.addRoutes({
    path: '/sport/client-errors',
    methods: [HttpMethod.POST],
    integration: new HttpLambdaIntegration('integration-sport-function-client-errors', fn),
  });

  managementApi.api.addRoutes({
    path: '/sport/overzichten',
    methods: [HttpMethod.GET, HttpMethod.POST],
    integration: new HttpLambdaIntegration('integration-sport-function-reports', fn),
  });

  managementApi.api.addRoutes({
    path: '/sport/overzichten/{reportId}/download',
    methods: [HttpMethod.GET],
    integration: new HttpLambdaIntegration('integration-sport-function-reports-download', fn),
  });

  managementApi.api.addRoutes({
    path: '/sport/overzichten/{reportId}/delete',
    methods: [HttpMethod.POST],
    integration: new HttpLambdaIntegration('integration-sport-function-reports-delete', fn),
  });
}
