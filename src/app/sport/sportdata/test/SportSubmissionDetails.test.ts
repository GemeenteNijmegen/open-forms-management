import * as fs from 'fs';
import * as path from 'path';
import { buildSportSubmissionDetails } from '../SportSubmissionDetails';

const samplesDir = path.join(__dirname, 'samples');

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(samplesDir, fileName), 'utf-8');
}

describe('buildSportSubmissionDetails', () => {
  it('carries reporter-only business fields the compact SportSubmission does not expose', () => {
    const details = buildSportSubmissionDetails(readFixture('sport-submission-child-dukenburg.csv'));

    expect(details.aanmeldType).toBe('kind');
    expect(details.district).toBe('dukenburg');
    expect(details.childFirstName).toBe('Testkind');
    expect(details.childLastName).toBe('Dukenburg');
    expect(details.childBirthDate).toBe('2010-01-01');
    expect(details.educationType).toBe('voortgezetOnderwijs');
    expect(details.secondarySchool).toBe('Testschool Dukenburg');
    expect(details.contactFirstName).toBe('Testouder');
    expect(details.activities).toEqual(['Niet van toepassing']);
  });

  it('parses every fixture without throwing and with a valid submittedAt', () => {
    for (const file of fs.readdirSync(samplesDir).filter((entry) => entry.endsWith('.csv'))) {
      const details = buildSportSubmissionDetails(readFixture(file));
      expect(Number.isNaN(details.submittedAt.getTime())).toBe(false);
      expect(details.formName).toBe('Aanmelden sportactiviteit');
    }
  });
});
