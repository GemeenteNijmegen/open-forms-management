import * as fs from 'fs';
import * as path from 'path';
import { CellObject } from 'write-excel-file/node';
import { parseSportReportRow } from '../../reportbuilder/parseSportReportRow';
import { SportReportRow } from '../../reportbuilder/SportReportRow';
import { buildSportReportSheetData, writeSportReportExcel } from '../SportExcelWriter';

const samplesDir = path.join(__dirname, '../../../sportdata/test/samples');

function parseFixture(fileName: string, reference: string): SportReportRow {
  return parseSportReportRow(fs.readFileSync(path.join(samplesDir, fileName), 'utf-8'), reference);
}

function baseRow(overrides: Partial<SportReportRow> = {}): SportReportRow {
  return {
    reference: 'urn:test:base',
    formName: 'Aanmelden sportactiviteit',
    submittedAt: new Date('2026-01-15T10:00:00Z'),
    aanmeldType: 'volwassene',
    district: 'dukenburg',
    childFirstName: '',
    childLastName: '',
    childBirthDate: '',
    educationType: '',
    primarySchool: '',
    schoolGroup: '',
    secondarySchool: '',
    contactFirstName: 'Voornaam',
    contactLastName: 'Achternaam',
    contactBirthDate: '',
    phone: '0241234567',
    email: 'test@example.invalid',
    secondContactFirstName: '',
    secondContactLastName: '',
    secondContactPhone: '',
    secondContactEmail: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    childInSportsClub: '',
    otherActivity: '',
    outreachWorkerName: '',
    outreachWorkerOrganization: '',
    consentContact: '',
    consentDataUse: '',
    consentPhotos: '',
    remark: '',
    activities: [],
    ...overrides,
  };
}

describe('buildSportReportSheetData', () => {
  it('keeps a phone number as literal text with its leading zero, never as a number', () => {
    const [header, dataRow] = buildSportReportSheetData([baseRow({ phone: '0241234567' })]);
    const phoneIndex = header.findIndex((cell) => (cell as CellObject).value === 'Telefoonnummer');

    expect(dataRow[phoneIndex]).toEqual({ value: '0241234567', type: String, format: '@' });
  });

  it('never turns a formula-like string into a Formula cell', () => {
    const [header, dataRow] = buildSportReportSheetData([baseRow({ remark: '=1+1', contactFirstName: '@dangerous' })]);

    for (const cell of dataRow) {
      expect((cell as CellObject).type).not.toBe('Formula');
    }
    const remarkIndex = header.findIndex((cell) => (cell as CellObject).value === 'Opmerking');
    expect(dataRow[remarkIndex]).toEqual({ value: '=1+1', type: String, format: '@', wrap: true });
  });

  it('shows the district label, not the raw CSV key, in the Wijk column', () => {
    const [header, dataRow] = buildSportReportSheetData([baseRow({ district: 'dukenburg' })]);

    const wijkIndex = header.findIndex((cell) => (cell as CellObject).value === 'Wijk');
    expect((dataRow[wijkIndex] as CellObject).value).toBe('Dukenburg');
  });

  it('adds one deterministic, alphabetically sorted column per unique activity, with TRUE only where selected', () => {
    const rows = [
      baseRow({ reference: 'a', activities: ['Zwemmen', 'Dans'] }),
      baseRow({ reference: 'b', activities: ['Voetbal'] }),
    ];

    const [header, rowA, rowB] = buildSportReportSheetData(rows);
    const headerLabels = header.slice(-3).map((cell) => (cell as CellObject).value);
    expect(headerLabels).toEqual(['Dans', 'Voetbal', 'Zwemmen']);

    expect(rowA.slice(-3).map((cell) => (cell as CellObject).value)).toEqual([true, '', true]);
    expect(rowB.slice(-3).map((cell) => (cell as CellObject).value)).toEqual(['', true, '']);
  });

  it('joins the selected activities into the summary column in their given order', () => {
    const [header, dataRow] = buildSportReportSheetData([baseRow({ activities: ['Zwemmen', 'Dans'] })]);

    const summaryIndex = header.findIndex((cell) => (cell as CellObject).value === 'Activiteiten');
    expect((dataRow[summaryIndex] as CellObject).value).toBe('Zwemmen; Dans');
  });

  it('maps real fixtures end to end without throwing, including the activity label from the adult fixture', () => {
    const adult = parseFixture('sport-submission-adult-dukenburg-music.csv', 'urn:test:adult');
    const child = parseFixture('sport-submission-child-dukenburg.csv', 'urn:test:child');

    const [header] = buildSportReportSheetData([adult, child]);
    const headerValues = header.map((cell) => (cell as CellObject).value);

    expect(headerValues).toContain('bewegen op muziek voor dames/vrouwen (wijkcentrum Dukenburg)');
    expect(headerValues).toContain('Niet van toepassing');
  });
});

describe('writeSportReportExcel', () => {
  it('produces a non-empty, valid XLSX (ZIP) buffer', async () => {
    const buffer = await writeSportReportExcel([baseRow()]);

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});
