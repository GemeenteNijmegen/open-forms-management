import { decryptKeycloakCookie, encryptKeycloakCookie } from './KeycloakCookieCipher';
import { OidcTransactionState } from './OidcTransactionState';

interface TransactionStateClaims {
  state?: unknown;
  nonce?: unknown;
  codeVerifier?: unknown;
  returnUrl?: unknown;
}

export async function encryptOidcTransactionState(transactionState: OidcTransactionState): Promise<string> {
  return encryptKeycloakCookie(
    {
      state: transactionState.state,
      nonce: transactionState.nonce,
      codeVerifier: transactionState.codeVerifier,
      ...(transactionState.returnUrl ? { returnUrl: transactionState.returnUrl } : {}),
    },
    transactionState.issuedAt,
    transactionState.expiresAt,
  );
}

export async function decryptOidcTransactionState(jwe: string): Promise<OidcTransactionState> {
  const { claims, issuedAt, expiresAt } = await decryptKeycloakCookie<TransactionStateClaims>(jwe);

  if (typeof claims.state !== 'string' || claims.state.length === 0) {
    throw new Error('OIDC transaction state cookie is missing the state claim');
  }
  if (typeof claims.nonce !== 'string' || claims.nonce.length === 0) {
    throw new Error('OIDC transaction state cookie is missing the nonce claim');
  }
  if (typeof claims.codeVerifier !== 'string' || claims.codeVerifier.length === 0) {
    throw new Error('OIDC transaction state cookie is missing the codeVerifier claim');
  }

  return {
    state: claims.state,
    nonce: claims.nonce,
    codeVerifier: claims.codeVerifier,
    ...(typeof claims.returnUrl === 'string' ? { returnUrl: claims.returnUrl } : {}),
    issuedAt,
    expiresAt,
  };
}
