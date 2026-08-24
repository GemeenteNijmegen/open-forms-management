import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Function } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { Configuration } from '../../Configuration';
import { applyLambdaLoggingDefaults } from '../../observability/LambdaLogging';
import { AuditTrailTable } from '../AuditTrailTable';
import { ManagementApi } from '../ManagementApi';
import { applyPageLambdaDefaults } from '../PageLambda';
import { PermissionsTable } from '../PermissionsTable';
import { SessionsTable } from '../SessionsTable';

/**
 * Wires the standard page-lambda session/permission/audit access onto the Permissions Lambda, plus its
 * overview route and the mutation route paths. Target e-mails never go in the URL: /permissions/users/edit
 * takes its target from the POST body instead of a path segment.
 */
export function addPermissionsRoute(
  scope: Construct,
  managementApi: ManagementApi,
  fn: Function,
  permissionsTable: PermissionsTable,
  auditTrailTable: AuditTrailTable,
  sessionsTable: SessionsTable,
  configuration: Configuration,
) {
  applyLambdaLoggingDefaults(fn, configuration);
  applyPageLambdaDefaults(scope, fn, permissionsTable, auditTrailTable, sessionsTable, configuration);

  /**
   * Only what create/update/remove actually need: new items (PutItem), replacing or removing grants
   * (DeleteItem), and TransactWriteItems for replace/remove, which delete and put several grant items
   * (and sometimes the subject item) in one all-or-nothing call. No UpdateItem or BatchWriteItem: the
   * design replaces a resource's grants wholesale, delete plus put, it never patches an item in place.
   */
  permissionsTable.table.grant(fn, 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:TransactWriteItems');

  managementApi.api.addRoutes({
    path: '/permissions',
    methods: [HttpMethod.GET],
    integration: new HttpLambdaIntegration('integration-permissions-function', fn),
  });

  managementApi.api.addRoutes({
    path: '/permissions/users/new',
    methods: [HttpMethod.GET],
    integration: new HttpLambdaIntegration('integration-permissions-function-users-new', fn),
  });

  managementApi.api.addRoutes({
    path: '/permissions/users/edit',
    methods: [HttpMethod.POST],
    integration: new HttpLambdaIntegration('integration-permissions-function-users-edit', fn),
  });

  managementApi.api.addRoutes({
    path: '/permissions/users/create',
    methods: [HttpMethod.POST],
    integration: new HttpLambdaIntegration('integration-permissions-function-users-create', fn),
  });

  managementApi.api.addRoutes({
    path: '/permissions/users/update',
    methods: [HttpMethod.POST],
    integration: new HttpLambdaIntegration('integration-permissions-function-users-update', fn),
  });

  managementApi.api.addRoutes({
    path: '/permissions/users/remove',
    methods: [HttpMethod.POST],
    integration: new HttpLambdaIntegration('integration-permissions-function-users-remove', fn),
  });
}
