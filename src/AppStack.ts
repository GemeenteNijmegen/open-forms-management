import { ErrorMonitoringAlarm } from '@gemeentenijmegen/aws-constructs';
import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { AuthFunction } from './app/auth/auth-function';
import { HomeFunction } from './app/home/home-function';
import { LoginFunction } from './app/login/login-function';
import { PermissionsFunction } from './app/permissions/permissions-function';
import { SportCacheWorkerFunction } from './app/sport/cache/sportCacheWorker-function';
import { SportExcelWorkerFunction } from './app/sport/reporter/sportExcelWorker-function';
import { SportFunction } from './app/sport/sport-function';
import { Configurable } from './Configuration';
import { resolveAccountHostedZone } from './infrastructure/AccountHostedZone';
import { addApplicationAlarms } from './infrastructure/ApplicationAlarms';
import { AuditTrailTable } from './infrastructure/AuditTrailTable';
import { addLogoutRoute } from './infrastructure/LogoutRoute';
import { ManagementApi } from './infrastructure/ManagementApi';
import { ManagementDistribution } from './infrastructure/ManagementDistribution';
import { addOidcRoute } from './infrastructure/OidcRoute';
import { applyPageLambdaDefaults } from './infrastructure/PageLambda';
import { addPermissionsRoute } from './infrastructure/permissions/PermissionsRoute';
import { PermissionsTable } from './infrastructure/PermissionsTable';
import { SessionsTable } from './infrastructure/SessionsTable';
import { SportCacheTable } from './infrastructure/sport/SportCacheTable';
import { configureSportCacheWorker } from './infrastructure/sport/SportCacheWorker';
import { configureSportExcelWorker } from './infrastructure/sport/SportExcelWorker';
import { SportReportsBucket } from './infrastructure/sport/SportReportsBucket';
import { SportReportsTable } from './infrastructure/sport/SportReportsTable';
import { addSportRoute } from './infrastructure/sport/SportRoute';
import { resolveUsEastOutputs } from './infrastructure/UsEastOutputs';
import { WoonbehoefteFeature } from './infrastructure/woonbehoefte/WoonbehoefteFeature';
import { applyLambdaLoggingDefaults, createLambdaLogGroup } from './observability/LambdaLogging';
import { Statics } from './Statics';

interface AppStackProps extends StackProps, Configurable { }

export class AppStack extends Stack {
  /**
   * Certificate ARN and WAF WebACL ARN, produced by UsEastStack in
   * us-east-1 and read here cross-region via SSM (no CDK object sharing
   * or CloudFormation cross-region export/import between the stacks).
   */
  public readonly certificateArn: string;
  public readonly wafWebAclArn: string;
  public readonly sessionsTable: SessionsTable;
  public readonly auditTrailTable: AuditTrailTable;
  public readonly permissionsTable: PermissionsTable;

  constructor(scope: Construct, id: string, private readonly props: AppStackProps) {
    super(scope, id, props);

    /**
     * Properties
     */
    const usEastOutputs = resolveUsEastOutputs(this);
    this.certificateArn = usEastOutputs.certificateArn;
    this.wafWebAclArn = usEastOutputs.wafWebAclArn;
    this.sessionsTable = new SessionsTable(this, 'sessions-table');
    this.auditTrailTable = new AuditTrailTable(this, 'audit-trail-table');
    this.permissionsTable = new PermissionsTable(this, 'permissions-table');
    const domainName = `${Statics.domainPrefix}.${Statics.hostedZoneLabel(this.props.configuration.branchName)}.csp-nijmegen.nl`;

    /**
     * Lambdas and their routes
     */
    const homeFunction = new HomeFunction(this, 'home-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'home-function'),
    });
    applyLambdaLoggingDefaults(homeFunction, this.props.configuration);
    applyPageLambdaDefaults(this, homeFunction, this.permissionsTable, this.auditTrailTable, this.sessionsTable, this.props.configuration);

