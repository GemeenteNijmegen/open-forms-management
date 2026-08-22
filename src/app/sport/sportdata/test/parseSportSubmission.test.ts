import * as fs from 'fs';
import * as path from 'path';
import { parseSportSubmission } from '../parseSportSubmission';

const samplesDir = path.join(__dirname, 'samples');
const fixtureFiles = fs.readdirSync(samplesDir).filter((file) => file.endsWith('.csv'));

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(samplesDir, fileName), 'utf-8');
}

describe('parseSportSubmission', () => {
  it('parses every fixture in the samples directory', () => {
    for (const file of fixtureFiles) {
      const submission = parseSportSubmission(readFixture(file), `urn:test:${file}`);
      expect(submission.district).toBeTruthy();
      expect(Number.isNaN(submission.submittedAt.getTime())).toBe(false);
    }
  });

  it('recognizes all seven district values across the fixtures', () => {
    const districts = fixtureFiles.map((file) => parseSportSubmission(readFixture(file), file).district);

    expect(new Set(districts)).toEqual(new Set([
      'nijmegenCentrum', 'nijmegenOost', 'nijmegenMiddenZuid', 'nijmegenOudNieuwWest', 'dukenburg', 'lindenholt', 'nijmegenNoord',
    ]));
  });

  it('maps the adult Dukenburg activity selection to its readable label', () => {
    const submission = parseSportSubmission(readFixture('sport-submission-adult-dukenburg-music.csv'), 'urn:test:adult');

    expect(submission.aanmeldType).toBe('volwassene');
    expect(submission.activities).toContain('bewegen op muziek voor dames/vrouwen (wijkcentrum Dukenburg)');
    expect(submission.child).toBeUndefined();
  });

  it('parses the submission timestamp as UTC, at millisecond precision, from a microsecond source', () => {
    const submission = parseSportSubmission(readFixture('sport-submission-adult-dukenburg-music.csv'), 'urn:test:adult');

    expect(submission.submittedAt.toISOString()).toBe('2026-08-20T23:05:37.283Z');
  });

  it('maps a child submission with no applicable activity to "Niet van toepassing", with distinct child fields', () => {
    const submission = parseSportSubmission(readFixture('sport-submission-child-dukenburg.csv'), 'urn:test:child');

    expect(submission.aanmeldType).toBe('kind');
    expect(submission.activities).toEqual(['Niet van toepassing']);
    expect(submission.contactName).toBe('Testouder Dukenburg');
    expect(submission.child).toEqual({
      name: 'Testkind Dukenburg',
      birthDate: '2010-01-01',
      school: 'Testschool Dukenburg',
    });
  });
});
