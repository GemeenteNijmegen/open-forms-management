import writeXlsxFile from 'write-excel-file/node';
import type { Cell, Row } from 'write-excel-file/node';
import { WoonbehoefteReportRow } from '../reportbuilder/WoonbehoefteReportRow';

const TEXT_FORMAT = '@';

interface ColumnDef {
  header: string;
  width: number;
  wrap?: boolean;
  cell: (row: WoonbehoefteReportRow) => Cell;
}

// Explicit type: String (never 'Formula') is what keeps a value starting with =, +, - or @ literal text.
function textCell(value: string, wrap = false): Cell {
  return { value, type: String, format: TEXT_FORMAT, ...(wrap ? { wrap: true } : {}) };
}

function numberCell(value: number | undefined): Cell {
  return value === undefined ? { value: '', type: String } : { value, type: Number };
}

const FIXED_COLUMNS: ColumnDef[] = [
  // A. Identiteit en actuele verwerking
  { header: 'OF-kenmerk', width: 20, cell: (row) => textCell(row.caseReference) },
  { header: 'Projectnaam', width: 26, cell: (row) => textCell(row.projectName) },
  { header: 'Status', width: 22, cell: (row) => textCell(row.statusLabel) },
  { header: 'Vastgestelde start jaar-maand', width: 18, cell: (row) => textCell(row.assessedStartPeriodLabel) },
  { header: 'Vastgesteld startjaar', width: 12, cell: (row) => numberCell(row.assessedStartYear) },
  { header: 'Vastgestelde startmaand', width: 12, cell: (row) => numberCell(row.assessedStartMonth) },
  { header: 'Vastgestelde oplever jaar-maand', width: 18, cell: (row) => textCell(row.assessedCompletionPeriodLabel) },
  { header: 'Vastgesteld opleverjaar', width: 12, cell: (row) => numberCell(row.assessedCompletionYear) },
  { header: 'Vastgestelde opleverjaarmaand', width: 12, cell: (row) => numberCell(row.assessedCompletionMonth) },
  { header: 'Vastgestelde projectrijpheid categorie', width: 14, cell: (row) => numberCell(row.assessedProjectReadinessCategory) },
  { header: 'Vastgestelde projectrijpheid', width: 40, wrap: true, cell: (row) => textCell(row.assessedProjectReadinessLabel, true) },
  { header: 'Behandelaar', width: 24, cell: (row) => textCell(row.assigneeLabel) },
  { header: 'Geclaimd op', width: 18, cell: (row) => textCell(row.claimedAtLabel) },
  { header: 'Status sinds', width: 18, cell: (row) => textCell(row.statusSinceLabel) },

  // B. Volledige gestructureerde assessment
  { header: 'Aanvraag compleet', width: 16, cell: (row) => textCell(row.applicationCompleteLabel) },
  { header: 'Bestuursverklaring akkoord', width: 16, cell: (row) => textCell(row.boardDeclarationApprovedLabel) },
  { header: 'KvK-uittreksel akkoord', width: 16, cell: (row) => textCell(row.chamberOfCommerceApprovedLabel) },
  { header: 'Bewijs anterieure overeenkomst akkoord', width: 16, cell: (row) => textCell(row.planningAgreementEvidenceApprovedLabel) },
  { header: 'Bewijs publiek besluit akkoord', width: 16, cell: (row) => textCell(row.planningPublicDecisionEvidenceApprovedLabel) },
  { header: 'Bewijs projectrijpheid akkoord', width: 16, cell: (row) => textCell(row.projectReadinessEvidenceApprovedLabel) },
  { header: 'Toelichting vastgestelde start', width: 30, wrap: true, cell: (row) => textCell(row.assessedStartExplanation, true) },
  { header: 'Toelichting vastgestelde oplevering', width: 30, wrap: true, cell: (row) => textCell(row.assessedCompletionExplanation, true) },

  // C. Check
  { header: 'Check gevraagd', width: 12, cell: (row) => textCell(row.checkRequestedLabel) },
  { header: 'Check gevraagd op', width: 18, cell: (row) => textCell(row.checkRequestedAtLabel) },
  { header: 'Check gevraagd door', width: 24, cell: (row) => textCell(row.checkRequestedByLabel) },
  { header: 'Laatst gecontroleerd op', width: 18, cell: (row) => textCell(row.lastCheckedAtLabel) },
  { header: 'Laatst gecontroleerd door', width: 24, cell: (row) => textCell(row.lastCheckedByLabel) },
  { header: 'Laatste checkuitkomst', width: 16, cell: (row) => textCell(row.lastCheckOutcomeLabel) },

  // D. Ranking
  { header: 'Ranking periode', width: 12, cell: (row) => numberCell(row.rankingPeriod) },
  { header: 'Ranking', width: 10, cell: (row) => numberCell(row.ranking) },
  { header: 'Ranking na loting', width: 12, cell: (row) => numberCell(row.rankingAfterLottery) },
  { header: 'Loting', width: 10, cell: (row) => textCell(row.lotteryLabel) },

  // E. Genormaliseerde aanvraagdata
  { header: 'Ontvangen op', width: 18, cell: (row) => textCell(row.receivedAtLabel) },
  { header: 'Formuliernaam', width: 26, cell: (row) => textCell(row.formNameLabel) },
  { header: 'Projectbeschrijving', width: 40, wrap: true, cell: (row) => textCell(row.projectDescription, true) },
  { header: 'Contactpersoon', width: 24, cell: (row) => textCell(row.contactName) },
  { header: 'Telefoonnummer contactpersoon', width: 18, cell: (row) => textCell(row.contactPhone) },
  { header: 'E-mailadres contactpersoon', width: 28, cell: (row) => textCell(row.contactEmail) },
  { header: 'Bestaande Liander-aanvraag', width: 14, cell: (row) => textCell(row.existingLianderRequestLabel) },
  { header: 'EAN-code of aanmeldnummer', width: 20, cell: (row) => textCell(row.eanOrApplicationNumber) },
  { header: 'Totaal aantal woningen', width: 14, cell: (row) => numberCell(row.totalHomes) },
  { header: 'Ingediende startdatum', width: 18, cell: (row) => textCell(row.submittedStartDate) },
  { header: 'Toelichting ingediende startdatum', width: 30, wrap: true, cell: (row) => textCell(row.startDateExplanation, true) },
  { header: 'Ingediende opleverdatum', width: 18, cell: (row) => textCell(row.submittedCompletionDate) },
  { header: 'Projectrijpheid volgens aanvraag categorie', width: 14, cell: (row) => numberCell(row.submittedProjectReadinessCategory) },
  { header: 'Projectrijpheid volgens aanvraag', width: 40, wrap: true, cell: (row) => textCell(row.submittedProjectReadinessLabel, true) },
  { header: 'Type aanvrager', width: 18, cell: (row) => textCell(row.applicantTypeLabel) },
  { header: 'Collectieve woonvorm', width: 14, cell: (row) => textCell(row.collectiveHousingLabel) },
  { header: 'Categorie collectieve woonvorm', width: 20, cell: (row) => textCell(row.collectiveHousingCategory) },
  { header: 'Collectieve voorzieningen', width: 14, cell: (row) => textCell(row.collectiveFacilitiesLabel) },
  { header: 'KOVA', width: 10, cell: (row) => textCell(row.kovaLabel) },

  // H. Laatste kolom (F/G volgen in latere epics, altijd vóór deze kolom)
  { header: 'Bronwaarschuwing', width: 40, wrap: true, cell: (row) => textCell(row.sourceWarning, true) },
];

function headerRow(): Row {
  return FIXED_COLUMNS.map((column): Cell => ({ value: column.header, type: String, fontWeight: 'bold' }));
}

function dataRow(row: WoonbehoefteReportRow): Row {
  return FIXED_COLUMNS.map((column) => column.cell(row));
}

/** The exact cell data writeWoonbehoefteReportExcel hands to write-excel-file, exposed so tests can check cell types/values directly. */
export function buildWoonbehoefteReportSheetData(rows: WoonbehoefteReportRow[]): Row[] {
  return [headerRow(), ...rows.map(dataRow)];
}

/** Writes the full Woonbehoefte report as an XLSX Buffer. Never touches S3; that's the caller's job. */
export async function writeWoonbehoefteReportExcel(rows: WoonbehoefteReportRow[]): Promise<Buffer> {
  const data = buildWoonbehoefteReportSheetData(rows);
  const columns = FIXED_COLUMNS.map((column) => ({ width: column.width }));

  const file = writeXlsxFile(data, { sheet: 'Woonbehoefte-overzicht', stickyRowsCount: 1, columns });
  return file.toBuffer();
}
