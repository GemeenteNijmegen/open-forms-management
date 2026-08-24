import { Duration } from 'aws-cdk-lib';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { WoonbehoefteCasesTable } from './WoonbehoefteCasesTable';
import { applyWoonbehoefteDataSourceAccess } from './WoonbehoefteDataSourceAccess';
import { WoonbehoefteSourceCacheTable } from './WoonbehoefteSourceCacheTable';
import { WoonbehoefteSyncWorkerFunction } from '../../app/woonbehoefte/source/woonbehoefteSyncWorker-function';
import { WoonbehoefteFunction } from '../../app/woonbehoefte/woonbehoefte-function';
import { Configuration } from '../../Configuration';
import { applyLambdaLoggingDefaults, createLambdaLogGroup } from '../../observability/LambdaLogging';
import { AuditTrailTable } from '../AuditTrailTable';
import { ManagementApi } from '../ManagementApi';
import { applyPageLambdaDefaults } from '../PageLambda';
import { PermissionsTable } from '../PermissionsTable';
import { SessionsTable } from '../SessionsTable';

export interface WoonbehoefteFeatureProps {
  managementApi: ManagementApi;
  permissionsTable: PermissionsTable;
  auditTrailTable: AuditTrailTable;
  sessionsTable: SessionsTable;
  configuration: Configuration;
}

/**
 * Composition root for the temporary Woonbehoefte feature: its own tables, page Lambda, sync worker
 * Lambda, IAM grants and routes. `AppStack` only imports this and passes in the shared platform
 * resources (management API, permissions/audit/sessions tables, configuration), so it stays unaware of
 * Woonbehoefte's internal shape and the feature can later be removed by deleting this tree and its
 * `AppStack` invocation.
 */
export class WoonbehoefteFeature extends Construct {
  public readonly sourceCacheTable: WoonbehoefteSourceCacheTable;
  public readonly casesTable: WoonbehoefteCasesTable;

  constructor(scope: Construct, id: string, props: WoonbehoefteFeatureProps) {
    super(scope, id);

    const sourceCacheTable = new WoonbehoefteSourceCacheTable(this, 'source-cache-table');
    const casesTable = new WoonbehoefteCasesTable(this, 'cases-table');
    this.sourceCacheTable = sourceCacheTable;
    this.casesTable = casesTable;

    const syncWorkerFunction = new WoonbehoefteSyncWorkerFunction(this, 'sync-worker-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'woonbehoefte-sync-worker-function'),
      // AWS Lambda's absolute maximum timeout; the runner applies its own 13-minute application cutoff.
      timeout: Duration.minutes(14),
    });
    applyLambdaLoggingDefaults(syncWorkerFunction, props.configuration);
    applyWoonbehoefteDataSourceAccess(this, syncWorkerFunction);
    sourceCacheTable.grantWorkerAccess(syncWorkerFunction);
    casesTable.grantWorkerAccess(syncWorkerFunction);
    syncWorkerFunction.addEnvironment('WOONBEHOEFTE_SOURCE_CACHE_TABLE', sourceCacheTable.table.tableName);
    syncWorkerFunction.addEnvironment('WOONBEHOEFTE_CASES_TABLE', casesTable.table.tableName);

    const pageFunction = new WoonbehoefteFunction(this, 'page-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'woonbehoefte-page-function'),
      // Document download/detail routes call Objects/Open Zaak live; 29s (not 30s) matches HttpApi's own hard integration timeout.
      timeout: Duration.seconds(29),
    });
    applyLambdaLoggingDefaults(pageFunction, props.configuration);
    applyPageLambdaDefaults(this, pageFunction, props.permissionsTable, props.auditTrailTable, props.sessionsTable, props.configuration);
    applyWoonbehoefteDataSourceAccess(this, pageFunction);
    sourceCacheTable.grantFrontendAccess(pageFunction);
    casesTable.grantFrontendAccess(pageFunction);
    pageFunction.addEnvironment('WOONBEHOEFTE_SOURCE_CACHE_TABLE', sourceCacheTable.table.tableName);
    pageFunction.addEnvironment('WOONBEHOEFTE_CASES_TABLE', casesTable.table.tableName);
    syncWorkerFunction.grantInvoke(pageFunction);
    pageFunction.addEnvironment('WOONBEHOEFTE_SYNC_WORKER_FUNCTION_NAME', syncWorkerFunction.functionName);

    const integration = new HttpLambdaIntegration('integration-woonbehoefte-function', pageFunction);
    props.managementApi.api.addRoutes({ path: '/woonbehoefte', methods: [HttpMethod.GET], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/refresh', methods: [HttpMethod.POST], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}', methods: [HttpMethod.GET], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}/documents/{documentId}', methods: [HttpMethod.GET], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}/claim', methods: [HttpMethod.POST], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}/release', methods: [HttpMethod.POST], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}/take-over', methods: [HttpMethod.POST], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}/assessment', methods: [HttpMethod.POST], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}/status', methods: [HttpMethod.POST], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}/notes', methods: [HttpMethod.POST], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}/check/request', methods: [HttpMethod.POST], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}/check/complete', methods: [HttpMethod.POST], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/cases/{caseReference}/inadmissible/confirm', methods: [HttpMethod.POST], integration });
  }
}
