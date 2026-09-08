import { Criticality } from '@gemeentenijmegen/aws-constructs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AppStack } from '../AppStack';
import { AppStage } from '../AppStage';

function roleLogicalIdFor(template: Template, description: string): string {
  const functions = template.findResources('AWS::Lambda::Function', Match.objectLike({ Properties: { Description: description } }));
  const [fn]: any[] = Object.values(functions);
  return fn.Properties.Role['Fn::GetAtt'][0];
}

function actionsGrantedToRole(template: Template, roleLogicalId: string): string[] {
  const policies = Object.values(template.findResources('AWS::IAM::Policy')) as any[];
  return policies
    .filter((policy) => (policy.Properties.Roles ?? []).some((role: any) => role.Ref === roleLogicalId))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement)
    .flatMap((statement: any) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));
}

describe('AppStack authentication and routing wiring', () => {
  const configuration = {
    branchName: 'test',
    buildEnvironment: { account: '123456789012', region: 'eu-central-1' },
    deploymentEnvironment: { account: '123456789012', region: 'eu-central-1' },
    criticality: new Criticality('low'),
    logLevel: 'DEBUG' as const,
    loginHealthCheckEnabled: true,
  };

  const stage = new AppStage(new App(), 'TestAppStage', { configuration });
  const appStack = stage.node.findChild('app-stack') as AppStack;
  const template = Template.fromStack(appStack);

  it('creates no HTTP API authorizer - each page lambda validates its own session', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 0);
  });

  it.each([
    '$default',
    'GET /login',
    'GET /login/start',
    'GET /auth/callback',
    'GET /logout',
  ])('leaves %s public at the API - authentication happens inside the lambda', (routeKey) => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', Match.objectLike({
      RouteKey: routeKey,
      AuthorizationType: 'NONE',
    }));
  });

  it.each([
    'src/app/home/home.lambda.ts',
    'src/app/login/login.lambda.ts',
    'src/app/auth/auth.lambda.ts',
    'src/app/logout/logout.lambda.ts',
    'src/app/sport/sport.lambda.ts',
    'src/app/sport/reporter/sportExcelWorker.lambda.ts',
    'src/app/sport/cache/sportCacheWorker.lambda.ts',
    'src/app/permissions/permissions.lambda.ts',
    'src/app/woonbehoefte/additional-evidence/additionalEvidence.lambda.ts',
    'src/app/woonbehoefte/additional-evidence/source/additionalEvidenceSyncWorker.lambda.ts',
    'src/app/woonbehoefte/reports/woonbehoefteReports.lambda.ts',
    'src/app/woonbehoefte/reports/woonbehoefteExcelWorker.lambda.ts',
  ])('enables X-Ray active tracing on %s', (description) => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: description,
      TracingConfig: { Mode: 'Active' },
    }));
  });

  it('creates an explicit LogGroup with a fixed retention for every route Lambda plus the SportExcelWorker, SportCacheWorker and the Woonbehoefte Lambdas', () => {
    const logGroups = template.findResources('AWS::Logs::LogGroup', Match.objectLike({
      Properties: { RetentionInDays: 30 },
    }));
    expect(Object.keys(logGroups)).toHaveLength(15);
  });

  it('creates exactly 6 alarms: 3 per-Lambda error rates plus audit-write-failure, login-failure-rate and API 5xx', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 6);
  });

  it.each([
    'login-function-error-alarm',
    'auth-function-error-alarm',
    'logout-function-error-alarm',
  ])('creates an error-rate alarm for %s with the branch criticality suffix', (alarmId) => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: `increased-error-rate-${alarmId}-low-lvl`,
    }));
  });

  // Home is a content page, not an auth-critical Lambda: no dedicated alarm by default, see ADR-027.
  // The API-wide 5xx alarm in ApplicationAlarms.ts still covers it.
  it('does not create a dedicated error-rate alarm for home-function', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm', Match.objectLike({
      Properties: { AlarmName: 'increased-error-rate-home-function-error-alarm-low-lvl' },
    }));
    expect(Object.keys(alarms)).toHaveLength(0);
  });

  it('configures the case-version worker with active tracing, a 30s timeout and its table env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/woonbehoefte/versions/woonbehoefteCaseVersionWorker.lambda.ts',
      TracingConfig: { Mode: 'Active' },
      Timeout: 30,
      Environment: Match.objectLike({ Variables: Match.objectLike({ WOONBEHOEFTE_CASE_VERSIONS_TABLE: Match.anyValue() }) }),
    }));
  });

  it('maps the Cases stream to the case-version worker with TRIM_HORIZON, batch 10, bisect and unlimited retries', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', Match.objectLike({
      StartingPosition: 'TRIM_HORIZON',
      BatchSize: 10,
      BisectBatchOnFunctionError: true,
      MaximumRetryAttempts: -1,
    }));
  });

  it('does not add a dedicated error-rate alarm for the case-version worker', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm', Match.objectLike({
      Properties: { AlarmName: Match.stringLikeRegexp('case-version-worker') },
    }));
    expect(Object.keys(alarms)).toHaveLength(0);
  });

  // The table's own PutItem-only grant is covered by WoonbehoefteCaseVersionsTable.test.ts; this only
  // guards that page/sync worker never end up with a CaseVersions grant through the shared feature wiring.
  it('gives the case-version worker only PutItem on CaseVersions, and gives that grant to no other role', () => {
    const workerActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/woonbehoefte/versions/woonbehoefteCaseVersionWorker.lambda.ts'));
    expect(workerActions).toContain('dynamodb:PutItem');
    expect(workerActions).not.toEqual(expect.arrayContaining([
      'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:TransactWriteItems', 'dynamodb:Scan', 'dynamodb:Query',
    ]));

    const [versionsTableLogicalId] = Object.keys(template.findResources('AWS::DynamoDB::Table', Match.objectLike({
      Properties: { TableName: Match.stringLikeRegexp('woonbehoefte-case-versions') },
    })));
    const otherRoles = [
      'src/app/woonbehoefte/woonbehoefte.lambda.ts',
      'src/app/woonbehoefte/source/woonbehoefteSyncWorker.lambda.ts',
      'src/app/woonbehoefte/additional-evidence/additionalEvidence.lambda.ts',
      'src/app/woonbehoefte/additional-evidence/source/additionalEvidenceSyncWorker.lambda.ts',
    ].map((description) => roleLogicalIdFor(template, description));
    const policies = Object.values(template.findResources('AWS::IAM::Policy')) as any[];
    const referencesVersionsTable = policies
      .filter((policy) => (policy.Properties.Roles ?? []).some((role: any) => otherRoles.includes(role.Ref)))
      .some((policy) => JSON.stringify(policy.Properties.PolicyDocument.Statement).includes(versionsTableLogicalId));
    expect(referencesVersionsTable).toBe(false);
  });

  it('gives the Additional Evidence sync worker a 900s timeout, separate from the 29s HTTP-facing page function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/woonbehoefte/additional-evidence/source/additionalEvidenceSyncWorker.lambda.ts',
      Timeout: 900,
    }));
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/woonbehoefte/additional-evidence/additionalEvidence.lambda.ts',
      Timeout: 29,
      MemorySize: 256,
    }));
  });

  // The IAM split in WoonbehoefteDataSourceAccess.ts must leave the Additional Evidence sync worker exactly
  // like the primary sync worker (both Objects and Open Zaak), while the Additional Evidence page function
  // only gets Open Zaak, never Objects.
  it('gives the Additional Evidence sync worker both Objects and Open Zaak access, and the page function only Open Zaak', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/woonbehoefte/additional-evidence/source/additionalEvidenceSyncWorker.lambda.ts',
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          OBJECTS_BASE_URL: Match.anyValue(),
          OBJECTS_CREDENTIALS_SECRET_NAME: Match.anyValue(),
          OPEN_ZAAK_DOCUMENTEN_BASE_URL: Match.anyValue(),
          OPEN_ZAAK_CREDENTIALS_SECRET_NAME: Match.anyValue(),
        }),
      }),
    }));
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/woonbehoefte/additional-evidence/additionalEvidence.lambda.ts',
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          OPEN_ZAAK_DOCUMENTEN_BASE_URL: Match.anyValue(),
          OPEN_ZAAK_CREDENTIALS_SECRET_NAME: Match.anyValue(),
        }),
      }),
    }));
    const pageFunctions = template.findResources('AWS::Lambda::Function', Match.objectLike({
      Properties: { Description: 'src/app/woonbehoefte/additional-evidence/additionalEvidence.lambda.ts' },
    }));
    const [pageFunction]: any[] = Object.values(pageFunctions);
    const pageEnvironmentKeys = Object.keys(pageFunction.Properties.Environment.Variables);
    expect(pageEnvironmentKeys).not.toContain('OBJECTS_BASE_URL');
    expect(pageEnvironmentKeys).not.toContain('OBJECTS_CREDENTIALS_SECRET_NAME');
  });

  it('only lets the Additional Evidence page function invoke the Additional Evidence sync worker', () => {
    const pageActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/woonbehoefte/additional-evidence/additionalEvidence.lambda.ts'));
    expect(pageActions).toContain('lambda:InvokeFunction');

    const workerActions = actionsGrantedToRole(
      template, roleLogicalIdFor(template, 'src/app/woonbehoefte/additional-evidence/source/additionalEvidenceSyncWorker.lambda.ts'),
    );
    expect(workerActions).not.toContain('lambda:InvokeFunction');
  });

  it('registers every Additional Evidence route', () => {
    const routeKeys = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map((route: any) => route.Properties.RouteKey);
    expect(routeKeys).toEqual(expect.arrayContaining([
      'GET /woonbehoefte/additional-evidence',
      'POST /woonbehoefte/additional-evidence/refresh',
      'GET /woonbehoefte/additional-evidence/{submissionId}',
      'POST /woonbehoefte/additional-evidence/{submissionId}/search-case',
      'POST /woonbehoefte/additional-evidence/{submissionId}/status',
      'POST /woonbehoefte/additional-evidence/{submissionId}/link',
      'GET /woonbehoefte/additional-evidence/{submissionId}/documents/{documentId}',
    ]));
  });

  it('gives the Excel report worker a 900s timeout, separate from the 10s HTTP-facing reports page function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/woonbehoefte/reports/woonbehoefteExcelWorker.lambda.ts',
      Timeout: 900,
    }));
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/woonbehoefte/reports/woonbehoefteReports.lambda.ts',
      Timeout: 10,
    }));
  });

  // The worker never gets Objects credentials: it reads Cases/source-cache, not Objects. The page function
  // needs neither - it only reads/writes the reports table and bucket, and invokes the worker.
  it('gives the Excel report worker only Open Zaak access, never Objects, and the page function neither', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/woonbehoefte/reports/woonbehoefteExcelWorker.lambda.ts',
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          OPEN_ZAAK_DOCUMENTEN_BASE_URL: Match.anyValue(),
          OPEN_ZAAK_CREDENTIALS_SECRET_NAME: Match.anyValue(),
        }),
      }),
    }));
    const workerFunctions = template.findResources('AWS::Lambda::Function', Match.objectLike({
      Properties: { Description: 'src/app/woonbehoefte/reports/woonbehoefteExcelWorker.lambda.ts' },
    }));
    const [workerFunction]: any[] = Object.values(workerFunctions);
    const workerEnvironmentKeys = Object.keys(workerFunction.Properties.Environment.Variables);
    expect(workerEnvironmentKeys).not.toContain('OBJECTS_BASE_URL');
    expect(workerEnvironmentKeys).not.toContain('OBJECTS_CREDENTIALS_SECRET_NAME');

    const pageFunctions = template.findResources('AWS::Lambda::Function', Match.objectLike({
      Properties: { Description: 'src/app/woonbehoefte/reports/woonbehoefteReports.lambda.ts' },
    }));
    const [pageFunction]: any[] = Object.values(pageFunctions);
    const pageEnvironmentKeys = Object.keys(pageFunction.Properties.Environment.Variables);
    expect(pageEnvironmentKeys).not.toContain('OBJECTS_BASE_URL');
    expect(pageEnvironmentKeys).not.toContain('OPEN_ZAAK_DOCUMENTEN_BASE_URL');
  });

  it('only lets the reports page function invoke the Excel report worker', () => {
    const pageActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/woonbehoefte/reports/woonbehoefteReports.lambda.ts'));
    expect(pageActions).toContain('lambda:InvokeFunction');

    const workerActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/woonbehoefte/reports/woonbehoefteExcelWorker.lambda.ts'));
    expect(workerActions).not.toContain('lambda:InvokeFunction');
  });

  // The table's own read-only grant is covered by WoonbehoefteCasesTable.test.ts/WoonbehoefteSourceCacheTable.test.ts;
  // this only checks that the actual worker Lambda in the stack never gets a write action on either table.
  it('never gives the Excel report worker a write action on Cases or the source-cache table', () => {
    const workerActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/woonbehoefte/reports/woonbehoefteExcelWorker.lambda.ts'));
    expect(workerActions).not.toEqual(expect.arrayContaining([
      'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:TransactWriteItems',
    ]));
  });

  it('registers the Excel-overzichten route', () => {
    const routeKeys = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map((route: any) => route.Properties.RouteKey);
    expect(routeKeys).toContain('GET /woonbehoefte/overzichten');
  });

  it('creates an AuditWriteFailure alarm that triggers on any failure', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: 'audit-write-failure-low-lvl',
      Namespace: 'open-forms-management',
      MetricName: 'AuditWriteFailure',
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 0,
    }));
  });

  it('creates a LoginFailure rate alarm', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: 'login-failure-rate-low-lvl',
      Namespace: 'open-forms-management',
      MetricName: 'LoginFailure',
    }));
  });

  it('creates an API 5xx alarm on the management HTTP API', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: 'management-api-5xx-low-lvl',
      Namespace: 'AWS/ApiGateway',
      MetricName: '5xx',
    }));
  });

  it('logs CloudFront access to a private bucket without cookies, with a 90-day expiration', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', Match.objectLike({
      DistributionConfig: Match.objectLike({
        Logging: Match.objectLike({ IncludeCookies: false, Bucket: Match.anyValue() }),
      }),
    }));
    template.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({
      OwnershipControls: { Rules: [{ ObjectOwnership: 'ObjectWriter' }] },
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true }),
      LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Status: 'Enabled', ExpirationInDays: 90 })]) },
    }));
  });

  it('logs API access to a LogGroup with a safe format and no headers/cookies', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', Match.objectLike({ RetentionInDays: 90 }));
    const stages = template.findResources('AWS::ApiGatewayV2::Stage');
    const [apiStage]: any[] = Object.values(stages);
    expect(apiStage.Properties.StageName).toBe('$default');
    expect(apiStage.Properties.AccessLogSettings.DestinationArn).toBeDefined();
    const format = JSON.stringify(apiStage.Properties.AccessLogSettings.Format);
    expect(format).toEqual(expect.stringContaining('$context.requestId'));
    expect(format).toEqual(expect.stringContaining('$context.routeKey'));
    expect(format).toEqual(expect.stringContaining('$context.integrationStatus'));
    expect(format).toEqual(expect.stringContaining('$context.integration.status'));
    expect(format).toEqual(expect.stringContaining('$context.integrationErrorMessage'));
    expect(format).toEqual(expect.stringContaining('$context.integration.requestId'));
    expect(format).toEqual(expect.stringContaining('$context.error.message'));
    expect(format.toLowerCase()).not.toMatch(/cookie|authorization|csrf/);
  });

  it('deploys the static assets to the static-resources bucket under a static/ prefix, invalidating /static/* on deploy', () => {
    template.hasResourceProperties('Custom::CDKBucketDeployment', Match.objectLike({
      DestinationBucketKeyPrefix: 'static',
      DistributionPaths: ['/static/*'],
    }));
  });

  it('gives permissions-function read access to the PermissionsTable, including Scan for the admin overview', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/permissions/permissions.lambda.ts',
      Environment: Match.objectLike({ Variables: Match.objectLike({ PERMISSIONS_TABLE: Match.anyValue() }) }),
    }));
    // grantReadData() includes Scan, unlike home-function/sport-function which only ever Query.
    const actions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/permissions/permissions.lambda.ts'));
    expect(actions).toContain('dynamodb:Scan');
  });

  it('gives permissions-function exactly the write actions the mutation handlers need, nothing broader', () => {
    const actions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/permissions/permissions.lambda.ts'));
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:TransactWriteItems']));
    // UpdateItem/BatchWriteItem would come from grantWriteData()/grantReadWriteData(); this design replaces
    // a resource's grants wholesale (delete + put) instead of patching an item in place.
    expect(actions).not.toContain('dynamodb:UpdateItem');
    expect(actions).not.toContain('dynamodb:BatchWriteItem');
  });

  // DeleteItem/TransactWriteItems only ever come from PermissionsRoute.ts's write grant, so this check is safe
  // without also matching the resource ARN. PutItem can't be checked the same way: every page lambda already
  // has it for the (unrelated) AuditTrailTable via applyPageLambdaDefaults's grantPut().
  it('never gives home-function or sport-function DeleteItem/TransactWriteItems, the write actions only the Permissions Lambda needs', () => {
    const homeActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/home/home.lambda.ts'));
    const sportActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/sport/sport.lambda.ts'));
    expect(homeActions).not.toContain('dynamodb:DeleteItem');
    expect(homeActions).not.toContain('dynamodb:TransactWriteItems');
    expect(sportActions).not.toContain('dynamodb:DeleteItem');
    expect(sportActions).not.toContain('dynamodb:TransactWriteItems');
  });

  it('does not add a dedicated error-rate alarm for permissions-function, same as the other content pages', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm', Match.objectLike({
      Properties: { AlarmName: 'increased-error-rate-permissions-function-error-alarm-low-lvl' },
    }));
    expect(Object.keys(alarms)).toHaveLength(0);
  });

  it('gives home-function read access to the PermissionsTable and the PERMISSIONS_TABLE env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/home/home.lambda.ts',
      Environment: Match.objectLike({ Variables: Match.objectLike({ PERMISSIONS_TABLE: Match.anyValue() }) }),
    }));
    template.hasResourceProperties('AWS::IAM::Policy', Match.objectLike({
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Allow', Action: Match.arrayWith(['dynamodb:Query']) }),
        ]),
      }),
    }));
  });

  it('gives home-function write access to the AuditTrailTable and the AUDIT_TRAIL_TABLE env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/home/home.lambda.ts',
      Environment: Match.objectLike({ Variables: Match.objectLike({ AUDIT_TRAIL_TABLE: Match.anyValue() }) }),
    }));
  });

  it('gives home-function read access to the SessionsTable and the SESSION_TABLE env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/home/home.lambda.ts',
      Environment: Match.objectLike({ Variables: Match.objectLike({ SESSION_TABLE: Match.anyValue() }) }),
    }));
  });

  it('gives the SportExcelWorker a 900s timeout, separate from the 29s HTTP-facing sport-function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/sport/reporter/sportExcelWorker.lambda.ts',
      Timeout: 900,
    }));
  });

  it('does not give the SportExcelWorker an HTTP integration - it is invoked directly, not through the API', () => {
    const workers = template.findResources('AWS::Lambda::Function', Match.objectLike({
      Properties: { Description: 'src/app/sport/reporter/sportExcelWorker.lambda.ts' },
    }));
    const [workerLogicalId] = Object.keys(workers);
    const integrations = template.findResources('AWS::ApiGatewayV2::Integration');
    const referencesWorker = Object.values(integrations).some((integration) => JSON.stringify(integration).includes(workerLogicalId));
    expect(referencesWorker).toBe(false);
  });

  // The actual table/bucket grant boundaries (read/write split between sport-function and the worker) are
  // covered per-construct in SportReportsTable.test.ts and SportReportsBucket.test.ts; this only checks what
  // those unit tests can't: that the invoke permission on the worker is scoped to sport-function alone.
  it('only lets sport-function invoke the SportExcelWorker', () => {
    const actions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/sport/sport.lambda.ts'));
    expect(actions).toContain('lambda:InvokeFunction');

    const workerActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/sport/reporter/sportExcelWorker.lambda.ts'));
    expect(workerActions).not.toContain('lambda:InvokeFunction');
  });

  it('does not add a dedicated error-rate alarm for the SportExcelWorker', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm', Match.objectLike({
      Properties: { AlarmName: Match.stringLikeRegexp('sport-excel-worker') },
    }));
    expect(Object.keys(alarms)).toHaveLength(0);
  });

  it('gives the SportCacheWorker a 900s timeout and no HTTP integration - it is invoked directly, not through the API', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Description: 'src/app/sport/cache/sportCacheWorker.lambda.ts',
      Timeout: 900,
    }));
    const workers = template.findResources('AWS::Lambda::Function', Match.objectLike({
      Properties: { Description: 'src/app/sport/cache/sportCacheWorker.lambda.ts' },
    }));
    const [workerLogicalId] = Object.keys(workers);
    const integrations = template.findResources('AWS::ApiGatewayV2::Integration');
    const referencesWorker = Object.values(integrations).some((integration) => JSON.stringify(integration).includes(workerLogicalId));
    expect(referencesWorker).toBe(false);
  });

  it('only lets sport-function invoke the SportCacheWorker', () => {
    const actions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/sport/sport.lambda.ts'));
    expect(actions).toContain('lambda:InvokeFunction');

    const workerActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/sport/cache/sportCacheWorker.lambda.ts'));
    expect(workerActions).not.toContain('lambda:InvokeFunction');
  });

  it('never grants a wildcard s3:* action to either the sport-function or the worker role', () => {
    const frontendActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/sport/sport.lambda.ts'));
    const workerActions = actionsGrantedToRole(template, roleLogicalIdFor(template, 'src/app/sport/reporter/sportExcelWorker.lambda.ts'));
    expect(frontendActions).not.toContain('s3:*');
    expect(workerActions).not.toContain('s3:*');
  });

  it('serves a static fallback page for 500 responses, since a Lambda crash never reaches a handler that renders one', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', Match.objectLike({
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 500, ResponseCode: 500, ResponsePagePath: '/static/http-errors/500.html' }),
        ]),
      }),
    }));
  });

  // 401/403 no longer come from an authorizer at all (ADR-031); this only guards AuthorizationService's own
  // 403 "Geen toegang" page against being swallowed by a CustomErrorResponse.
  it('does not configure a custom error response for 401 or 403', () => {
    const distributions = template.findResources('AWS::CloudFront::Distribution');
    const [distribution]: any[] = Object.values(distributions);
    const errorCodes = distribution.Properties.DistributionConfig.CustomErrorResponses.map((response: any) => response.ErrorCode);
    expect(errorCodes).not.toContain(401);
    expect(errorCodes).not.toContain(403);
  });

  it('applies the same security headers policy to the dynamic and static behaviors', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', Match.objectLike({
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ResponseHeadersPolicyId: Match.anyValue() }),
        CacheBehaviors: Match.arrayWith([Match.objectLike({ ResponseHeadersPolicyId: Match.anyValue() })]),
      }),
    }));
  });

  it('sets a CSP without unsafe-inline or wildcard origins, plus the other standard security headers', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', Match.objectLike({
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: Match.objectLike({
            ContentSecurityPolicy: Match.stringLikeRegexp("default-src 'none'"),
            Override: true,
          }),
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000, Override: true }),
        }),
      }),
    }));

    const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
    const [policy]: any[] = Object.values(policies);
    const csp = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
    expect(csp).not.toMatch(/unsafe-inline/);
    expect(csp).not.toContain('*');
  });
});
