import { KeycloakTokenVerifier } from '../KeycloakTokenVerifier';

const mockCreateRemoteJWKSet = jest.fn();
const mockJwtVerify = jest.fn();

jest.mock('jose', () => ({
  createRemoteJWKSet: (...args: unknown[]) => mockCreateRemoteJWKSet(...args),
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));

const issuer = 'https://keycloak.example.com/realms/example-realm';
const audience = 'open-forms-management';
const jwksUri = `${issuer}/protocol/openid-connect/certs`;

const settings = {
  baseUrl: 'https://keycloak.example.com/',
  issuer,
  realm: 'example-realm',
  oidcClient: { clientId: audience, clientSecret: 'unused-for-verification' },
};

// jose itself is a pure ESM package that this Jest setup (CommonJS, no --experimental-vm-modules)
// cannot load directly, so real signature/expiry verification is jose's own test suite's job here;
// this file proves KeycloakTokenVerifier calls jose with the right options and handles its results.
describe('KeycloakTokenVerifier', () => {
  const getKey = () => { };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateRemoteJWKSet.mockReturnValue(getKey);
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === `${issuer}/.well-known/openid-configuration`) {
        return new Response(JSON.stringify({ jwks_uri: jwksUri }), { status: 200 });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as unknown as typeof fetch;
  });

  it('resolves the JWKS via discovery, verifies with issuer/audience/RS256, and returns the mapped claims', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        iss: issuer,
        sub: 'user-123',
        aud: audience,
        exp: 1893456000,
        email: 'medewerker@example.com',
        resource_access: { [audience]: { roles: ['sport:view', 'sport:district:all'] } },
      },
    });

    const verifier = new KeycloakTokenVerifier(settings);
    const claims = await verifier.verifyAccessToken('a.b.c');

    expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(new URL(jwksUri));
    expect(mockJwtVerify).toHaveBeenCalledWith('a.b.c', getKey, {
      issuer,
      audience,
      algorithms: ['RS256'],
    });
    expect(claims).toEqual({
      iss: issuer,
      sub: 'user-123',
      aud: audience,
      exp: 1893456000,
      email: 'medewerker@example.com',
      roles: ['sport:view', 'sport:district:all'],
    });
  });

  it.each([
    ['a rejection from jose (wrong issuer/audience/expired/bad signature all surface this way)', () => {
      mockJwtVerify.mockRejectedValue(new Error('signature verification failed'));
    }],
    ['a payload missing the subject claim', () => {
      mockJwtVerify.mockResolvedValue({ payload: { iss: issuer, aud: audience, exp: 1893456000, email: 'medewerker@example.com' } });
    }],
    ['a payload missing the email claim', () => {
      mockJwtVerify.mockResolvedValue({ payload: { iss: issuer, sub: 'user-123', aud: audience, exp: 1893456000 } });
    }],
  ])('fails closed for %s', async (_description, setupMock) => {
    setupMock();
    const verifier = new KeycloakTokenVerifier(settings);

    await expect(verifier.verifyAccessToken('a.b.c')).rejects.toThrow();
  });
});
