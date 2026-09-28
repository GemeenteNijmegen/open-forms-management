import { Duration } from 'aws-cdk-lib';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { ProjectDetailsTable } from './ProjectDetailsTable';
import { ProjectDetailsWorkerFunction } from '../../../app/woonbehoefte/project-details/initialization/projectDetailsWorker-function';
import { Configuration } from '../../../Configuration';
import { applyLambdaLoggingDefaults, createLambdaLogGroup } from '../../../observability/LambdaLogging';
import { WoonbehoefteCasesTable } from '../WoonbehoefteCasesTable';
import { applyWoonbehoefteOpenZaakDataSourceAccess } from '../WoonbehoefteDataSourceAccess';
import { WoonbehoefteSourceCacheTable } from '../WoonbehoefteSourceCacheTable';

export interface ProjectDetailsFeatureProps {
  configuration: Configuration;
  sourceCacheTable: WoonbehoefteSourceCacheTable;
  casesTable: WoonbehoefteCasesTable;
}

/**
 * Nested subfeature onder `WoonbehoefteFeature` voor Projectdetails voor Mijn Aansluiting: eigen
 * werkversietabel en een eigen initializer-Lambda die zowel de batch (werkvoorraad) als één dossier
 * (detailknop) voorinvult. Cases en source-cache zijn hier read-only, zelfde grant als de Excel-worker:
 * deze subfeature creëert of muteert nooit een bestaand CASE-item. De routes en de trigger op de
 * overzicht-/detailpagina's staan in `WoonbehoefteFeature`/`woonbehoefte.lambda.ts` (PD-04), niet hier.
 */
export class ProjectDetailsFeature extends Construct {
  public readonly table: ProjectDetailsTable;
  public readonly workerFunction: ProjectDetailsWorkerFunction;

  constructor(scope: Construct, id: string, props: ProjectDetailsFeatureProps) {
    super(scope, id);
    this.table = new ProjectDetailsTable(this, 'table');

    this.workerFunction = new ProjectDetailsWorkerFunction(this, 'worker-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'woonbehoefte-project-details-worker-function'),
      // Zelfde 15 minuten hard-timeout/2-minuten marge als de andere Woonbehoefte-workers, zie ProjectDetailsWorkerRunner.
      timeout: Duration.minutes(15),
    });
    applyLambdaLoggingDefaults(this.workerFunction, props.configuration);
    // Alleen Open Zaak: de worker leest Cases/source-cache, roept nooit Objects aan.
    applyWoonbehoefteOpenZaakDataSourceAccess(this, this.workerFunction);
    props.casesTable.grantReportWorkerAccess(this.workerFunction);
    props.sourceCacheTable.grantReportWorkerAccess(this.workerFunction);
    this.table.grantWorkerAccess(this.workerFunction);
    this.workerFunction.addEnvironment('WOONBEHOEFTE_CASES_TABLE', props.casesTable.table.tableName);
    this.workerFunction.addEnvironment('WOONBEHOEFTE_SOURCE_CACHE_TABLE', props.sourceCacheTable.table.tableName);
    this.workerFunction.addEnvironment('WOONBEHOEFTE_PROJECT_DETAILS_TABLE', this.table.table.tableName);
  }
}
