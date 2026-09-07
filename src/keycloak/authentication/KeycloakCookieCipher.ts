import { EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose';
import { loadKeycloakAuthCookieKey } from './KeycloakAuthCookieKeyConfiguration';

const ALG = 'dir';
const ENC = 'A256GCM';

let cachedKey: Promise<Uint8Array> | undefined;

async function resolveKey(): Promise<Uint8Array> {
  if (!cachedKey) {
    cachedKey = loadKeycloakAuthCookieKey()
      .then((base64Key) => new Uint8Array(Buffer.from(base64Key, 'base64')))
      .catch((error) => {
        cachedKey = undefined;
        throw error;
      });
  }
  return cachedKey;
}

/**
 * Encrypts claims as a compact JsonWebEncryption (dir key agreement, A256GCM) with the single Keycloak auth-cookie
 * key. No kid: there is only ever one key, nothing to select between.
 */
export async function encryptKeycloakCookie(claims: JWTPayload, issuedAt: number, expiresAt: number): Promise<string> {
  const key = await resolveKey();
  return new EncryptJWT(claims)
    .setProtectedHeader({ alg: ALG, enc: ENC })
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .encrypt(key);
}

export interface DecryptedKeycloakCookie<T> {
  claims: T;
  issuedAt: number;
  expiresAt: number;
}

/** jwtDecrypt enforces exp itself (and rejects any tampering, since A256GCM is authenticated encryption). */
export async function decryptKeycloakCookie<T = JWTPayload>(jwe: string): Promise<DecryptedKeycloakCookie<T>> {
  const key = await resolveKey();
  const { payload } = await jwtDecrypt(jwe, key, {
    keyManagementAlgorithms: [ALG],
    contentEncryptionAlgorithms: [ENC],
  });

  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    throw new Error('Keycloak cookie is missing iat/exp');
  }
  return { claims: payload as T, issuedAt: payload.iat, expiresAt: payload.exp };
}