    const managementApi = new ManagementApi(this, 'management-api', {
      defaultFunction: homeFunction,
    });

    const loginFunction = new LoginFunction(this, 'login-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'login-function'),
      // Calls out to the OIDC provider's discovery endpoint; the default 3s timeout is too tight for that.
      timeout: Duration.seconds(30),
    });
    addOidcRoute(
      this, managementApi, this.sessionsTable, this.auditTrailTable, this.props.configuration, loginFunction, domainName, ['/login', '/login/start'],
    );
    new ErrorMonitoringAlarm(this, 'login-function-error-alarm', { lambda: loginFunction, criticality: this.props.configuration.criticality });

    const authFunction = new AuthFunction(this, 'auth-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'auth-function'),
      // Calls out to the OIDC provider for discovery and token exchange; the default 3s timeout is too tight for that.
      timeout: Duration.seconds(30),
    });
    addOidcRoute(this, managementApi, this.sessionsTable, this.auditTrailTable, this.props.configuration, authFunction, domainName, '/auth/callback');
    new ErrorMonitoringAlarm(this, 'auth-function-error-alarm', { lambda: authFunction, criticality: this.props.configuration.criticality });

    addLogoutRoute(this, managementApi, this.sessionsTable, this.auditTrailTable, this.props.configuration);

    const sportReportsTable = new SportReportsTable(this, 'sport-reports-table');
    const sportReportsBucket = new SportReportsBucket(this, 'sport-reports-bucket');

    const sportExcelWorkerFunction = new SportExcelWorkerFunction(this, 'sport-excel-worker-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'sport-excel-worker-function'),
      // AWS Lambda's absolute maximum timeout.
      timeout: Duration.minutes(15),
    });
    configureSportExcelWorker(this, sportExcelWorkerFunction, sportReportsTable, sportReportsBucket, this.auditTrailTable, this.props.configuration);

    const sportCacheTable = new SportCacheTable(this, 'sport-cache-table');
    const sportCacheWorkerFunction = new SportCacheWorkerFunction(this, 'sport-cache-worker-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'sport-cache-worker-function'),
      // AWS Lambda's absolute maximum timeout; the runner applies its own ~13-minute application cutoff.
      timeout: Duration.minutes(15),
    });
    configureSportCacheWorker(this, sportCacheWorkerFunction, sportCacheTable, this.props.configuration);

    const sportFunction = new SportFunction(this, 'sport-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'sport-function'),
      // PDF download and report routes on this Lambda still call Objects/Open Zaak live. 29s, not 30s: HttpApi's
      // own integration timeout is a hard 29s, so a 30th second here would never be reached.
      timeout: Duration.seconds(29),
    });
    addSportRoute(
      this, managementApi, sportFunction, this.permissionsTable, this.auditTrailTable, this.sessionsTable,
      this.props.configuration, sportReportsTable, sportReportsBucket, sportExcelWorkerFunction,
      sportCacheTable, sportCacheWorkerFunction,
    );

    const permissionsFunction = new PermissionsFunction(this, 'permissions-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'permissions-function'),
    });
    addPermissionsRoute(
      this, managementApi, permissionsFunction, this.permissionsTable, this.auditTrailTable, this.sessionsTable, this.props.configuration,
    );

    new WoonbehoefteFeature(this, 'woonbehoefte', {
      managementApi,
      permissionsTable: this.permissionsTable,
      auditTrailTable: this.auditTrailTable,
      sessionsTable: this.sessionsTable,
      configuration: this.props.configuration,
    });

    addApplicationAlarms(this, managementApi.api, this.props.configuration);

    /**
     * CloudFront in front of the HTTP API and static assets, the public web entrance.
     */
    new ManagementDistribution(this, 'management-distribution', {
      api: managementApi.api,
      certificateArn: this.certificateArn,
      wafWebAclArn: this.wafWebAclArn,
      domainName,
      hostedZone: resolveAccountHostedZone(this),
    });
  }
}
