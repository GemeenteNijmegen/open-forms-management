import * as fs from 'fs';
import * as path from 'path';
import { FakeAuditTrail } from '../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../shared/authorization/tests/FakePermissionRepository';
import { ObjectsClient } from '../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { SportRequestHandler } from '../SportRequestHandler';

const samplesDir = path.join(__dirname, '../test/samples');

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(samplesDir, fileName), 'utf-8');
}

function buildObject(reference: string, csv: string, uuid?: string): ObjectResource {
  return { uuid, record: { data: { reference, csv } } } as ObjectResource;
}

describe('SportRequestHandler', () => {
  it('denies a medewerker without any Sport grant', async () => {
    const auditTrail = new FakeAuditTrail();
    const service = new AuthorizationService(new FakePermissionRepository(), auditTrail);
    const objectsClient = { collectObjects: jest.fn() } as unknown as ObjectsClient;
    const openZaakClient = { getDocumentText: jest.fn() } as unknown as OpenZaakClient;
    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    expect(response.statusCode).toBe(403);
    expect(auditTrail.events.map((event) => event.eventType)).not.toContain('ACCESS_GRANTED');
  });

  it('records an ACCESS_GRANTED audit event when a medewerker actually views the Sport page', async () => {
    const auditTrail = new FakeAuditTrail();
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, auditTrail);

    const objectsClient = { collectObjects: jest.fn().mockResolvedValue([]) } as unknown as ObjectsClient;
    const openZaakClient = { getDocumentText: jest.fn() } as unknown as OpenZaakClient;
    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    expect(response.statusCode).toBe(200);
    expect(auditTrail.events).toContainEqual(expect.objectContaining({
      eventType: 'ACCESS_GRANTED',
      outcome: 'SUCCESS',
      resource: 'sport',
      action: 'view',
      actorEmail: 'medewerker@nijmegen.nl',
    }));
  });

  it('renders mixed kind/volwassene submissions, newest first, for a scoped medewerker', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objects = [
      buildObject('ref-child', 'https://open-zaak.test/csv/child'),
      buildObject('ref-adult', 'https://open-zaak.test/csv/adult'),
    ];
    const objectsClient = { collectObjects: jest.fn().mockResolvedValue(objects) } as unknown as ObjectsClient;
    const getDocumentText = jest.fn()
      .mockResolvedValueOnce(readFixture('sport-submission-child-dukenburg.csv'))
      .mockResolvedValueOnce(readFixture('sport-submission-adult-dukenburg-music.csv'));
    const openZaakClient = { getDocumentText } as unknown as OpenZaakClient;

    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(body).toContain('sport-record__summary');
    expect(body).toContain('Dukenburg');
    expect(body).toContain('ref-child');
    expect(body).toContain('ref-adult');
    // Het kind, niet de ouder/verzorger, is de sporter die in de summary-grid staat.
    expect(body).toContain('Testkind Dukenburg');
    expect(body).toContain('Testvolwassene Dukenburg');
    expect(body).toContain('Geboren: 01-01-2010');
    expect(body).toContain('School: Testschool Dukenburg');
    // Mustache HTML-escapes "/" to "&#x2F;" by default, so check either side of every slash instead of the literal character.
    expect(body).toContain('Ouder&#x2F;verzorger: Testouder Dukenburg · 0241234567 · ouder-dukenburg@example.invalid');
    expect(body).toContain('Contact: 0241234567 · volwassene-dukenburg@example.invalid');
    expect(body).toContain('>Volwassene<');
    expect(body).toContain('bewegen op muziek voor dames');
    expect(body).toContain('vrouwen (wijkcentrum Dukenburg)');
    expect(body).not.toMatch(/Excel|PDF/);

    // The adult submission (23:05:37) was submitted after the child submission (23:05:15), so it sorts first.
    expect(body.indexOf('Testvolwassene Dukenburg')).toBeLessThan(body.indexOf('Testkind Dukenburg'));

    // A single-district grant shows the wrapping district summary, not the "alle wijken" sentence.
    expect(body).toContain('Je ziet aanmeldingen uit:');
    expect(body).not.toContain('Je ziet aanmeldingen uit alle wijken.');
  });

  it('shows the "alle wijken" summary for a global admin instead of listing every district', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('admin@nijmegen.nl', [{ resource: '*', actions: ['*'] }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objectsClient = { collectObjects: jest.fn().mockResolvedValue([]) } as unknown as ObjectsClient;
    const openZaakClient = { getDocumentText: jest.fn() } as unknown as OpenZaakClient;

    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);
    const response = await handler.handleRequest({ principalId: 'admin-1', email: 'admin@nijmegen.nl' });
    const body = response.body ?? '';

    expect(body).toContain('Je ziet aanmeldingen uit alle wijken.');
  });

  it('applies an explicit filter: only the requested district and type make it into the response', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objects = [
      buildObject('ref-child', 'https://open-zaak.test/csv/child'),
      buildObject('ref-adult', 'https://open-zaak.test/csv/adult'),
    ];
    const objectsClient = { collectObjects: jest.fn().mockResolvedValue(objects) } as unknown as ObjectsClient;
    const getDocumentText = jest.fn()
      .mockResolvedValueOnce(readFixture('sport-submission-child-dukenburg.csv'))
      .mockResolvedValueOnce(readFixture('sport-submission-adult-dukenburg-music.csv'));
    const openZaakClient = { getDocumentText } as unknown as OpenZaakClient;

    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);
    const response = await handler.handleRequest(
      { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' },
      { filterSubmitted: '1', district: 'dukenburg', type: 'kind' },
    );
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(body).toContain('Testkind Dukenburg');
    expect(body).not.toContain('Testvolwassene Dukenburg');
  });

  it('shows nothing, not the default, when the filter explicitly selects zero districts', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objects = [buildObject('ref-child', 'https://open-zaak.test/csv/child')];
    const objectsClient = { collectObjects: jest.fn().mockResolvedValue(objects) } as unknown as ObjectsClient;
    const getDocumentText = jest.fn().mockResolvedValueOnce(readFixture('sport-submission-child-dukenburg.csv'));
    const openZaakClient = { getDocumentText } as unknown as OpenZaakClient;

    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);
    const response = await handler.handleRequest(
      { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' },
      { filterSubmitted: '1', type: 'kind' }, // filterSubmitted but no district checked
    );
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(body).not.toContain('Testkind Dukenburg');
    expect(body).toContain('Er zijn geen Sportaanmeldingen');
  });

  it('ignores a district in the querystring the medewerker is not allowed to see', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objects = [buildObject('ref-child', 'https://open-zaak.test/csv/child')];
    const objectsClient = { collectObjects: jest.fn().mockResolvedValue(objects) } as unknown as ObjectsClient;
    const getDocumentText = jest.fn().mockResolvedValueOnce(readFixture('sport-submission-child-dukenburg.csv'));
    const openZaakClient = { getDocumentText } as unknown as OpenZaakClient;

    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);
    const response = await handler.handleRequest(
      { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' },
      { filterSubmitted: '1', district: 'nijmegenNoord', type: 'kind' }, // not an allowed district for this medewerker
    );
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(body).not.toContain('Testkind Dukenburg');
    expect(body).toContain('Er zijn geen Sportaanmeldingen');
  });

  it('shows a normal empty state, not an error page, when there are no submissions', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objectsClient = { collectObjects: jest.fn().mockResolvedValue([]) } as unknown as ObjectsClient;
    const openZaakClient = { getDocumentText: jest.fn() } as unknown as OpenZaakClient;

    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(body).toContain('Er zijn geen Sportaanmeldingen');
    expect(body).not.toContain('utrecht-alert--warning');
  });

  it('shows exactly one warning when a CSV fails, without hiding the submissions that did load', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objects = [
      buildObject('ref-ok', 'https://open-zaak.test/csv/ok'),
      buildObject('ref-broken', 'https://open-zaak.test/csv/broken', 'object-uuid-broken'),
    ];
    const objectsClient = { collectObjects: jest.fn().mockResolvedValue(objects) } as unknown as ObjectsClient;
    const getDocumentText = jest.fn()
      .mockResolvedValueOnce(readFixture('sport-submission-child-dukenburg.csv'))
      .mockRejectedValueOnce(new Error('download failed'));
    const openZaakClient = { getDocumentText } as unknown as OpenZaakClient;

    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(body).toContain('Testkind Dukenburg');
    expect(body.match(/utrecht-alert--warning/g)).toHaveLength(1);
    expect(body).toContain('1 overgeslagen');
    // OF-nummer én objectnummer moeten in de waarschuwing staan, zodat een medewerker het snel kan opzoeken.
    expect(body).toContain('ref-broken (document object-uuid-broken)');
  });

  it('returns a 500 without a stack trace in the response when the Objects query itself fails', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objectsClient = { collectObjects: jest.fn().mockRejectedValue(new Error('objects api down')) } as unknown as ObjectsClient;
    const openZaakClient = { getDocumentText: jest.fn() } as unknown as OpenZaakClient;

    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    expect(response.statusCode).toBe(500);
    expect(response.body ?? '').not.toContain('objects api down');
  });
});
