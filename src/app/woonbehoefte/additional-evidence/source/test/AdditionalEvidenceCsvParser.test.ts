import * as fs from 'fs';
import * as path from 'path';
import { parseAdditionalEvidenceCsv } from '../AdditionalEvidenceCsvParser';

const samplesDir = path.join(__dirname, 'samples');

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(samplesDir, fileName), 'utf-8');
}

describe('parseAdditionalEvidenceCsv', () => {
  it('normalizes a normal submission', () => {
    const parsed = parseAdditionalEvidenceCsv(readFixture('additional-evidence-001.csv'), 'OF-EXTRA01');

    expect(parsed.originalCaseReference).toBe('OF-HOOFD01');
    expect(parsed.submittedProjectName).toBe('Project Lindenhof');
    expect(parsed.contactEmail).toBe('burger@example.test');
    expect(parsed.contactPhone).toBe('0612345678');
    expect(parsed.evidenceDescription).toBe('Aanvullende planning en ondertekende overeenkomst.');
    expect(parsed.remarks).toBe('Graag meenemen bij de beoordeling.');
  });

  it('parses the inzendingdatum as UTC, at millisecond precision, from a microsecond source', () => {
    const parsed = parseAdditionalEvidenceCsv(readFixture('additional-evidence-001.csv'), 'OF-EXTRA01');

    expect(parsed.submittedAt).toBe('2026-09-07T17:54:04.702Z');
  });

  it('leaves telefoon/opmerkingen/uploadmetadata unset when the CSV leaves them empty, without dropping the row', () => {
    const parsed = parseAdditionalEvidenceCsv(readFixture('additional-evidence-empty-optionals.csv'), 'OF-EXTRA04');

    expect(parsed.originalCaseReference).toBe('OF-HOOFD02');
    expect(parsed.contactPhone).toBeUndefined();
    expect(parsed.remarks).toBeUndefined();
  });

  it('rejects a row with an empty origineleKenmerk: nothing to search a hoofdzaak with', () => {
    expect(() => parseAdditionalEvidenceCsv(readFixture('additional-evidence-missing-original-reference.csv'), 'OF-EXTRA-MISSING'))
      .toThrow('Additional Evidence CSV row failed validation');
  });

  it('rejects a CSV with more than one submission row', () => {
    expect(() => parseAdditionalEvidenceCsv(readFixture('additional-evidence-two-rows.csv'), 'OF-EXTRA-TWO-ROWS'))
      .toThrow('exactly one submission row');
  });
});
