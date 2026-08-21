import { ObjectsClientConfiguration } from '../ObjectsConfiguration';

export const BASE_URL = 'https://mijn-services.accp.nijmegen.nl/objects/api/v2/';
export const CONFIG: ObjectsClientConfiguration = { baseUrl: BASE_URL, apiToken: 'test-token' };

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => body,
  } as unknown as Response;
}

/** A 2xx response whose body is not valid JSON syntax. */
export function malformedJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => {
      throw new SyntaxError('Unexpected token in JSON');
    },
  } as unknown as Response;
}

export function sampleObject(overrides: { uuid?: string; registrationAt?: string; data?: unknown } = {}): Record<string, unknown> {
  const uuid = overrides.uuid ?? 'c48c6597-8034-4a10-9885-eb5a0863a61d';
  return {
    url: `${BASE_URL}objects/${uuid}`,
    uuid,
    type: 'https://example.org/objecttypes/nijmegenverzoek',
    record: {
      index: 1,
      typeVersion: 1,
      data: overrides.data ?? {},
      startAt: '2026-08-20',
      endAt: null,
      registrationAt: overrides.registrationAt ?? '2026-08-20',
    },
  };
}

export function page(results: unknown[], next: string | null = null, count = results.length): Record<string, unknown> {
  return { count, next, previous: null, results };
}
