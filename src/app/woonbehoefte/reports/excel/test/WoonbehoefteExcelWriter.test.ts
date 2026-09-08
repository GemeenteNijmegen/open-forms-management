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

  it('puts Bronwaarschuwing as the last column', () => {
    const [header] = buildWoonbehoefteReportSheetData([baseRow()]);
    expect((header[header.length - 1] as CellObject).value).toBe('Bronwaarschuwing');
  });
});

describe('writeWoonbehoefteReportExcel', () => {
  it('produces a non-empty, valid XLSX (ZIP) buffer', async () => {
    const buffer = await writeWoonbehoefteReportExcel([baseRow()]);

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});
