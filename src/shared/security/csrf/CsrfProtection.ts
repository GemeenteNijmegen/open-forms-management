import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * All mutating permissions forms carry a CSRF token, double-submit cookie pattern: the server generates a
 * random token when it renders a form, sets it as a Host-prefixed cookie and embeds the same value as a hidden
 * field in that form. Every POST checks that the submitted token matches the cookie exactly. Without a match,
 * the request gets a 403 and no write happens. Not tied to the session: a fresh token per render is enough,
 * there is no server-side token store. Tokens are never put in a URL, logged or recorded in an audit event.
 * SameSite=Strict and the existing same-origin check for fetch requests stay active alongside this.
 *
 * Use this for any new plain form that writes data (create/update/delete); skip it for read-only GETs and for
 * fetch-driven requests, SameOriginRequest.ts covers those. Of course also overkill for filtering form input.
 * Example: render with issueCsrfToken(), check the submit with isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD)).
 */
export const CSRF_COOKIE_NAME = '__Host-csrf';
export const CSRF_FORM_FIELD = 'csrfToken';

export interface CsrfToken {
  value: string;
  cookie: string;
}

/** Issues a fresh token: the value to embed as a hidden field, and the matching cookie to set alongside it. */
export function issueCsrfToken(): CsrfToken {
  const value = randomBytes(32).toString('base64url');
  return { value, cookie: `${CSRF_COOKIE_NAME}=${value}; Secure; HttpOnly; SameSite=Strict; Path=/` };
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  return cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** True only when the cookie and the submitted token both exist and match exactly, compared in constant time. */
export function isValidCsrfSubmission(cookieHeader: string | undefined, submittedToken: string | undefined): boolean {
  const cookieToken = readCookie(cookieHeader, CSRF_COOKIE_NAME);
  if (!cookieToken || !submittedToken) {
    return false;
  }

  const cookieBuffer = Buffer.from(cookieToken);
  const submittedBuffer = Buffer.from(submittedToken);
  return cookieBuffer.length === submittedBuffer.length && timingSafeEqual(cookieBuffer, submittedBuffer);
}
