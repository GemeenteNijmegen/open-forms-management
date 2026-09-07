import { decryptOidcTransactionState, encryptOidcTransactionState } from '../OidcTransactionStateCookie';

const mockEncryptKeycloakCookie = jest.fn();
const mockDecryptKeycloakCookie = jest.fn();

jest.mock('../KeycloakCookieCipher', () => ({
  encryptKeycloakCookie: (...args: unknown[]) => mockEncryptKeycloakCookie(...args),
  decryptKeycloakCookie: (...args: unknown[]) => mockDecryptKeycloakCookie(...args),
}));

describe('OidcTransactionStateCookie', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('encrypts the transaction state fields as claims with the issuedAt/expiresAt lifetime', async () => {
    mockEncryptKeycloakCookie.mockResolvedValue('the-jwe');

    const jwe = await encryptOidcTransactionState({
      state: 'the-state', nonce: 'the-nonce', codeVerifier: 'the-verifier', returnUrl: '/woonbehoefte/123', issuedAt: 1000, expiresAt: 1600,
    });

    expect(mockEncryptKeycloakCookie).toHaveBeenCalledWith(
      { state: 'the-state', nonce: 'the-nonce', codeVerifier: 'the-verifier', returnUrl: '/woonbehoefte/123' },
      1000,
      1600,
    );
    expect(jwe).toBe('the-jwe');
  });

  it('decrypts and maps the claims back to an OidcTransactionState', async () => {
    mockDecryptKeycloakCookie.mockResolvedValue({
      claims: { state: 'the-state', nonce: 'the-nonce', codeVerifier: 'the-verifier' },
      issuedAt: 1000,
      expiresAt: 1600,
    });

    const state = await decryptOidcTransactionState('the-jwe');

    expect(state).toEqual({
      state: 'the-state', nonce: 'the-nonce', codeVerifier: 'the-verifier', issuedAt: 1000, expiresAt: 1600,
    });
  });

  it.each([
    ['a missing state claim', { nonce: 'n', codeVerifier: 'v' }],
    ['a missing nonce claim', { state: 's', codeVerifier: 'v' }],
    ['a missing codeVerifier claim', { state: 's', nonce: 'n' }],
  ])('fails closed for %s', async (_description, claims) => {
    mockDecryptKeycloakCookie.mockResolvedValue({ claims, issuedAt: 1000, expiresAt: 1600 });

    await expect(decryptOidcTransactionState('the-jwe')).rejects.toThrow();
  });
});
