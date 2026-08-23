export const SPORT_SAME_ORIGIN_HEADER = 'x-sport-same-origin';

/** Register a new header here; ManagementDistribution.ts allows the whole list through CloudFront to the origin. */
export const SAME_ORIGIN_HEADERS = [SPORT_SAME_ORIGIN_HEADER] as const;

type RegisteredSameOriginHeader = (typeof SAME_ORIGIN_HEADERS)[number];

/** No generic CSRF framework: a cross-site request can't set a custom header, so checking one is enough. */
export function isSameOriginRequest(headers: Record<string, string | undefined> | undefined, headerName: RegisteredSameOriginHeader): boolean {
  return headers?.[headerName] === '1';
}
