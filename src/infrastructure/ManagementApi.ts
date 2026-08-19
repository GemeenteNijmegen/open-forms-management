import { RemovalPolicy } from 'aws-cdk-lib';
import { AccessLogFormat } from 'aws-cdk-lib/aws-apigateway';
import { HttpApi, IHttpRouteAuthorizer, LogGroupLogDestination } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ManagementApiProps {
  /**
   * Lambda invoked for any route without a more specific integration.
   */
  defaultFunction: IFunction;
  /**
   * Authorizer applied to every route unless a route overrides it explicitly
   * (e.g. the public login/auth-callback/logout routes use `HttpNoneAuthorizer`).
   */
  defaultAuthorizer: IHttpRouteAuthorizer;
}

// Method, path, status, ip, protocol and response size only. Headers and cookies aren't fields this format
// can express, so a session cookie or Authorization header can't end up in an access log line by construction.
const ACCESS_LOG_FORMAT = AccessLogFormat.jsonWithStandardFields({
  ip: true,
  caller: false,
  user: false,
  requestTime: true,
  httpMethod: true,
  resourcePath: true,
  status: true,
  protocol: true,
  responseLength: true,
});

export class ManagementApi extends Construct {
  public readonly api: HttpApi;

  constructor(scope: Construct, id: string, props: ManagementApiProps) {
    super(scope, id);

    this.api = new HttpApi(this, 'api', {
      defaultIntegration: new HttpLambdaIntegration('default-integration', props.defaultFunction),
      defaultAuthorizer: props.defaultAuthorizer,
      // The default stage is created explicitly below instead, so access logging can be attached to it.
      createDefaultStage: false,
    });

    const accessLogGroup = new LogGroup(this, 'access-log-group', {
      retention: RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.api.addStage('default-stage', {
      autoDeploy: true,
      accessLogSettings: {
        destination: new LogGroupLogDestination(accessLogGroup),
        format: ACCESS_LOG_FORMAT,
      },
    });
  }
}
