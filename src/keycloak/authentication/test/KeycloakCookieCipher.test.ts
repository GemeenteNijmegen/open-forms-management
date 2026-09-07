import { AWS } from '@gemeentenijmegen/utils';
import { decryptKeycloakCookie, encryptKeycloakCookie } from '../KeycloakCookieCipher';

jest.mock('@gemeentenijmegen/utils', () => ({
  ...jest.requireActual('@gemeentenijmegen/utils'),
  AWS: { getSecret: jest.fn() },
}));

const mockEncrypt = jest.fn();
const mockSetProtectedHeader = jest.fn();
const mockSetIssuedAt = jest.fn();
const mockSetExpirationTime = jest.fn();
const MockEncryptJWT = jest.fn();
const mockJwtDecrypt = jest.fn();

jest.mock('jose', () => ({
  EncryptJWT: function EncryptJWT(...args: unknown[]) {
    MockEncryptJWT(...args);
    const builder = {
      setProtectedHeader: (...a: unknown[]) => { mockSetProtectedHeader(...a); return builder; },
      setIssuedAt: (...a: unknown[]) => { mockSetIssuedAt(...a); return builder; },
      setExpirationTime: (...a: unknown[]) => { mockSetExpirationTime(...a); return builder; },
      encrypt: (...a: unknown[]) => mockEncrypt(...a),
    };
    return builder;
  },
  jwtDecrypt: (...args: unknown[]) => mockJwtDecrypt(...args),
}));

// A base64-encoded 256-bit key, matching what loadKeycloakAuthCookieKey() returns.
const AUTH_COOKIE_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaY=';

describe('KeycloakCookieCipher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AWS.getSecret as jest.Mock).mockResolvedValue(AUTH_COOKIE_KEY);
    process.env.KEYCLOAK_AUTH_COOKIE_KEY_SECRET_NAME = 'example-auth-cookie-key-secret-name';
  });

  it('encrypts with dir/A256GCM, no kid, and the decoded auth-cookie key', async () => {
    mockEncrypt.mockResolvedValue('the-jwe');

    const jwe = await encryptKeycloakCookie({ foo: 'bar' }, 1000, 1600);

    expect(MockEncryptJWT).toHaveBeenCalledWith({ foo: 'bar' });
    expect(mockSetProtectedHeader).toHaveBeenCalledWith({ alg: 'dir', enc: 'A256GCM' });
    expect(mockSetIssuedAt).toHaveBeenCalledWith(1000);
    expect(mockSetExpirationTime).toHaveBeenCalledWith(1600);
    const [key] = mockEncrypt.mock.calls[0];
    expect(Buffer.from(key).toString('base64')).toBe(AUTH_COOKIE_KEY);
    expect(jwe).toBe('the-jwe');
  });

  it('decrypts restricted to dir/A256GCM and maps iat/exp to issuedAt/expiresAt', async () => {
    mockJwtDecrypt.mockResolvedValue({ payload: { foo: 'bar', iat: 1000, exp: 1600 } });

    const result = await decryptKeycloakCookie('the-jwe');

    expect(mockJwtDecrypt).toHaveBeenCalledWith('the-jwe', expect.any(Uint8Array), {
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    expect(result).toEqual({ claims: { foo: 'bar', iat: 1000, exp: 1600 }, issuedAt: 1000, expiresAt: 1600 });
  });

  it('fails closed when jose rejects the JWE (tampered ciphertext, wrong key, or expired all surface this way)', async () => {
    mockJwtDecrypt.mockRejectedValue(new Error('decryption operation failed'));

    await expect(decryptKeycloakCookie('the-jwe')).rejects.toThrow('decryption operation failed');
  });

  it('fails closed when the decrypted payload has no iat/exp', async () => {
    mockJwtDecrypt.mockResolvedValue({ payload: { foo: 'bar' } });

    await expect(decryptKeycloakCookie('the-jwe')).rejects.toThrow('iat/exp');
  });
});
