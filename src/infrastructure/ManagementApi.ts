import { RemovalPolicy } from 'aws-cdk-lib';
import { AccessLogFormat } from 'aws-cdk-lib/aws-apigateway';
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
      format: ACCESS_LOG_FORMAT.toString(),
    };
  }
}
