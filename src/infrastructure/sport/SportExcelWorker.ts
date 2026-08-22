import { Function } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { applySportDataSourceAccess } from './SportDataSourceAccess';
import { SportReportsBucket } from './SportReportsBucket';
import { SportReportsTable } from './SportReportsTable';
import { Configuration } from '../../Configuration';
import { applyLambdaLoggingDefaults } from '../../observability/LambdaLogging';
import { AuditTrailTable } from '../AuditTrailTable';

/**
 * Wires the SportExcelWorker Lambda: read/update access to the report it's asked to build, write-only
 * access to the reports bucket, and the same Objects/Open Zaak data source access the Sport frontend uses.
 */
export function configureSportExcelWorker(
  scope: Construct,
  fn: Function,
  sportReportsTable: SportReportsTable,
  sportReportsBucket: SportReportsBucket,
  auditTrailTable: AuditTrailTable,
  configuration: Configuration,
): void {
  applyLambdaLoggingDefaults(fn, configuration);
  applySportDataSourceAccess(scope, fn);

  sportReportsTable.grantWorkerAccess(fn);
  fn.addEnvironment('SPORT_REPORTS_TABLE', sportReportsTable.table.tableName);
  sportReportsBucket.grantWorkerAccess(fn);
  fn.addEnvironment('SPORT_REPORTS_BUCKET', sportReportsBucket.bucket.bucketName);
  auditTrailTable.grantPut(fn);
  fn.addEnvironment('AUDIT_TRAIL_TABLE', auditTrailTable.table.tableName);
}
