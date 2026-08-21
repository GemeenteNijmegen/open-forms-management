import { createHmac } from 'crypto';
import { EmployeeIdentity } from '../../auth/EmployeeIdentity';

export interface OpenZaakJwtConfig {
  clientId: string;
  clientSecret: string;
}

export interface SignOpenZaakJwtOptions {
  /** Defaults to 10 minutes. Rejected outright above the 15 minute contract limit instead of silently clamped. */
  expiresInSeconds?: number;
  now?: () => Date;
}

const DEFAULT_EXPIRES_IN_SECONDS = 10 * 60;
const MAX_EXPIRES_IN_SECONDS = 15 * 60;

/**
 * No token endpoint exists for Open Zaak Documenten; the client signs its
 * own short-lived actor-aware JWT locally. Not cached, call this again for
 * every real HTTP attempt.
 */
export function signOpenZaakJwt(config: OpenZaakJwtConfig, actor: EmployeeIdentity, options: SignOpenZaakJwtOptions = {}): string {
  const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS;
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > MAX_EXPIRES_IN_SECONDS) {
    throw new Error(`Open Zaak JWT expiresInSeconds must be a positive integer of at most ${MAX_EXPIRES_IN_SECONDS} seconds`);
  }

  const now = options.now?.() ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: config.clientId,
    iat,
    exp: iat + expiresInSeconds,
    client_id: config.clientId,
    user_id: actor.principalId,
    user_representation: actor.email ?? actor.principalId,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', config.clientSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
