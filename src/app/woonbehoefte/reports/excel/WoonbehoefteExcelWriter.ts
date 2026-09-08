import writeXlsxFile from 'write-excel-file/node';
import type { Cell, Row } from 'write-excel-file/node';
import { collectRawFormFieldHeaders, serializeRawFormFieldValue } from '../rawformfields/WoonbehoefteRawFormFields';
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

// Zero-padded display ('09'), but the underlying value stays a plain number so month still sorts/filters numerically, not as text.
function monthCell(value: number | undefined): Cell {
  return value === undefined ? { value: '', type: String } : { value, type: Number, format: '00' };
}

// YYYYMM as a real number (e.g. 202809) so a filter/sort on this column orders chronologically, not alphabetically on a spelled-out label.
function periodCell(year: number | undefined, month: number | undefined): Cell {
  return year === undefined || month === undefined
    ? { value: 'Nog niet vastgesteld', type: String }
    : { value: (year * 100) + month, type: Number };
}

const FIXED_COLUMNS: ColumnDef[] = [
  // A. Identiteit en actuele verwerking
  { header: 'OF-kenmerk', width: 20, cell: (row) => textCell(row.caseReference) },
  { header: 'Projectnaam', width: 26, cell: (row) => textCell(row.projectName) },
  { header: 'Status', width: 22, cell: (row) => textCell(row.statusLabel) },

  // Startdatum: vastgesteld, ingediend, toelichting en de twee bewijsvelden staan bewust bij elkaar.
  { header: 'Vastgestelde start jaar-maand', width: 18, cell: (row) => periodCell(row.assessedStartYear, row.assessedStartMonth) },
  { header: 'Vastgesteld startjaar', width: 12, cell: (row) => numberCell(row.assessedStartYear) },
  { header: 'Vastgestelde startmaand', width: 12, cell: (row) => monthCell(row.assessedStartMonth) },
  { header: 'Ingediende startdatum', width: 18, cell: (row) => textCell(row.submittedStartDate) },
  { header: 'Toelichting vastgestelde start', width: 30, wrap: true, cell: (row) => textCell(row.assessedStartExplanation, true) },
  {
    header: 'Overeenkomst(en) als onderbouwing\nBewijs anterieure overeenkomst akkoord',
    width: 28,
    wrap: true,
    cell: (row) => textCell(row.planningAgreementEvidenceApprovedLabel),
  },
  {
    header: 'Subsidie, woondeal of prestatieafspraken\nBewijs publiek besluit akkoord',
    width: 28,
    wrap: true,
    cell: (row) => textCell(row.planningPublicDecisionEvidenceApprovedLabel),
  },

  // Opleverdatum: zelfde opbouw als startdatum hierboven.
  { header: 'Vastgestelde oplever jaar-maand', width: 18, cell: (row) => periodCell(row.assessedCompletionYear, row.assessedCompletionMonth) },
  { header: 'Vastgesteld opleverjaar', width: 12, cell: (row) => numberCell(row.assessedCompletionYear) },
  { header: 'Vastgestelde oplevermaand', width: 12, cell: (row) => monthCell(row.assessedCompletionMonth) },
  { header: 'Ingediende opleverdatum', width: 18, cell: (row) => textCell(row.submittedCompletionDate) },
  { header: 'Toelichting vastgestelde oplevering', width: 30, wrap: true, cell: (row) => textCell(row.assessedCompletionExplanation, true) },

  { header: 'Vastgestelde projectrijpheid categorie', width: 14, cell: (row) => numberCell(row.assessedProjectReadinessCategory) },
  { header: 'Vastgestelde projectrijpheid', width: 40, wrap: true, cell: (row) => textCell(row.assessedProjectReadinessLabel, true) },
  { header: 'Behandelaar', width: 24, cell: (row) => textCell(row.assigneeLabel) },
  { header: 'Geclaimd op', width: 18, cell: (row) => textCell(row.claimedAtLabel) },
  { header: 'Status sinds', width: 18, cell: (row) => textCell(row.statusSinceLabel) },

  // B. Volledige gestructureerde assessment
  { header: 'Aanvraag compleet', width: 16, cell: (row) => textCell(row.applicationCompleteLabel) },
  { header: 'Bestuursverklaring akkoord', width: 16, cell: (row) => textCell(row.boardDeclarationApprovedLabel) },
  { header: 'KvK-uittreksel akkoord', width: 16, cell: (row) => textCell(row.chamberOfCommerceApprovedLabel) },
  { header: 'Bewijs projectrijpheid akkoord', width: 16, cell: (row) => textCell(row.projectReadinessEvidenceApprovedLabel) },

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
  { header: 'Toelichting ingediende startdatum', width: 30, wrap: true, cell: (row) => textCell(row.startDateExplanation, true) },
  { header: 'Projectrijpheid volgens aanvraag categorie', width: 14, cell: (row) => numberCell(row.submittedProjectReadinessCategory) },
  { header: 'Projectrijpheid volgens aanvraag', width: 40, wrap: true, cell: (row) => textCell(row.submittedProjectReadinessLabel, true) },
  { header: 'Type aanvrager', width: 18, cell: (row) => textCell(row.applicantTypeLabel) },
  { header: 'Collectieve woonvorm', width: 14, cell: (row) => textCell(row.collectiveHousingLabel) },
  { header: 'Categorie collectieve woonvorm', width: 20, cell: (row) => textCell(row.collectiveHousingCategory) },
  { header: 'Collectieve voorzieningen', width: 14, cell: (row) => textCell(row.collectiveFacilitiesLabel) },
  { header: 'KOVA', width: 10, cell: (row) => textCell(row.kovaLabel) },
];

