import { createHmac } from 'crypto';
import { ACTOR } from './fixtures';
import { signOpenZaakJwt } from '../OpenZaakJwt';

function decode(jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signature: string } {
  const [headerPart, payloadPart, signature] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')),
    signature,
  };
}

describe('signOpenZaakJwt', () => {
  const config = { clientId: 'test-client', clientSecret: 'test-secret' };
  const fixedNow = () => new Date('2026-08-20T10:00:00Z');

  it('produces a token with the HS256 header and all required claims', () => {
    const jwt = signOpenZaakJwt(config, ACTOR, { now: fixedNow });
    const { header, payload } = decode(jwt);

    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload).toMatchObject({
      iss: 'test-client',
      client_id: 'test-client',
      user_id: ACTOR.principalId,
      user_representation: ACTOR.email,
    });
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('sets iat to the current UNIX seconds', () => {
    const jwt = signOpenZaakJwt(config, ACTOR, { now: fixedNow });
    const { payload } = decode(jwt);

    expect(payload.iat).toBe(Math.floor(fixedNow().getTime() / 1000));
  });

  it('defaults to a 10 minute expiry', () => {
    const jwt = signOpenZaakJwt(config, ACTOR, { now: fixedNow });
    const { payload } = decode(jwt);

    expect((payload.exp as number) - (payload.iat as number)).toBe(600);
  });

  it('allows an explicit expiry up to the 15 minute boundary', () => {
    const jwt = signOpenZaakJwt(config, ACTOR, { now: fixedNow, expiresInSeconds: 900 });
    const { payload } = decode(jwt);

    expect((payload.exp as number) - (payload.iat as number)).toBe(900);
  });

  it('rejects an expiry beyond 15 minutes instead of clamping it', () => {
    expect(() => signOpenZaakJwt(config, ACTOR, { expiresInSeconds: 901 })).toThrow('at most 900 seconds');
  });

  it('rejects a non-positive expiry', () => {
    expect(() => signOpenZaakJwt(config, ACTOR, { expiresInSeconds: 0 })).toThrow('positive integer');
  });

  it('falls back to principalId for user_representation when email is missing', () => {
    const jwt = signOpenZaakJwt(config, { principalId: 'no-email-user' }, { now: fixedNow });
    const { payload } = decode(jwt);

    expect(payload.user_representation).toBe('no-email-user');
  });

  it('signs with a valid HS256 HMAC over header.payload', () => {
    const jwt = signOpenZaakJwt(config, ACTOR, { now: fixedNow });
    const [headerPart, payloadPart, signature] = jwt.split('.');
    const expectedSignature = createHmac('sha256', config.clientSecret).update(`${headerPart}.${payloadPart}`).digest('base64url');

    expect(signature).toBe(expectedSignature);
  });

  it('produces a different signature for a different clientSecret', () => {
    const jwtA = signOpenZaakJwt(config, ACTOR, { now: fixedNow });
    const jwtB = signOpenZaakJwt({ ...config, clientSecret: 'other-secret' }, ACTOR, { now: fixedNow });

    expect(jwtA).not.toBe(jwtB);
  });
});
