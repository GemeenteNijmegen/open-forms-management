/**
 * Checks a fixed custom header on a same-origin fetch: a cross-site form/simple request can't set an
 * arbitrary header, so this is enough same-origin protection for a feature's own state-changing POSTs
 * without a generic CSRF framework. Header name and expected value are the caller's own choice.
 */
export function isSameOriginRequest(headers: Record<string, string | undefined> | undefined, headerName: string): boolean {
  return headers?.[headerName] === '1';
}
