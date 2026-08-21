import * as fs from 'fs';
import * as path from 'path';
import { buildSportSubmissions } from '../buildSportSubmissions';

const samplesDir = path.join(__dirname, '../test/samples');
const BOTH_TYPES = ['kind', 'volwassene'] as const;

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(samplesDir, fileName), 'utf-8');
}

describe('buildSportSubmissions', () => {
  it('keeps only submissions in an allowed district, e.g. only Dukenburg for a scoped medewerker', () => {
    const documents = [
      { reference: 'ref-dukenburg', csvText: readFixture('sport-submission-child-dukenburg.csv') },
      { reference: 'ref-centrum', csvText: readFixture('sport-submission-child-centrum.csv') },
    ];

    const result = buildSportSubmissions(documents, ['dukenburg'], [...BOTH_TYPES]);

    expect(result.submissions).toHaveLength(1);
    expect(result.submissions[0].reference).toBe('ref-dukenburg');
    expect(result.failedCount).toBe(0);
  });

  it('keeps only submissions matching the aanmeldType filter, e.g. only volwassene', () => {
    const documents = [
      { reference: 'ref-child', csvText: readFixture('sport-submission-child-dukenburg.csv') },
      { reference: 'ref-adult', csvText: readFixture('sport-submission-adult-dukenburg-music.csv') },
    ];

    const result = buildSportSubmissions(documents, ['dukenburg'], ['volwassene']);

    expect(result.submissions).toHaveLength(1);
    expect(result.submissions[0].reference).toBe('ref-adult');
  });

  it('keeps nothing when the type filter is empty, without falling back to showing everything', () => {
    const documents = [
      { reference: 'ref-child', csvText: readFixture('sport-submission-child-dukenburg.csv') },
    ];

    const result = buildSportSubmissions(documents, ['dukenburg'], []);

    expect(result.submissions).toEqual([]);
  });

  it('sorts newest first on the actual Inzendingdatum', () => {
    const documents = [
      { reference: 'ref-centrum', csvText: readFixture('sport-submission-child-centrum.csv') }, // 23:08:00
      { reference: 'ref-dukenburg-adult', csvText: readFixture('sport-submission-adult-dukenburg-music.csv') }, // 23:05:37
    ];

    const result = buildSportSubmissions(documents, ['nijmegenCentrum', 'dukenburg'], [...BOTH_TYPES]);

    expect(result.submissions.map((submission) => submission.reference)).toEqual(['ref-centrum', 'ref-dukenburg-adult']);
  });

  it('skips a document with unparsable CSV text and counts it as failed', () => {
    const documents = [
      { reference: 'ref-broken', csvText: 'not,a,valid\nsport,csv' },
      { reference: 'ref-dukenburg', csvText: readFixture('sport-submission-child-dukenburg.csv') },
    ];

    const result = buildSportSubmissions(documents, ['dukenburg'], [...BOTH_TYPES]);

    expect(result.submissions).toHaveLength(1);
    expect(result.failedCount).toBe(1);
  });
});
