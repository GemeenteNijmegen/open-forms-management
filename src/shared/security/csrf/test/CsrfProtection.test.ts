import { CSRF_COOKIE_NAME, issueCsrfToken, isValidCsrfSubmission } from '../CsrfProtection';

describe('CsrfProtection', () => {
  it('issues a __Host- cookie with Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain', () => {
    const token = issueCsrfToken();

    expect(token.cookie.startsWith(`${CSRF_COOKIE_NAME}=${token.value}; `)).toBe(true);
    expect(token.cookie).toContain('Secure');
    expect(token.cookie).toContain('HttpOnly');
    expect(token.cookie).toContain('SameSite=Strict');
    expect(token.cookie).toContain('Path=/');
    expect(token.cookie).not.toContain('Domain=');
  });

  it('accepts a submission where the cookie and the hidden field match exactly', () => {
    const token = issueCsrfToken();

    expect(isValidCsrfSubmission(`${CSRF_COOKIE_NAME}=${token.value}`, token.value)).toBe(true);
  });

  it('rejects a missing cookie, a missing submitted token, and a mismatch, without ever writing', () => {
    const token = issueCsrfToken();

    expect(isValidCsrfSubmission(undefined, token.value)).toBe(false);
    expect(isValidCsrfSubmission(`${CSRF_COOKIE_NAME}=${token.value}`, undefined)).toBe(false);
    expect(isValidCsrfSubmission(`${CSRF_COOKIE_NAME}=${token.value}`, 'attacker-guess')).toBe(false);
    expect(isValidCsrfSubmission('some-other-cookie=abc', token.value)).toBe(false);
  });
});
