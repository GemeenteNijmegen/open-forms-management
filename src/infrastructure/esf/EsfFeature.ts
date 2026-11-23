import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { EsfFunction } from '../../app/esf/esf-function';
import { Configuration } from '../../Configuration';
import { applyLambdaLoggingDefaults, createLambdaLogGroup } from '../../observability/LambdaLogging';
import { AuditTrailTable } from '../AuditTrailTable';
import { ManagementApi } from '../ManagementApi';
import { applyPageLambdaDefaults } from '../PageLambda';
import { PermissionsTable } from '../PermissionsTable';
import { SessionsTable } from '../SessionsTable';

export interface EsfFeatureProps {
  managementApi: ManagementApi;
  permissionsTable: PermissionsTable;
  auditTrailTable: AuditTrailTable;
  sessionsTable: SessionsTable;
  configuration: Configuration;
}

export class EsfFeature extends Construct {
  constructor(scope: Construct, id: string, props: EsfFeatureProps) {
    super(scope, id);

    const pageFunction = new EsfFunction(this, 'page-function', {
      tracing: Tracing.ACTIVE,
      logGroup: createLambdaLogGroup(this, 'esf-page-function'),
    });
    applyLambdaLoggingDefaults(pageFunction, props.configuration);
    applyPageLambdaDefaults(this, pageFunction, props.permissionsTable, props.auditTrailTable, props.sessionsTable, props.configuration);

    const integration = new HttpLambdaIntegration('integration-esf-function', pageFunction);
    props.managementApi.api.addRoutes({ path: '/esf', methods: [HttpMethod.GET], integration });
  }
}
