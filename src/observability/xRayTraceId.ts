const NO_TRACE_ID = 'no-trace-id';

/**
 * Lambda sets `_X_AMZN_TRACE_ID` automatically when X-Ray active tracing is on; the `Root=` segment is the
 * stable ID shared across the authorizer and route-handler invocations for the same request.
 *
 * Unlike other env vars, Lambda refreshes this one before every invocation, even on a warm/reused container,
 * so reading it here (inside the function call, not cached at module load) always gets the current
 * invocation's trace, not a stale one.
 */
export function xRayTraceId(): string {
  const header = process.env._X_AMZN_TRACE_ID;
  const match = header?.match(/Root=([^;]+)/);
  return match?.[1] ?? NO_TRACE_ID;
}
