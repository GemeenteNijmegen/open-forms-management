import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface ManagementApiProps {
  /**
   * Lambda invoked for any route without a more specific integration.
   * Later issues (login, callback, logout) add explicit routes next to this.
   */
  defaultFunction: IFunction;
}

export class ManagementApi extends Construct {
  public readonly api: HttpApi;

  constructor(scope: Construct, id: string, props: ManagementApiProps) {
    super(scope, id);

    this.api = new HttpApi(this, 'api', {
      defaultIntegration: new HttpLambdaIntegration('default-integration', props.defaultFunction),
    });
  }
}
