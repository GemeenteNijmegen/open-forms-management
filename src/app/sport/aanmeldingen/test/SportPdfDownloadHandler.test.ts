import * as fs from 'fs';
import * as path from 'path';
import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { ObjectsClient } from '../../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { SportPdfDownloadHandler } from '../SportPdfDownloadHandler';

const samplesDir = path.join(__dirname, '../../sportdata/test/samples');
const OBJECT_UUID = '11111111-1111-1111-1111-111111111111';
const DOCUMENT_UUID = '22222222-2222-2222-2222-222222222222';
const PDF_URL = `https://open-zaak.test/documenten/api/v1/enkelvoudiginformatieobjecten/${DOCUMENT_UUID}`;

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(samplesDir, fileName), 'utf-8');
}

function buildObject(data: Record<string, unknown>): ObjectResource {
  return { uuid: OBJECT_UUID, record: { data } } as ObjectResource;
}

function sportObjectData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formName: 'Aanmelden sportactiviteit',
    reference: 'OF-2026-000123',
    csv: 'https://open-zaak.test/csv/dukenburg',
    pdf: PDF_URL,
    ...overrides,
  };
}

describe('SportPdfDownloadHandler', () => {
  it('rejects an invalid objectUuid without calling Objects or Open Zaak', async () => {
    const objectsClient = { getObjectByUuid: jest.fn() } as unknown as ObjectsClient;
    const openZaakClient = { getDocumentText: jest.fn(), getDocumentContent: jest.fn() } as unknown as OpenZaakClient;
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const handler = new SportPdfDownloadHandler(service, objectsClient, openZaakClient, new FakeAuditTrail());

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, 'not-a-uuid');

    expect(response.statusCode).toBe(400);
    expect(objectsClient.getObjectByUuid).not.toHaveBeenCalled();
  });

  it('returns the exact PDF bytes and a success audit with objectUuid and documentUuid for an allowed district', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const auditTrail = new FakeAuditTrail();
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objectsClient = { getObjectByUuid: jest.fn().mockResolvedValue(buildObject(sportObjectData())) } as unknown as ObjectsClient;
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"
    const openZaakClient = {
      getDocumentText: jest.fn().mockResolvedValue(readFixture('sport-submission-child-dukenburg.csv')),
      getDocumentContent: jest.fn().mockResolvedValue({ body: pdfBytes }),
    } as unknown as OpenZaakClient;

    const handler = new SportPdfDownloadHandler(service, objectsClient, openZaakClient, auditTrail);
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, OBJECT_UUID);

    expect(response.statusCode).toBe(200);
    expect(response.isBase64Encoded).toBe(true);
    expect(Buffer.from(response.body ?? '', 'base64')).toEqual(Buffer.from(pdfBytes));
    expect(response.headers?.['Content-Type']).toBe('application/pdf');
    expect(response.headers?.['Content-Disposition']).toContain('attachment');
    expect(response.headers?.['Cache-Control']).toBe('private, no-store');

    expect(auditTrail.events).toContainEqual(expect.objectContaining({
      eventType: 'SPORT_PDF_DOWNLOADED',
      outcome: 'SUCCESS',
      resource: 'sport',
      actorEmail: 'medewerker@nijmegen.nl',
      metadata: { objectUuid: OBJECT_UUID, documentUuid: DOCUMENT_UUID },
    }));
  });

  it('denies a medewerker without the submission district and never fetches the PDF', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['nijmegenNoord'] } }]);
    const auditTrail = new FakeAuditTrail();
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objectsClient = { getObjectByUuid: jest.fn().mockResolvedValue(buildObject(sportObjectData())) } as unknown as ObjectsClient;
    const getDocumentContent = jest.fn();
    const openZaakClient = {
      getDocumentText: jest.fn().mockResolvedValue(readFixture('sport-submission-child-dukenburg.csv')),
      getDocumentContent,
    } as unknown as OpenZaakClient;

    const handler = new SportPdfDownloadHandler(service, objectsClient, openZaakClient, auditTrail);
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, OBJECT_UUID);

    expect(response.statusCode).toBe(403);
    expect(getDocumentContent).not.toHaveBeenCalled();
    expect(auditTrail.events.map((event) => event.eventType)).not.toContain('SPORT_PDF_DOWNLOADED');
  });

  it('returns 404 without fetching the CSV when the object is not a Sport object', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const objectsClient = {
      getObjectByUuid: jest.fn().mockResolvedValue(buildObject(sportObjectData({ formName: 'Iets anders' }))),
    } as unknown as ObjectsClient;
    const getDocumentText = jest.fn();
    const openZaakClient = { getDocumentText, getDocumentContent: jest.fn() } as unknown as OpenZaakClient;

    const handler = new SportPdfDownloadHandler(service, objectsClient, openZaakClient, new FakeAuditTrail());
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, OBJECT_UUID);

    expect(response.statusCode).toBe(404);
    expect(getDocumentText).not.toHaveBeenCalled();
  });

  it('returns 404 without a success audit when the authorized submission has no pdf reference', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const auditTrail = new FakeAuditTrail();
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objectsClient = {
      getObjectByUuid: jest.fn().mockResolvedValue(buildObject(sportObjectData({ pdf: undefined }))),
    } as unknown as ObjectsClient;
    const getDocumentContent = jest.fn();
    const openZaakClient = {
      getDocumentText: jest.fn().mockResolvedValue(readFixture('sport-submission-child-dukenburg.csv')),
      getDocumentContent,
    } as unknown as OpenZaakClient;

    const handler = new SportPdfDownloadHandler(service, objectsClient, openZaakClient, auditTrail);
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, OBJECT_UUID);

    expect(response.statusCode).toBe(404);
    expect(getDocumentContent).not.toHaveBeenCalled();
    expect(auditTrail.events).toHaveLength(0);
  });

  it('returns a generic error without leaking the Open Zaak URL when the PDF fetch fails after authorization', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const auditTrail = new FakeAuditTrail();
    const service = new AuthorizationService(repository, new FakeAuditTrail());

    const objectsClient = { getObjectByUuid: jest.fn().mockResolvedValue(buildObject(sportObjectData())) } as unknown as ObjectsClient;
    const openZaakClient = {
      getDocumentText: jest.fn().mockResolvedValue(readFixture('sport-submission-child-dukenburg.csv')),
      getDocumentContent: jest.fn().mockRejectedValue(new Error(`download failed for ${PDF_URL}`)),
    } as unknown as OpenZaakClient;

    const handler = new SportPdfDownloadHandler(service, objectsClient, openZaakClient, auditTrail);
    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, OBJECT_UUID);

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response)).not.toContain(PDF_URL);
    expect(auditTrail.events.map((event) => event.eventType)).not.toContain('SPORT_PDF_DOWNLOADED');
  });
});
