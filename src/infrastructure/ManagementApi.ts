import { RemovalPolicy } from 'aws-cdk-lib';
import { CfnStage, HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ManagementApiProps {
  /**
   * Lambda invoked for any route without a more specific integration.
   */
  defaultFunction: IFunction;
}

// Request/response and integration fields only, so a 500 can be traced to either the Lambda integration
// or the Lambda's own response without ever logging headers, cookies or a request body.
const ACCESS_LOG_FORMAT = JSON.stringify({
  requestId: '$context.requestId',
  routeKey: '$context.routeKey',
  requestTime: '$context.requestTime',
  httpMethod: '$context.httpMethod',
  status: '$context.status',
  protocol: '$context.protocol',
  responseLength: '$context.responseLength',
  integrationStatus: '$context.integrationStatus',
  integrationBackendStatus: '$context.integration.status',
  integrationError: '$context.integrationErrorMessage',
  integrationLatency: '$context.integrationLatency',
  integrationRequestId: '$context.integration.requestId',
  gatewayError: '$context.error.message',
});

export class ManagementApi extends Construct {
  public readonly api: HttpApi;

  constructor(scope: Construct, id: string, props: ManagementApiProps) {
    super(scope, id);

    this.api = new HttpApi(this, 'api', {
      defaultIntegration: new HttpLambdaIntegration('default-integration', props.defaultFunction),
    });

    const accessLogGroup = new LogGroup(this, 'access-log-group', {
      retention: RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    /**
     * HttpApi already creates a $default stage at a fixed logical ID (createDefaultStage defaults to true).
     *
     * Turning that off and calling addStage() here instead would create a second Stage resource under a
     * different logical ID. Two stages can't both be named $default on one API, so CloudFormation can't
     * create the "new" one while the original still exists.
     *
     * Attach access logging to the stage HttpApi already made instead, via the L1 escape hatch.
     */
    const defaultStage = this.api.defaultStage!.node.defaultChild as CfnStage;
    defaultStage.accessLogSettings = {
      destinationArn: accessLogGroup.logGroupArn,
      format: ACCESS_LOG_FORMAT,
    };
  }
}
