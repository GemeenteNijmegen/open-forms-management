import { Function } from 'aws-cdk-lib/aws-lambda';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Statics } from '../../Statics';

/**
 * Not called from AppStack yet: this only wires environment/permissions onto a Lambda the caller
 * already created. Every Keycloak capability needs the base realm config, so both functions below
 * call this first.
 */
function applyKeycloakBaseEnvironment(scope: Construct, fn: Function): void {
  fn.addEnvironment('KEYCLOAK_BASE_URL', StringParameter.valueForStringParameter(scope, Statics.ssmKeycloakBaseUrl));
  fn.addEnvironment('KEYCLOAK_ISSUER', StringParameter.valueForStringParameter(scope, Statics.ssmKeycloakIssuer));
  fn.addEnvironment('KEYCLOAK_REALM', StringParameter.valueForStringParameter(scope, Statics.ssmKeycloakRealm));
}

/**
 * Wires what an interactive OIDC Lambda (login/callback) needs: the OIDC client secret and the BFF
 * auth-cookie key. Never grants the permission-admin secret, so this capability alone can't call the
 * Keycloak Admin API.
 */
export function applyKeycloakAuthenticationEnvironment(scope: Construct, fn: Function): void {
  applyKeycloakBaseEnvironment(scope, fn);

  const oidcClientSecret = Secret.fromSecretNameV2(scope, `keycloak-oidc-client-secret-for-${fn.node.id}`, Statics.secretKeycloakOidcClient);
  oidcClientSecret.grantRead(fn);
  fn.addEnvironment('KEYCLOAK_OIDC_CLIENT_SECRET_NAME', Statics.secretKeycloakOidcClient);

  const authCookieKeySecret = Secret.fromSecretNameV2(scope, `keycloak-auth-cookie-key-for-${fn.node.id}`, Statics.secretKeycloakAuthCookieKey);
  authCookieKeySecret.grantRead(fn);
  fn.addEnvironment('KEYCLOAK_AUTH_COOKIE_KEY_SECRET_NAME', Statics.secretKeycloakAuthCookieKey);
}

/**
 * Wires what a permission-administration Lambda needs: the Client Credentials secret for the
 * Keycloak Admin API. Never grants the interactive OIDC or auth-cookie secrets, so this capability
 * alone can't read or forge an end-user auth cookie.
 */
export function applyKeycloakPermissionAdministrationEnvironment(scope: Construct, fn: Function): void {
  applyKeycloakBaseEnvironment(scope, fn);

  const permissionAdminSecret = Secret.fromSecretNameV2(scope, `keycloak-permission-admin-secret-for-${fn.node.id}`, Statics.secretKeycloakPermissionAdminClient);
  permissionAdminSecret.grantRead(fn);
  fn.addEnvironment('KEYCLOAK_PERMISSION_ADMIN_CLIENT_SECRET_NAME', Statics.secretKeycloakPermissionAdminClient);
}
