import { CellObject } from 'write-excel-file/node';
import { WoonbehoefteReportRow } from '../../reportbuilder/WoonbehoefteReportRow';
import { buildWoonbehoefteReportSheetData, writeWoonbehoefteReportExcel } from '../WoonbehoefteExcelWriter';

function baseRow(overrides: Partial<WoonbehoefteReportRow> = {}): WoonbehoefteReportRow {
  return {
    caseReference: 'OF-2026-00001',
    projectName: 'Project Een',
    statusLabel: 'In behandeling',
    assessedStartPeriodLabel: 'maart 2028',
    assessedStartYear: 2028,
    assessedStartMonth: 3,
    assessedCompletionPeriodLabel: 'Nog niet vastgesteld',
    assessedProjectReadinessLabel: 'Nog niet vastgesteld',
    assigneeLabel: 'medewerker@nijmegen.nl',
    claimedAtLabel: '20 augustus 2026 10:15',
    statusSinceLabel: '20 augustus 2026 10:15',
    applicationCompleteLabel: 'Ja',
    boardDeclarationApprovedLabel: 'Nog niet beoordeeld',
    chamberOfCommerceApprovedLabel: 'Nog niet beoordeeld',
    planningAgreementEvidenceApprovedLabel: 'Nog niet beoordeeld',
    planningPublicDecisionEvidenceApprovedLabel: 'Nog niet beoordeeld',
    projectReadinessEvidenceApprovedLabel: 'Nog niet beoordeeld',
    assessedStartExplanation: '',
    assessedCompletionExplanation: '',
    checkRequestedLabel: 'Nee',
    checkRequestedAtLabel: '',
    checkRequestedByLabel: '',
    lastCheckedAtLabel: '',
    lastCheckedByLabel: '',
    lastCheckOutcomeLabel: '',
    lotteryLabel: '',
    receivedAtLabel: '18 augustus 2026 09:00',
    formNameLabel: 'Aanmelden stroomaansluiting woningbouw',
    projectDescription: 'Nieuwbouwproject van 40 woningen.',
    contactName: 'Contactpersoon',
    contactPhone: '0612345678',
    contactEmail: 'contact@example.invalid',
    existingLianderRequestLabel: 'Nee',
    eanOrApplicationNumber: '',
    submittedStartDate: '2028-03-01',
    startDateExplanation: '',
    submittedCompletionDate: '',
    submittedProjectReadinessLabel: '',
    applicantTypeLabel: 'Individueel',
    collectiveHousingLabel: 'Nee',
    collectiveHousingCategory: '',
    collectiveFacilitiesLabel: 'Nee',
    kovaLabel: 'Nee',
    attachmentFilenamesText: '',
    sourceWarning: '',
    ...overrides,
  };
}

function cellFor(header: readonly unknown[], dataRow: readonly unknown[], columnHeader: string): CellObject {
  const index = header.findIndex((cell) => (cell as CellObject).value === columnHeader);
  expect(index).toBeGreaterThanOrEqual(0);
  return dataRow[index] as CellObject;
}

