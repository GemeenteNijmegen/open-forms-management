import { Duration } from 'aws-cdk-lib';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { WoonbehoefteReportsBucket } from './WoonbehoefteReportsBucket';
import { WoonbehoefteReportsTable } from './WoonbehoefteReportsTable';
import { WoonbehoefteExcelWorkerFunction } from '../../../app/woonbehoefte/reports/woonbehoefteExcelWorker-function';
import { WoonbehoefteReportsFunction } from '../../../app/woonbehoefte/reports/woonbehoefteReports-function';
import { Configuration } from '../../../Configuration';
import { applyLambdaLoggingDefaults, createLambdaLogGroup } from '../../../observability/LambdaLogging';
import { AuditTrailTable } from '../../AuditTrailTable';
import { ManagementApi } from '../../ManagementApi';
import { applyPageLambdaDefaults } from '../../PageLambda';
import { PermissionsTable } from '../../PermissionsTable';
import { SessionsTable } from '../../SessionsTable';
import { WoonbehoefteCasesTable } from '../WoonbehoefteCasesTable';
import { applyWoonbehoefteOpenZaakDataSourceAccess } from '../WoonbehoefteDataSourceAccess';
import { WoonbehoefteSourceCacheTable } from '../WoonbehoefteSourceCacheTable';

export interface WoonbehoefteReportsFeatureProps {
  managementApi: ManagementApi;
  permissionsTable: PermissionsTable;
  auditTrailTable: AuditTrailTable;
  sessionsTable: SessionsTable;
  configuration: Configuration;
  sourceCacheTable: WoonbehoefteSourceCacheTable;
  casesTable: WoonbehoefteCasesTable;
}

/**
 * Nested subfeature onder WoonbehoefteFeature, zelfde isolatie als additional-evidence: eigen page
 * Lambda en Excel-workerLambda, eigen reports-tabel en -bucket. Cases en source-cache zijn hier
 * read-only (grantReportWorkerAccess); de worker gebruikt alleen Open Zaak, nooit Objects.
 */
export class WoonbehoefteReportsFeature extends Construct {
  constructor(scope: Construct, id: string, props: WoonbehoefteReportsFeatureProps) {
    super(scope, id);

    const reportsTable = new WoonbehoefteReportsTable(this, 'reports-table');
    const reportsBucket = new WoonbehoefteReportsBucket(this, 'reports-bucket');

    const excelWorkerFunction = new WoonbehoefteExcelWorkerFunction(this, 'excel-worker-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'woonbehoefte-excel-worker-function'),
      // AWS Lambda's absolute maximum timeout, zelfde marge-aanpak als de primary/additional-evidence sync workers.
      timeout: Duration.minutes(15),
    });
    applyLambdaLoggingDefaults(excelWorkerFunction, props.configuration);
    // Alleen Open Zaak: de worker leest Cases/source-cache, nooit Objects.
    applyWoonbehoefteOpenZaakDataSourceAccess(this, excelWorkerFunction);
    reportsTable.grantWorkerAccess(excelWorkerFunction);
    reportsBucket.grantWorkerAccess(excelWorkerFunction);
    props.casesTable.grantReportWorkerAccess(excelWorkerFunction);
    props.sourceCacheTable.grantReportWorkerAccess(excelWorkerFunction);
    props.auditTrailTable.grantPut(excelWorkerFunction);
    excelWorkerFunction.addEnvironment('WOONBEHOEFTE_REPORTS_TABLE', reportsTable.table.tableName);
    excelWorkerFunction.addEnvironment('WOONBEHOEFTE_REPORTS_BUCKET', reportsBucket.bucket.bucketName);
    excelWorkerFunction.addEnvironment('WOONBEHOEFTE_SOURCE_CACHE_TABLE', props.sourceCacheTable.table.tableName);
    excelWorkerFunction.addEnvironment('WOONBEHOEFTE_CASES_TABLE', props.casesTable.table.tableName);
    excelWorkerFunction.addEnvironment('AUDIT_TRAIL_TABLE', props.auditTrailTable.table.tableName);

    const pageFunction = new WoonbehoefteReportsFunction(this, 'page-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'woonbehoefte-reports-page-function'),
      // Alleen DynamoDB/S3-operaties (lijst, presign, delete), geen live Open Zaak-call zoals de primary page Lambda.
      timeout: Duration.seconds(10),
    });
    applyLambdaLoggingDefaults(pageFunction, props.configuration);
    applyPageLambdaDefaults(this, pageFunction, props.permissionsTable, props.auditTrailTable, props.sessionsTable, props.configuration);
    reportsTable.grantFrontendAccess(pageFunction);
    reportsBucket.grantFrontendAccess(pageFunction);
    excelWorkerFunction.grantInvoke(pageFunction);
    pageFunction.addEnvironment('WOONBEHOEFTE_REPORTS_TABLE', reportsTable.table.tableName);
    pageFunction.addEnvironment('WOONBEHOEFTE_REPORTS_BUCKET', reportsBucket.bucket.bucketName);
    pageFunction.addEnvironment('WOONBEHOEFTE_EXCEL_WORKER_FUNCTION_NAME', excelWorkerFunction.functionName);

    const integration = new HttpLambdaIntegration('integration-woonbehoefte-reports-function', pageFunction);
    props.managementApi.api.addRoutes({ path: '/woonbehoefte/overzichten', methods: [HttpMethod.GET], integration });
  }
}
