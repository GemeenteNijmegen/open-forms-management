import { Duration } from 'aws-cdk-lib';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { StartingPosition, Tracing } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { WoonbehoefteCasesTable } from './WoonbehoefteCasesTable';
import { WoonbehoefteCaseVersionsTable } from './WoonbehoefteCaseVersionsTable';
import { applyWoonbehoefteDataSourceAccess } from './WoonbehoefteDataSourceAccess';
import { WoonbehoefteSourceCacheTable } from './WoonbehoefteSourceCacheTable';
import { WoonbehoefteTemporaryDownloadsBucket } from './WoonbehoefteTemporaryDownloadsBucket';
import { WoonbehoefteSyncWorkerFunction } from '../../app/woonbehoefte/source/woonbehoefteSyncWorker-function';
import { WoonbehoefteCaseVersionWorkerFunction } from '../../app/woonbehoefte/versions/woonbehoefteCaseVersionWorker-function';
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
  public readonly caseVersionsTable: WoonbehoefteCaseVersionsTable;

  constructor(scope: Construct, id: string, props: WoonbehoefteFeatureProps) {
    super(scope, id);

    const sourceCacheTable = new WoonbehoefteSourceCacheTable(this, 'source-cache-table');
    const casesTable = new WoonbehoefteCasesTable(this, 'cases-table');
    const caseVersionsTable = new WoonbehoefteCaseVersionsTable(this, 'case-versions-table');
    this.sourceCacheTable = sourceCacheTable;
    this.casesTable = casesTable;
    this.caseVersionsTable = caseVersionsTable;

    const syncWorkerFunction = new WoonbehoefteSyncWorkerFunction(this, 'sync-worker-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'woonbehoefte-sync-worker-function'),
      // AWS Lambda's absolute maximum timeout; the runner applies its own 13-minute application cutoff, a 2-minute margin.
      timeout: Duration.minutes(15),
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
      // A ~15MB document download is read into memory in full before it's staged in S3; the 128MB default runs out of headroom.
      memorySize: 256,
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

    const temporaryDownloadsBucket = new WoonbehoefteTemporaryDownloadsBucket(this, 'temporary-downloads-bucket');
    temporaryDownloadsBucket.grantFrontendAccess(pageFunction);
    pageFunction.addEnvironment('WOONBEHOEFTE_TEMP_DOWNLOAD_BUCKET', temporaryDownloadsBucket.bucket.bucketName);

    const caseVersionWorkerFunction = new WoonbehoefteCaseVersionWorkerFunction(this, 'case-version-worker-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'woonbehoefte-case-version-worker-function'),
      // Ample for a batch of 10 small PutItems; not the page's HTTP-facing timeout or the sync worker's 15 minutes.
      timeout: Duration.seconds(30),
    });
    applyLambdaLoggingDefaults(caseVersionWorkerFunction, props.configuration);
    caseVersionWorkerFunction.addEnvironment('WOONBEHOEFTE_CASE_VERSIONS_TABLE', caseVersionsTable.table.tableName);
    caseVersionsTable.grantWriterAccess(caseVersionWorkerFunction);
    // Polls cases table. No extra cost, only invocations are billed.
    caseVersionWorkerFunction.addEventSource(new DynamoEventSource(casesTable.table, {
      // The stream is only enabled from this deploy onward; TRIM_HORIZON picks up the oldest records still
      // available so nothing written between enabling the stream and this mapping going live is missed.
      startingPosition: StartingPosition.TRIM_HORIZON,
      batchSize: 10,
      bisectBatchOnError: true,
      // Keep retrying until the stream record itself expires; there is no DLQ for this worker.
      // Max 24 hour retry and time between retries grows exponentially.
      // Free tier or worst case 2 cents for everything if it retries everything
      retryAttempts: -1,
    }));

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
