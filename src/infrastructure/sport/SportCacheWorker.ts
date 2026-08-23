import { Function } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { SportCacheTable } from './SportCacheTable';
import { applySportDataSourceAccess } from './SportDataSourceAccess';
import { Configuration } from '../../Configuration';
import { applyLambdaLoggingDefaults } from '../../observability/LambdaLogging';

/**
 * Wires the SportCacheWorker Lambda: read/write access to the cache table it refreshes and the same
 * Objects/Open Zaak data source access the Sport frontend uses. No HTTP route: only the Sport frontend
 * Lambda is allowed to invoke it (granted where that route is added).
 */
export function configureSportCacheWorker(
  scope: Construct,
  fn: Function,
  sportCacheTable: SportCacheTable,
  configuration: Configuration,
): void {
  applyLambdaLoggingDefaults(fn, configuration);
  applySportDataSourceAccess(scope, fn);

  sportCacheTable.grantWorkerAccess(fn);
  fn.addEnvironment('SPORT_CACHE_TABLE', sportCacheTable.table.tableName);
}
