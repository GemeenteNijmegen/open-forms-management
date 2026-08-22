import { EmployeeIdentity } from '../../../auth/EmployeeIdentity';
import { OpenZaakClientConfiguration } from '../OpenZaakConfiguration';

export const BASE_URL = 'https://mijn-services.accp.nijmegen.nl/open-zaak/documenten/api/v1/';
export const CONFIG: OpenZaakClientConfiguration = { baseUrl: BASE_URL, clientId: 'test-client', clientSecret: 'test-secret' };

export const ACTOR: EmployeeIdentity = { principalId: 'employee-123', email: 'medewerker@nijmegen.nl' };

export const DOCUMENT_UUID = '2674b81f-4386-4f05-a986-418bf54f2091';
export const DOCUMENT_REFERENCE = `${BASE_URL}enkelvoudiginformatieobjecten/${DOCUMENT_UUID}`;

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? null },
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  } as unknown as Response;
}

export function binaryResponse(status: number, bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? null },
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

export function metadataBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: DOCUMENT_REFERENCE,
    identificatie: 'DOC-2026-0001',
    titel: 'Aanmelding sportactiviteit.csv',
    formaat: 'text/csv',
    bestandsnaam: 'aanmelding.csv',
    bestandsomvang: 1234,
    versie: 1,
    beginRegistratie: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}
