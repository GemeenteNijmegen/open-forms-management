import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { parseRepeatingGroupRows } from '../RepeatingGroupValueParser';

/**
 * Deze twee tests lezen de notatie rechtstreeks uit twee van de bestaande echte samples (zie
 * ProjectDetailsRealDataSamples.test.ts), in plaats van zelfgetypte teststrings: dat dekt de notatie die
 * daadwerkelijk voorkomt (None, geneste objecten, en de dubbele aanhalingstekens die Open Forms gebruikt
 * zodra een tekst zelf een enkel aanhalingsteken bevat) zonder een aparte fixture-opzet.
 */
function repeatingGroupColumn(sampleFile: string, columnName: string): string {
  const csvText = readFileSync(join(__dirname, '../../../test/samples', sampleFile), 'utf-8');
  const [row]: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true });
  return row[columnName];
}

describe('parseRepeatingGroupRows', () => {
  it('parses a woonhuis row with a null (None) value and numeric fields', () => {
    const rows = parseRepeatingGroupRows(repeatingGroupColumn('woonbehoefte-project-details-woonhuis.csv', 'woningenEnAansluitingen'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ typeWoonobject: 'woonhuis', aantalAansluitingen: 1, gewenstGtvAfnameKw: null });
  });

  it('parses two structurally identical KOVA rows whose free text switches to double quotes around an apostrophe', () => {
    const rows = parseRepeatingGroupRows(repeatingGroupColumn('woonbehoefte-project-details-kova-duplicaten.csv', 'kovaAansluitingen'));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(rows[1]);
    expect(rows[0].optioneleBeschrijvingKovaFunctie).toContain("Maatschappelijke 'plint'");
  });
});
