import { parseKeycloakClientCredentials } from '../KeycloakConfiguration';

describe('parseKeycloakClientCredentials', () => {
  it('parses a valid client credentials secret', () => {
    const credentials = parseKeycloakClientCredentials(
      JSON.stringify({ clientId: 'client-a', clientSecret: 'top-secret-value' }),
      'Keycloak OIDC client',
    );

    expect(credentials).toEqual({ clientId: 'client-a', clientSecret: 'top-secret-value' });
  });

  it.each([
    ['not valid JSON', 'not-json'],
    ['missing clientId', JSON.stringify({ clientSecret: 'top-secret-value' })],
    ['missing clientSecret', JSON.stringify({ clientId: 'client-a' })],
    ['an empty clientId', JSON.stringify({ clientId: '', clientSecret: 'top-secret-value' })],
  ])('fails closed for a secret with %s, without leaking the secret value', (_description, secretValue) => {
    expect(() => parseKeycloakClientCredentials(secretValue, 'Keycloak OIDC client'))
      .toThrow(/^Keycloak OIDC client secret is/);

    try {
      parseKeycloakClientCredentials(secretValue, 'Keycloak OIDC client');
      fail('expected parseKeycloakClientCredentials to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('top-secret-value');
    }
  });
});