// G. Bijlagen, na de vaste en dynamische formulierveldkolommen, altijd vóór Bronwaarschuwing.
const ATTACHMENTS_COLUMN: ColumnDef = {
  header: 'Bijlagen', width: 40, wrap: true, cell: (row) => textCell(row.attachmentFilenamesText, true),
};

// H. Laatste kolom, altijd na de vaste, dynamische en Bijlagen-kolommen.
const BRONWAARSCHUWING_COLUMN: ColumnDef = {
  header: 'Bronwaarschuwing', width: 40, wrap: true, cell: (row) => textCell(row.sourceWarning, true),
};

const RAW_FORM_FIELD_COLUMN_WIDTH = 30;

function rawFormFieldRows(rows: WoonbehoefteReportRow[]) {
  return rows.map((row) => row.rawFormFields).filter((fields): fields is NonNullable<typeof fields> => Boolean(fields));
}

/** One dynamic column per unique raw CSV header seen across the whole report, deterministic first-seen order. */
function buildRawFormFieldColumns(rows: WoonbehoefteReportRow[]): ColumnDef[] {
  const headers = collectRawFormFieldHeaders(rawFormFieldRows(rows));
  return headers.map((header): ColumnDef => ({
    header: `Formulier - ${header}`,
    width: RAW_FORM_FIELD_COLUMN_WIDTH,
    wrap: true,
    cell: (row) => textCell(serializeRawFormFieldValue(row.rawFormFields?.values[header] ?? ''), true),
  }));
}

function buildColumns(rows: WoonbehoefteReportRow[]): ColumnDef[] {
  return [...FIXED_COLUMNS, ...buildRawFormFieldColumns(rows), ATTACHMENTS_COLUMN, BRONWAARSCHUWING_COLUMN];
}

// Every header wraps, regardless of whether its own data cells do: long headers (like the two-line evidence ones) must never get cut off.
function headerRow(columns: ColumnDef[]): Row {
  return columns.map((column): Cell => ({ value: column.header, type: String, fontWeight: 'bold', wrap: true }));
}

function dataRow(row: WoonbehoefteReportRow, columns: ColumnDef[]): Row {
  return columns.map((column) => column.cell(row));
}

/** The exact cell data writeWoonbehoefteReportExcel hands to write-excel-file, exposed so tests can check cell types/values directly. */
export function buildWoonbehoefteReportSheetData(rows: WoonbehoefteReportRow[]): Row[] {
  const columns = buildColumns(rows);
  return [headerRow(columns), ...rows.map((row) => dataRow(row, columns))];
}

/** Writes the full Woonbehoefte report as an XLSX Buffer. Never touches S3; that's the caller's job. */
export async function writeWoonbehoefteReportExcel(rows: WoonbehoefteReportRow[]): Promise<Buffer> {
  const columns = buildColumns(rows);
  const data = [headerRow(columns), ...rows.map((row) => dataRow(row, columns))];

  const columnWidths = columns.map((column) => ({ width: column.width }));
  const file = writeXlsxFile(data, { sheet: 'Woonbehoefte-overzicht', stickyRowsCount: 1, columns: columnWidths });
  return file.toBuffer();
}
