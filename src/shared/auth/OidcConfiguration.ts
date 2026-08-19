import { AWS } from '@gemeentenijmegen/utils';
import { EntraOidcClientConfiguration } from './EntraOidcClient';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';

const requiredEnvironmentVariables = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET_ARN', 'MANAGEMENT_DOMAIN'] as const;

const CALLBACK_PATH = '/auth/callback';

/**
 * Reads OIDC configuration at runtime: non-secret values from Lambda
 * environment variables (sourced from SSM/CDK at deploy time), the client
 * secret from Secrets Manager. Never logs the resolved values.
 *
 * The redirect URL is derived from the management domain rather than
 * stored as its own SSM parameter, so there is nothing to keep in sync
 * with the actual deployed domain.
 */
export async function loadOidcConfiguration(): Promise<EntraOidcClientConfiguration> {
  const missing = requiredEnvironmentVariables.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    logger.error('OIDC configuration is incomplete', { missingEnvironmentVariables: missing });
    throw new Error(`OIDC configuration is incomplete: missing ${missing.join(', ')}`);
  }

  const clientSecretArn = process.env.OIDC_CLIENT_SECRET_ARN!;
  let clientSecret: string;
  try {
    clientSecret = await AWS.getSecret(clientSecretArn);
  } catch (error) {
    logger.error('Failed to fetch OIDC client secret from Secrets Manager', { clientSecretArn, reason: errorReason(error) });
    throw error;
  }

  return {
    issuer: process.env.OIDC_ISSUER!,
    clientId: process.env.OIDC_CLIENT_ID!,
    redirectUrl: new URL(CALLBACK_PATH, `https://${process.env.MANAGEMENT_DOMAIN}`).toString(),
    clientSecret,
  };
}
