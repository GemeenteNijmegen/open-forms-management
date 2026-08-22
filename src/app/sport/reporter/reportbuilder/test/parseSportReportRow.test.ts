import * as fs from 'fs';
import * as path from 'path';
import { parseSportReportRow } from '../parseSportReportRow';

const samplesDir = path.join(__dirname, '../../../test/samples');

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(samplesDir, fileName), 'utf-8');
}

describe('parseSportReportRow', () => {
  it('maps the reporter-only business fields the Sportpagina does not expose, for the adult fixture', () => {
    const row = parseSportReportRow(readFixture('sport-submission-adult-dukenburg-music.csv'), 'urn:test:adult');

    expect(row.formName).toBe('Aanmelden sportactiviteit');
    expect(row.district).toBe('dukenburg');
    expect(row.contactBirthDate).toBe('1985-01-01');
    expect(row.emergencyContactName).toBe('Testcontact Dukenburg');
    expect(row.emergencyContactPhone).toBe('0247654321');
    expect(row.consentContact).toBe('ja');
    expect(row.consentDataUse).toBe('ja');
    expect(row.consentPhotos).toBe('nee');
    expect(row.activities).toContain('bewegen op muziek voor dames/vrouwen (wijkcentrum Dukenburg)');
  });

  it('maps the child-specific fields for a child fixture, leaving adult-only fields empty', () => {
    const row = parseSportReportRow(readFixture('sport-submission-child-dukenburg.csv'), 'urn:test:child');

    expect(row.aanmeldType).toBe('kind');
    expect(row.childFirstName).toBeTruthy();
    expect(row.childBirthDate).toBe('2010-01-01');
    expect(row.educationType).toBe('voortgezetOnderwijs');
    expect(row.secondarySchool).toBe('Testschool Dukenburg');
    expect(row.primarySchool).toBe('');
  });
});
