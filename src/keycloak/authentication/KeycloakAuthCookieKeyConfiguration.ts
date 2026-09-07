import { AWS, environmentVariables } from '@gemeentenijmegen/utils';
import { z } from 'zod';

/**
 * Symmetric key for the encrypted BFF auth cookie. A single raw key, no history: rotating it
 * invalidates every cookie encrypted with the old one, which simply sends that user back to login.
 */
export type KeycloakAuthCookieKey = string;

// openssl rand -base64 32 encodes 32 random bytes as standard base64
const authCookieKeySchema = z.base64();

let cachedKey: Promise<KeycloakAuthCookieKey> | undefined;

/**
 * Cached so repeated invocations on the same warm Lambda container reuse the already-fetched key
 * instead of calling Secrets Manager again every time.
 */
export async function loadKeycloakAuthCookieKey(): Promise<KeycloakAuthCookieKey> {
  if (!cachedKey) {
    cachedKey = resolveKeycloakAuthCookieKey().catch((error) => {
      cachedKey = undefined;
      throw error;
    });
  }
  return cachedKey;
}

async function resolveKeycloakAuthCookieKey(): Promise<KeycloakAuthCookieKey> {
  const env = environmentVariables(['KEYCLOAK_AUTH_COOKIE_KEY_SECRET_NAME'] as const);
  const secretValue = await AWS.getSecret(env.KEYCLOAK_AUTH_COOKIE_KEY_SECRET_NAME);

  const result = authCookieKeySchema.safeParse(secretValue);
  if (!result.success) {
    throw new Error('Keycloak auth cookie key secret is malformed');
  }
  return result.data;
}
