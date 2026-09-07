import { decryptKeycloakAuthCookie, encryptKeycloakAuthCookie } from '../KeycloakAuthCookie';

const mockEncryptKeycloakCookie = jest.fn();
const mockDecryptKeycloakCookie = jest.fn();

jest.mock('../KeycloakCookieCipher', () => ({
  encryptKeycloakCookie: (...args: unknown[]) => mockEncryptKeycloakCookie(...args),
  decryptKeycloakCookie: (...args: unknown[]) => mockDecryptKeycloakCookie(...args),
}));

describe('KeycloakAuthCookie', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('encrypts the token fields as claims, with the envelope expiry set to the refresh token expiry', async () => {
    mockEncryptKeycloakCookie.mockResolvedValue('the-jwe');

    const jwe = await encryptKeycloakAuthCookie({
      accessToken: 'the-access-token',
      accessTokenExpiresAt: 1300,
      refreshToken: 'the-refresh-token',
      refreshTokenExpiresAt: 1600,
      idToken: 'the-id-token',
    });

    expect(mockEncryptKeycloakCookie).toHaveBeenCalledWith(
      { accessToken: 'the-access-token', accessTokenExpiresAt: 1300, refreshToken: 'the-refresh-token', idToken: 'the-id-token' },
      expect.any(Number),
      1600,
    );
    expect(jwe).toBe('the-jwe');
  });

  it('refuses to encrypt without a refresh token expiry, since that would leave the cookie envelope unbounded', async () => {
    await expect(encryptKeycloakAuthCookie({
      accessToken: 'the-access-token', accessTokenExpiresAt: 1300, refreshToken: 'the-refresh-token', idToken: 'the-id-token',
    })).rejects.toThrow('refresh token expiry');

    expect(mockEncryptKeycloakCookie).not.toHaveBeenCalled();
  });

  it('decrypts and maps the claims back to KeycloakTokens, with refreshTokenExpiresAt from the envelope', async () => {
    mockDecryptKeycloakCookie.mockResolvedValue({
      claims: { accessToken: 'the-access-token', accessTokenExpiresAt: 1300, refreshToken: 'the-refresh-token', idToken: 'the-id-token' },
      issuedAt: 1000,
      expiresAt: 1600,
    });

    const tokens = await decryptKeycloakAuthCookie('the-jwe');

    expect(tokens).toEqual({
      accessToken: 'the-access-token',
      accessTokenExpiresAt: 1300,
      refreshToken: 'the-refresh-token',
      refreshTokenExpiresAt: 1600,
      idToken: 'the-id-token',
    });
  });

  it.each([
    ['a missing accessToken claim', { accessTokenExpiresAt: 1300, refreshToken: 'r', idToken: 'i' }],
    ['a missing refreshToken claim', { accessToken: 'a', accessTokenExpiresAt: 1300, idToken: 'i' }],
    ['a missing idToken claim', { accessToken: 'a', accessTokenExpiresAt: 1300, refreshToken: 'r' }],
  ])('fails closed for %s', async (_description, claims) => {
    mockDecryptKeycloakCookie.mockResolvedValue({ claims, issuedAt: 1000, expiresAt: 1600 });

    await expect(decryptKeycloakAuthCookie('the-jwe')).rejects.toThrow();
  });
});
