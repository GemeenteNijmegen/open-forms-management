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

function buildObject(reference: string, csv: string): ObjectResource {
  return { record: { data: { reference, csv } } } as ObjectResource;
}

describe('SportRequestHandler', () => {
  it('denies a medewerker without any Sport grant', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const objectsClient = { collectObjects: jest.fn() } as unknown as ObjectsClient;
    const openZaakClient = { getDocumentText: jest.fn() } as unknown as OpenZaakClient;
    const handler = new SportRequestHandler(service, objectsClient, openZaakClient);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    expect(response.statusCode).toBe(403);
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
    expect(body).toContain('Dukenburg');
    expect(body).toContain('Kind: Testkind Dukenburg');
    expect(body).toContain('Testvolwassene Dukenburg');
    // Kenmerk holds reference, district and aanmeldType stacked as three lines in one cell.
    expect(body).toContain('ref-child<br>Dukenburg<br>Kind');
    expect(body).toContain('ref-adult<br>Dukenburg<br>Volwassene');
    // Mustache HTML-escapes "/" to "&#x2F;" by default, so check either side instead of the literal slash.
    expect(body).toContain('bewegen op muziek voor dames');
    expect(body).toContain('vrouwen (wijkcentrum Dukenburg)');
    expect(body).not.toMatch(/Excel|PDF/);

    // The adult submission (23:05:37) was submitted after the child submission (23:05:15), so it sorts first.
    expect(body.indexOf('Testvolwassene Dukenburg')).toBeLessThan(body.indexOf('Testkind Dukenburg'));
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
      buildObject('ref-broken', 'https://open-zaak.test/csv/broken'),
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
