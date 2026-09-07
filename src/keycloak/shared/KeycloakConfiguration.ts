import { z } from 'zod';

/**
 * Trusted deployment config for a Keycloak realm. issuer gets compared exactly against JWT iss
 * claims, baseUrl builds discovery/Admin REST calls. Kept as separate fields since neither is a
 * substring of the other.
 */
export interface KeycloakBaseConfiguration {
  /** With trailing slash, e.g. https://keycloak.example.com/ */
  baseUrl: string;
  issuer: string;
  realm: string;
}

export interface KeycloakClientCredentials {
  clientId: string;
  clientSecret: string;
}

const clientCredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

/** Parses a Secrets Manager JSON value into client credentials. Never puts the raw secret value in a thrown error. */
export function parseKeycloakClientCredentials(secretValue: string, secretName: string): KeycloakClientCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretValue);
  } catch {
    throw new Error(`${secretName} secret is not valid JSON`);
  }

  const result = clientCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${secretName} secret is missing clientId/clientSecret`);
  }
  return result.data;
}
