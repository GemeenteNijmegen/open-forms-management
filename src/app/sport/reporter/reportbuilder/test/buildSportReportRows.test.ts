import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../../../observability/Logger';
import { FetchedSportCsvDocument } from '../../../fetchSportCsvDocuments';
import { buildSportReportRows } from '../buildSportReportRows';

const samplesDir = path.join(__dirname, '../../../test/samples');

function fixtureDocument(fileName: string, reference: string): FetchedSportCsvDocument {
  return {
    reference,
    csvText: fs.readFileSync(path.join(samplesDir, fileName), 'utf-8'),
    hasPdf: false,
  };
}

describe('buildSportReportRows', () => {
  it('keeps only rows in the requested districts, across multiple documents', () => {
    const documents = [
      fixtureDocument('sport-submission-child-dukenburg.csv', 'urn:test:dukenburg'),
      fixtureDocument('sport-submission-child-centrum.csv', 'urn:test:centrum'),
      fixtureDocument('sport-submission-child-lindenholt.csv', 'urn:test:lindenholt'),
    ];

    const rows = buildSportReportRows(documents, ['dukenburg', 'lindenholt']);

    expect(rows.map((row) => row.reference)).toEqual(['urn:test:dukenburg', 'urn:test:lindenholt']);
  });

  it('throws instead of silently dropping a row when a CSV document fails to parse, after logging which one', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation();
    const documents = [fixtureDocument('sport-submission-child-dukenburg.csv', 'urn:test:dukenburg')];
    documents[0].csvText = 'not,a,valid,sport,csv\n1,2,3,4,5';
    documents[0].objectUuid = 'object-uuid-1';

    expect(() => buildSportReportRows(documents, ['dukenburg'])).toThrow();
    expect(warn).toHaveBeenCalledWith('Sport report row build failed', expect.objectContaining({
      reference: 'urn:test:dukenburg',
      objectUuid: 'object-uuid-1',
    }));

    warn.mockRestore();
  });
});
