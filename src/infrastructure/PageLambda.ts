import { ErrorMonitoringAlarm } from '@gemeentenijmegen/aws-constructs';
import { Function } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { AuditTrailTable } from './AuditTrailTable';
import { PermissionsTable } from './PermissionsTable';
import { SessionsTable } from './SessionsTable';
import { Configuration } from '../Configuration';

export interface PageLambdaDefaultsOptions {
  /**
   * Adds an ErrorMonitoringAlarm for this Lambda.
   *
   * Most content pages don't need one, see ADR-027 (architecture/02-architectuurbeslissingen.md).
   *
   * @default false
   */
  alarm?: boolean;
}

/**
 * Wires up what every page Lambda needs: read access to the PermissionsTable, write access to the
 * AuditTrailTable, and the matching environment variables.
 *
 * Logging defaults and route registration are not included here on purpose. Call
 * `applyLambdaLoggingDefaults` and `managementApi.api.addRoutes(...)` yourself at the call site, so
 * it's obvious there which defaults a Lambda actually gets.
 */
export function applyPageLambdaDefaults(
  scope: Construct,
  fn: Function,
  permissionsTable: PermissionsTable,
  auditTrailTable: AuditTrailTable,
  sessionsTable: SessionsTable,
  configuration: Configuration,
  options: PageLambdaDefaultsOptions = {},
): void {
  permissionsTable.table.grantReadData(fn);
  fn.addEnvironment('PERMISSIONS_TABLE', permissionsTable.table.tableName);
  auditTrailTable.grantPut(fn);
  fn.addEnvironment('AUDIT_TRAIL_TABLE', auditTrailTable.table.tableName);
  sessionsTable.table.grantReadData(fn);
  fn.addEnvironment('SESSION_TABLE', sessionsTable.table.tableName);

  if (options.alarm) {
    new ErrorMonitoringAlarm(scope, `${fn.node.id}-error-alarm`, { lambda: fn, criticality: configuration.criticality });
  }
}
