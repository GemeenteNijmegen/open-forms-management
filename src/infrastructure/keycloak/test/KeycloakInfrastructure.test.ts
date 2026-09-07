import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Statics } from '../../../Statics';
import { applyKeycloakAuthenticationEnvironment, applyKeycloakPermissionAdministrationEnvironment } from '../KeycloakInfrastructure';

function secretsManagerResourceTextFor(template: Template, description: string): string {
  const functions = template.findResources('AWS::Lambda::Function', Match.objectLike({ Properties: { Description: description } }));
  const [fn]: any[] = Object.values(functions);
  const roleLogicalId = fn.Properties.Role['Fn::GetAtt'][0];

  const policies = Object.values(template.findResources('AWS::IAM::Policy')) as any[];
  const statements = policies
    .filter((policy) => (policy.Properties.Roles ?? []).some((role: any) => role.Ref === roleLogicalId))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement)
    .filter((statement: any) => JSON.stringify(statement.Action).includes('secretsmanager:'));

  return JSON.stringify(statements);
}

// This is a dedicated test stack, not the production AppStack: KeycloakInfrastructure is not called
// from AppStack yet, so it can only be exercised by wiring it onto Lambdas created here.
it('wires each Keycloak capability to only its own secrets on a fake Lambda, never the other capability\'s', () => {
  const stack = new Stack(new App(), 'keycloak-infra-test-stack', { env: { account: '123456789012', region: 'eu-central-1' } });
  const runtime = Runtime.NODEJS_LATEST;

  const authFunction = new Function(stack, 'auth-fn', {
    runtime,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
    description: 'keycloak-auth-fn',
  });
  applyKeycloakAuthenticationEnvironment(stack, authFunction);

  const permissionAdminFunction = new Function(stack, 'permission-admin-fn', {
    runtime,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
    description: 'keycloak-permission-admin-fn',
  });
  applyKeycloakPermissionAdministrationEnvironment(stack, permissionAdminFunction);

  const template = Template.fromStack(stack);

  const authSecrets = secretsManagerResourceTextFor(template, 'keycloak-auth-fn');
  expect(authSecrets).toContain(Statics.secretKeycloakOidcClient);
  expect(authSecrets).toContain(Statics.secretKeycloakAuthCookieKey);
  expect(authSecrets).not.toContain(Statics.secretKeycloakPermissionAdminClient);
  expect(authSecrets).not.toContain('secretsmanager:*');

  const permissionAdminSecrets = secretsManagerResourceTextFor(template, 'keycloak-permission-admin-fn');
  expect(permissionAdminSecrets).toContain(Statics.secretKeycloakPermissionAdminClient);
  expect(permissionAdminSecrets).not.toContain(Statics.secretKeycloakOidcClient);
  expect(permissionAdminSecrets).not.toContain(Statics.secretKeycloakAuthCookieKey);
  expect(permissionAdminSecrets).not.toContain('secretsmanager:*');
});
