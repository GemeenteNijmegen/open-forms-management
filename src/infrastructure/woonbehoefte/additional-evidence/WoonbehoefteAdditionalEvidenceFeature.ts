import { Duration } from 'aws-cdk-lib';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { AdditionalEvidenceFunction } from '../../../app/woonbehoefte/additional-evidence/additionalEvidence-function';
import { AdditionalEvidenceSyncWorkerFunction } from '../../../app/woonbehoefte/additional-evidence/source/additionalEvidenceSyncWorker-function';
import { Configuration } from '../../../Configuration';
import { applyLambdaLoggingDefaults, createLambdaLogGroup } from '../../../observability/LambdaLogging';
import { AuditTrailTable } from '../../AuditTrailTable';
import { ManagementApi } from '../../ManagementApi';
import { applyPageLambdaDefaults } from '../../PageLambda';
import { PermissionsTable } from '../../PermissionsTable';
import { SessionsTable } from '../../SessionsTable';
import { WoonbehoefteCasesTable } from '../WoonbehoefteCasesTable';
import { applyWoonbehoefteDataSourceAccess, applyWoonbehoefteOpenZaakDataSourceAccess } from '../WoonbehoefteDataSourceAccess';
import { WoonbehoefteSourceCacheTable } from '../WoonbehoefteSourceCacheTable';
import { WoonbehoefteTemporaryDownloadsBucket } from '../WoonbehoefteTemporaryDownloadsBucket';

export interface WoonbehoefteAdditionalEvidenceFeatureProps {
  managementApi: ManagementApi;
  permissionsTable: PermissionsTable;
  auditTrailTable: AuditTrailTable;
  sessionsTable: SessionsTable;
  configuration: Configuration;
  sourceCacheTable: WoonbehoefteSourceCacheTable;
  casesTable: WoonbehoefteCasesTable;
  temporaryDownloadsBucket: WoonbehoefteTemporaryDownloadsBucket;
}

/**
 * Nested subfeature under `WoonbehoefteFeature`: its own page Lambda and sync worker for the "Extra
 * bewijzen" flow, isolated from the primary sync path (own Lambdas, own IAM grants, own routes). Reuses
 * the existing source-cache table, Cases table and temporary downloads bucket the parent feature already
 * owns; this construct creates no new tables or buckets.
 */
export class WoonbehoefteAdditionalEvidenceFeature extends Construct {
  constructor(scope: Construct, id: string, props: WoonbehoefteAdditionalEvidenceFeatureProps) {
    super(scope, id);

    const syncWorkerFunction = new AdditionalEvidenceSyncWorkerFunction(this, 'sync-worker-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'woonbehoefte-additional-evidence-sync-worker-function'),
      // Same 15-minute hard ceiling and 2-minute cutoff margin as the primary sync worker, see WoonbehoefteFeature.ts.
      timeout: Duration.minutes(15),
    });
    applyLambdaLoggingDefaults(syncWorkerFunction, props.configuration);
    // The worker calls both Objects (to query submissions) and Open Zaak (to fetch CSV/PDF/attachments).
    applyWoonbehoefteDataSourceAccess(this, syncWorkerFunction);
    props.sourceCacheTable.grantWorkerAccess(syncWorkerFunction);
    props.casesTable.grantWorkerAccess(syncWorkerFunction);
    syncWorkerFunction.addEnvironment('WOONBEHOEFTE_SOURCE_CACHE_TABLE', props.sourceCacheTable.table.tableName);
    syncWorkerFunction.addEnvironment('WOONBEHOEFTE_CASES_TABLE', props.casesTable.table.tableName);

    const pageFunction = new AdditionalEvidenceFunction(this, 'page-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'woonbehoefte-additional-evidence-page-function'),
      // Same 29s/256MB reasoning as the primary Woonbehoefte page Lambda: document metadata/download calls are live.
      timeout: Duration.seconds(29),
      memorySize: 256,
    });
    applyLambdaLoggingDefaults(pageFunction, props.configuration);
    applyPageLambdaDefaults(this, pageFunction, props.permissionsTable, props.auditTrailTable, props.sessionsTable, props.configuration);
    // The page Lambda doesn't call Objects itself (only the sync worker does), so it only gets Open Zaak access.
    applyWoonbehoefteOpenZaakDataSourceAccess(this, pageFunction);
    props.sourceCacheTable.grantFrontendAccess(pageFunction);
    props.casesTable.grantFrontendAccess(pageFunction);
    pageFunction.addEnvironment('WOONBEHOEFTE_SOURCE_CACHE_TABLE', props.sourceCacheTable.table.tableName);
    pageFunction.addEnvironment('WOONBEHOEFTE_CASES_TABLE', props.casesTable.table.tableName);
    props.temporaryDownloadsBucket.grantFrontendAccess(pageFunction);
    pageFunction.addEnvironment('WOONBEHOEFTE_TEMP_DOWNLOAD_BUCKET', props.temporaryDownloadsBucket.bucket.bucketName);
    syncWorkerFunction.grantInvoke(pageFunction);
    pageFunction.addEnvironment('WOONBEHOEFTE_ADDITIONAL_EVIDENCE_SYNC_WORKER_FUNCTION_NAME', syncWorkerFunction.functionName);

    const integration = new HttpLambdaIntegration('integration-woonbehoefte-additional-evidence-function', pageFunction);
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/additional-evidence', methods: [HttpMethod.GET], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/additional-evidence/refresh', methods: [HttpMethod.POST], integration });
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/additional-evidence/{submissionId}', methods: [HttpMethod.GET], integration });
    props.managementApi.api.addRoutes({
      path: '/woonbehoefte/additional-evidence/{submissionId}/search-case', methods: [HttpMethod.POST], integration,
    });
    props.managementApi.api.addRoutes({
      path: '/woonbehoefte/additional-evidence/{submissionId}/status', methods: [HttpMethod.POST], integration,
    });
    props.managementApi.api.addRoutes({
      path: '/woonbehoefte/additional-evidence/{submissionId}/link', methods: [HttpMethod.POST], integration,
    });
    props.managementApi.api.addRoutes({
      path: '/woonbehoefte/additional-evidence/{submissionId}/documents/{documentId}', methods: [HttpMethod.GET], integration,
    });
  }
}
