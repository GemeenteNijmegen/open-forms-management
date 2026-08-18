import { RemoteParameters } from '@gemeentenijmegen/cross-region-parameters';
import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Function } from 'aws-cdk-lib/aws-lambda';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { AuthFunction } from './app/auth/auth-function';
import { HomeFunction } from './app/home/home-function';
import { LoginFunction } from './app/login/login-function';
import { Configurable } from './Configuration';
import { ManagementApi } from './ManagementApi';
import { ManagementDistribution } from './ManagementDistribution';
import { applyLambdaLoggingDefaults } from './observability/LambdaLogging';
import { SessionsTable } from './SessionsTable';
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

    const usEastOutputs = new RemoteParameters(this, 'us-east-1-outputs', {
      path: `${Statics.ssmUsEastOutputsPath}/`,
      region: 'us-east-1',
      timeout: Duration.seconds(10),
    });
    this.certificateArn = usEastOutputs.get(Statics.ssmManagementCertificateArn);
    this.wafWebAclArn = usEastOutputs.get(Statics.ssmManagementWafWebAclArn);

    this.sessionsTable = new SessionsTable(this, 'sessions-table');

    const domainName = `${Statics.domainPrefix}.${Statics.hostedZoneLabel(this.props.configuration.branchName)}.csp-nijmegen.nl`;

    const homeFunction = new HomeFunction(this, 'home-function');
    applyLambdaLoggingDefaults(homeFunction, this.props.configuration);

    const managementApi = new ManagementApi(this, 'management-api', {
      defaultFunction: homeFunction,
    });

    const loginFunction = new LoginFunction(this, 'login-function');
    this.addOidcRoute(managementApi, loginFunction, domainName, '/login');

    const authFunction = new AuthFunction(this, 'auth-function');
    this.addOidcRoute(managementApi, authFunction, domainName, '/auth/callback');

    new ManagementDistribution(this, 'management-distribution', {
      api: managementApi.api,
      certificateArn: this.certificateArn,
      wafWebAclArn: this.wafWebAclArn,
      domainName,
      hostedZone: this.hostedZone(),
    });
  }

  /**
   * Wires the standard logging/session/OIDC environment and permissions
   * onto an OIDC-flow Lambda (login, auth callback) and adds its route.
   */
  private addOidcRoute(managementApi: ManagementApi, fn: Function, domainName: string, path: string) {
    applyLambdaLoggingDefaults(fn, this.props.configuration);

    this.sessionsTable.table.grantReadWriteData(fn);
    fn.addEnvironment('SESSION_TABLE', this.sessionsTable.table.tableName);
    fn.addEnvironment('MANAGEMENT_DOMAIN', domainName);
    fn.addEnvironment('OIDC_ISSUER', StringParameter.valueForStringParameter(this, Statics.ssmOidcIssuer));
    fn.addEnvironment('OIDC_CLIENT_ID', StringParameter.valueForStringParameter(this, Statics.ssmOidcClientId));

    const oidcClientSecret = Secret.fromSecretNameV2(this, `oidc-client-secret-for-${fn.node.id}`, Statics.secretOidcClientSecret);
    oidcClientSecret.grantRead(fn);
    fn.addEnvironment('OIDC_CLIENT_SECRET_ARN', oidcClientSecret.secretArn);

    managementApi.api.addRoutes({
      path,
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(`integration-${fn.node.id}`, fn),
    });
  }

  private hostedZone() {
    const zoneId = StringParameter.valueForStringParameter(this, Statics.accountHostedzoneId);
    const zoneName = StringParameter.valueForStringParameter(this, Statics.accountHostedzoneName);
    return HostedZone.fromHostedZoneAttributes(this, 'account-hostedzone', {
      hostedZoneId: zoneId,
      zoneName,
    });
  }
}
