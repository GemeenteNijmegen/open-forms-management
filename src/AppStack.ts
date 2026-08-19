import { Stack, StackProps } from 'aws-cdk-lib';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { AuthFunction } from './app/auth/auth-function';
import { HomeFunction } from './app/home/home-function';
import { LoginFunction } from './app/login/login-function';
import { Configurable } from './Configuration';
import { resolveAccountHostedZone } from './infrastructure/AccountHostedZone';
import { ManagementApi } from './infrastructure/ManagementApi';
import { ManagementDistribution } from './infrastructure/ManagementDistribution';
import { addOidcRoute } from './infrastructure/OidcRoute';
import { createSessionAuthorizer } from './infrastructure/SessionAuthorizer';
import { SessionsTable } from './infrastructure/SessionsTable';
import { resolveUsEastOutputs } from './infrastructure/UsEastOutputs';
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

  constructor(scope: Construct, id: string, private readonly props: AppStackProps) {
    super(scope, id, props);

    /**
     * Properties
     */
    const usEastOutputs = resolveUsEastOutputs(this);
    this.certificateArn = usEastOutputs.certificateArn;
    this.wafWebAclArn = usEastOutputs.wafWebAclArn;
    this.sessionsTable = new SessionsTable(this, 'sessions-table');
    const domainName = `${Statics.domainPrefix}.${Statics.hostedZoneLabel(this.props.configuration.branchName)}.csp-nijmegen.nl`;

    /**
     * Lambdas and their routes
     */
    const sessionAuthorizer = createSessionAuthorizer(this, this.sessionsTable, this.props.configuration);

    const homeFunction = new HomeFunction(this, 'home-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'home-function'),
    });
    applyLambdaLoggingDefaults(homeFunction, this.props.configuration);

    const managementApi = new ManagementApi(this, 'management-api', {
      defaultFunction: homeFunction,
      defaultAuthorizer: sessionAuthorizer,
    });

    const loginFunction = new LoginFunction(this, 'login-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'login-function'),
    });
    addOidcRoute(this, managementApi, this.sessionsTable, this.props.configuration, loginFunction, domainName, '/login');

    const authFunction = new AuthFunction(this, 'auth-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'auth-function'),
    });
    addOidcRoute(this, managementApi, this.sessionsTable, this.props.configuration, authFunction, domainName, '/auth/callback');

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
