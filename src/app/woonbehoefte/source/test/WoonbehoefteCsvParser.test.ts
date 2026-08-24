import * as fs from 'fs';
import * as path from 'path';
import { parseWoonbehoefteCsv } from '../WoonbehoefteCsvParser';

const samplesDir = path.join(__dirname, 'samples');

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(samplesDir, fileName), 'utf-8');
}

describe('parseWoonbehoefteCsv', () => {
  it('normalizes the category-1 fixture: single readiness category, collective housing plus project developer', () => {
    const parsed = parseWoonbehoefteCsv(readFixture('woonbehoefte-submission-category-1.csv'), 'OF-TEST-1');

    expect(parsed.projectName).toBe('Voorbeeldproject');
    expect(parsed.contactEmail).toBe('aanvrager@example.nl');
    expect(parsed.totalHomes).toBe(10);
    expect(parsed.hasExistingLianderRequest).toBe(false);
    expect(parsed.submittedProjectReadiness).toBe(1);
    expect(parsed.isCollectiveHousing).toBe(true);
    expect(parsed.collectiveHousingCategory).toBe('jeugdwet');
    expect(parsed.hasCollectiveFacilities).toBe(true);
    // Both isIndividueleWoningeigenaar and dientProjectInNamensOverheid are explicitly 'nee': a real PROJECT_APPLICANT, not UNKNOWN.
    expect(parsed.applicantType).toBe('PROJECT_APPLICANT');
  });

  it('normalizes the minimal fixture: individual homeowner, no readiness category selected', () => {
    const parsed = parseWoonbehoefteCsv(readFixture('woonbehoefte-submission-minimal.csv'), 'OF-TEST-2');

    expect(parsed.applicantType).toBe('INDIVIDUAL');
    expect(parsed.hasCollectiveFacilities).toBe(false);
    // No heeftProjectrijpheidN field was 'ja': never guessed, stays unset.
    expect(parsed.submittedProjectReadiness).toBeUndefined();
  });

  it('parses the registration timestamp as UTC, at millisecond precision, from a microsecond source', () => {
    const parsed = parseWoonbehoefteCsv(readFixture('woonbehoefte-submission-category-1.csv'), 'OF-TEST-1');

    expect(parsed.registrationAt).toBe('2026-08-24T15:42:27.095Z');
  });

  it('rejects a CSV with more than one submission row', () => {
    const single = readFixture('woonbehoefte-submission-minimal.csv');
    const lines = single.trimEnd().split('\n');
    const duplicated = [...lines, lines[1]].join('\n');

    expect(() => parseWoonbehoefteCsv(duplicated, 'OF-TEST-3')).toThrow('exactly one submission row');
  });

  it('never guesses when more than one heeftProjectrijpheidN is ja: readiness stays unset', () => {
    const columns = [
      'Inzendingdatum', 'projectNaam', 'korteBeschrijvingVanHetProjectProgrammaEnFasering', 'naamContactpersoon',
      'telefoonnummerContactpersoon', 'emailadresContactpersoon', 'heeftLopendeAanvraagLiander', 'eanCodeOfAanmeldnummer',
      'totaalAantalWoningen', 'geplandeStartdatumBouw', 'toelichtingStartBouw', 'geplandeDatumOpleveringBouw',
      'isIndividueleWoningeigenaar', 'dientProjectInNamensOverheid', 'isCollectieveWoonvorm', 'categorieCollectieveWoonvorm',
      'heeftCollectieveVoorzieningen', 'heeftKova',
      'heeftProjectrijpheid1', 'heeftProjectrijpheid2', 'heeftProjectrijpheid3', 'heeftProjectrijpheid4', 'heeftProjectrijpheid5', 'heeftProjectrijpheid6',
    ];
    const values = [
      '2026-08-24 10:00:00.000000', 'Testproject', '', 'Test Contact', '0600000000', 'test@example.nl', 'nee', '',
      '5', '2028-01-01', '', '2028-06-01',
      'nee', 'nee', 'nee', '',
      'nee', 'nee',
      // Two categories selected at once: a genuine source conflict, never resolved by guessing.
      'ja', 'ja', 'nee', 'nee', 'nee', 'nee',
    ];
    const conflictingCsv = `${columns.join(',')}\n${values.join(',')}\n`;

    const parsed = parseWoonbehoefteCsv(conflictingCsv, 'OF-TEST-4');
    expect(parsed.submittedProjectReadiness).toBeUndefined();
  });

  it('never silently derives PROJECT_APPLICANT from missing applicant-type source data: it stays UNKNOWN', () => {
    const columns = [
      'Inzendingdatum', 'projectNaam', 'korteBeschrijvingVanHetProjectProgrammaEnFasering', 'naamContactpersoon',
      'telefoonnummerContactpersoon', 'emailadresContactpersoon', 'heeftLopendeAanvraagLiander', 'eanCodeOfAanmeldnummer',
      'totaalAantalWoningen', 'geplandeStartdatumBouw', 'toelichtingStartBouw', 'geplandeDatumOpleveringBouw',
      'isIndividueleWoningeigenaar', 'dientProjectInNamensOverheid', 'isCollectieveWoonvorm', 'categorieCollectieveWoonvorm',
      'heeftCollectieveVoorzieningen', 'heeftKova',
      'heeftProjectrijpheid1', 'heeftProjectrijpheid2', 'heeftProjectrijpheid3', 'heeftProjectrijpheid4', 'heeftProjectrijpheid5', 'heeftProjectrijpheid6',
    ];
    const values = [
      '2026-08-24 10:00:00.000000', 'Testproject', '', 'Test Contact', '0600000000', 'test@example.nl', 'nee', '',
      '5', '2028-01-01', '', '2028-06-01',
      // Both applicant-type source columns empty/unknown, not explicitly 'nee': ambiguous, never guessed as PROJECT_APPLICANT.
      '', '', 'nee', '',
      'nee', 'nee',
      'nee', 'nee', 'nee', 'nee', 'nee', 'nee',
    ];
    const ambiguousCsv = `${columns.join(',')}\n${values.join(',')}\n`;

    const parsed = parseWoonbehoefteCsv(ambiguousCsv, 'OF-TEST-5');
    expect(parsed.applicantType).toBe('UNKNOWN');
  });
});