describe('buildWoonbehoefteReportSheetData', () => {
  it('never turns a formula-like string into a Formula cell, across every text column', () => {
    const [header, dataRow] = buildWoonbehoefteReportSheetData([baseRow({
      projectName: '=1+1', contactName: '+DANGEROUS', contactEmail: '-evil@example.invalid', sourceWarning: '@warning',
    })]);

    for (const cell of dataRow) {
      expect((cell as CellObject).type).not.toBe('Formula');
    }
    expect(cellFor(header, dataRow, 'Projectnaam')).toEqual({ value: '=1+1', type: String, format: '@' });
  });

  it('keeps assessedStartYear/Month as numbers, never as text', () => {
    const [header, dataRow] = buildWoonbehoefteReportSheetData([baseRow({ assessedStartYear: 2028, assessedStartMonth: 3 })]);

    expect(cellFor(header, dataRow, 'Vastgesteld startjaar')).toEqual({ value: 2028, type: Number });
    expect(cellFor(header, dataRow, 'Vastgestelde startmaand')).toEqual({ value: 3, type: Number });
  });

  it('leaves an undefined numeric field as a blank text cell, not a zero', () => {
    const [header, dataRow] = buildWoonbehoefteReportSheetData([baseRow({ ranking: undefined })]);

    expect(cellFor(header, dataRow, 'Ranking')).toEqual({ value: '', type: String });
  });

  it('keeps vastgestelde and ingediende projectrijpheid as clearly separate columns', () => {
    const [header, dataRow] = buildWoonbehoefteReportSheetData([baseRow({
      assessedProjectReadinessLabel: 'Categorie 1 - civielrechtelijke overeenkomst en omgevingsvergunning',
      submittedProjectReadinessLabel: 'Categorie 5 - civielrechtelijke overeenkomst',
    })]);

    expect(cellFor(header, dataRow, 'Vastgestelde projectrijpheid').value).toContain('Categorie 1');
    expect(cellFor(header, dataRow, 'Projectrijpheid volgens aanvraag').value).toContain('Categorie 5');
  });

  it('puts Bronwaarschuwing as the last column, even with dynamic form field columns present', () => {
    const rawFormFields = { headers: ['projectNaam'], values: { projectNaam: 'Project Een' } };
    const [header] = buildWoonbehoefteReportSheetData([baseRow({ rawFormFields })]);
    expect((header[header.length - 1] as CellObject).value).toBe('Bronwaarschuwing');
  });

  it('puts Bijlagen right before Bronwaarschuwing, even with dynamic form field columns present', () => {
    const rawFormFields = { headers: ['projectNaam'], values: { projectNaam: 'Project Een' } };
    const [header] = buildWoonbehoefteReportSheetData([baseRow({ rawFormFields })]);
    expect((header[header.length - 2] as CellObject).value).toBe('Bijlagen');
  });

  it('writes attachmentFilenamesText into the Bijlagen column, one filename per line', () => {
    const [header, dataRow] = buildWoonbehoefteReportSheetData([baseRow({ attachmentFilenamesText: 'bijlage-een.pdf\nbijlage-twee.pdf' })]);
    expect(cellFor(header, dataRow, 'Bijlagen')).toEqual({ value: 'bijlage-een.pdf\nbijlage-twee.pdf', type: String, format: '@', wrap: true });
  });

  it('never turns an attachment filename into a Formula cell either', () => {
    const [header, dataRow] = buildWoonbehoefteReportSheetData([baseRow({ attachmentFilenamesText: '=DIT-MAG-GEEN-FORMULE-WORDEN.pdf' })]);
    expect((cellFor(header, dataRow, 'Bijlagen') as CellObject).type).not.toBe('Formula');
  });

  it('adds a "Formulier - " prefixed column per raw CSV header, first-seen order across rows', () => {
    const rows = [
      baseRow({ rawFormFields: { headers: ['projectNaam', 'eanCodeOfAanmeldnummer'], values: { projectNaam: 'A', eanCodeOfAanmeldnummer: '1' } } }),
      baseRow({ rawFormFields: { headers: ['eanCodeOfAanmeldnummer', 'nieuwVeld'], values: { eanCodeOfAanmeldnummer: '2', nieuwVeld: 'Nieuw' } } }),
    ];

    const [header] = buildWoonbehoefteReportSheetData(rows);
    const headerValues = header.map((cell) => (cell as CellObject).value);

    expect(headerValues).toEqual(expect.arrayContaining(['Formulier - projectNaam', 'Formulier - eanCodeOfAanmeldnummer', 'Formulier - nieuwVeld']));
    const projectNaamIndex = headerValues.indexOf('Formulier - projectNaam');
    const eanIndex = headerValues.indexOf('Formulier - eanCodeOfAanmeldnummer');
    const nieuwVeldIndex = headerValues.indexOf('Formulier - nieuwVeld');
    expect(projectNaamIndex).toBeLessThan(eanIndex);
    expect(eanIndex).toBeLessThan(nieuwVeldIndex);
  });

  it('leaves a blank cell for a dynamic column when a row is missing that header', () => {
    const rows = [
      baseRow({ rawFormFields: { headers: ['projectNaam'], values: { projectNaam: 'A' } } }),
      baseRow({ rawFormFields: { headers: ['eanCodeOfAanmeldnummer'], values: { eanCodeOfAanmeldnummer: '2' } } }),
    ];

    const [header, rowA, rowB] = buildWoonbehoefteReportSheetData(rows);
    const projectNaamIndex = header.findIndex((cell) => (cell as CellObject).value === 'Formulier - projectNaam');

    expect((rowA[projectNaamIndex] as CellObject).value).toBe('A');
    expect((rowB[projectNaamIndex] as CellObject).value).toBe('');
  });

  it('adds no dynamic column at all when no row has raw form fields (option was off)', () => {
    const [header] = buildWoonbehoefteReportSheetData([baseRow(), baseRow()]);
    expect(header.some((cell) => String((cell as CellObject).value).startsWith('Formulier -'))).toBe(false);
  });

  it('never turns a raw form field value into a Formula cell either', () => {
    const rawFormFields = { headers: ['projectSpecifiekeToelichting'], values: { projectSpecifiekeToelichting: '=DIT-MAG-GEEN-FORMULE-WORDEN' } };
    const [header, dataRow] = buildWoonbehoefteReportSheetData([baseRow({ rawFormFields })]);

    const index = header.findIndex((cell) => (cell as CellObject).value === 'Formulier - projectSpecifiekeToelichting');
    expect((dataRow[index] as CellObject)).toEqual({ value: '=DIT-MAG-GEEN-FORMULE-WORDEN', type: String, format: '@', wrap: true });
  });
});

describe('writeWoonbehoefteReportExcel', () => {
  it('produces a non-empty, valid XLSX (ZIP) buffer', async () => {
    const buffer = await writeWoonbehoefteReportExcel([baseRow()]);

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});
