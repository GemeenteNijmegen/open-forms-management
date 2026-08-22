import writeXlsxFile from 'write-excel-file/node';
import type { Cell, Row } from 'write-excel-file/node';
import { SPORT_DISTRICT_LABELS, SportDistrict } from '../../SportDistrictAuthorization';
import { SportReportRow } from '../reportbuilder/SportReportRow';

const TEXT_FORMAT = '@';

interface ColumnDef {
  header: string;
  width: number;
  wrap?: boolean;
  cell: (row: SportReportRow) => Cell;
}

// Explicit `type: String` (never `'Formula'`) is what keeps a value starting with `=`, `+`, `-` or `@` literal text.
function textCell(value: string, wrap = false): Cell {
  return { value, type: String, format: TEXT_FORMAT, ...(wrap ? { wrap: true } : {}) };
}

function dateCell(value: Date | undefined, format: string): Cell {
  return value ? { value, type: Date, format } : { value: '', type: String };
}

/** CSV birthdates are plain `YYYY-MM-DD`; empty/unparseable values become a blank cell instead of an invalid Date. */
function parseCsvDate(value: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const FIXED_COLUMNS: ColumnDef[] = [
  { header: 'Kenmerk', width: 24, cell: (row) => textCell(row.reference) },
  { header: 'Formulier', width: 20, cell: (row) => textCell(row.formName) },
  {
    header: 'Ingediend op',
    width: 18,
    cell: (row) => (Number.isNaN(row.submittedAt.getTime())
      ? textCell('')
      : { value: row.submittedAt, type: Date, format: 'dd-mm-yyyy hh:mm' }),
  },
  { header: 'Type aanmelding', width: 14, cell: (row) => textCell(row.aanmeldType) },
  { header: 'Voornaam kind', width: 16, cell: (row) => textCell(row.childFirstName) },
  { header: 'Achternaam kind', width: 16, cell: (row) => textCell(row.childLastName) },
  { header: 'Geboortedatum kind', width: 16, cell: (row) => dateCell(parseCsvDate(row.childBirthDate), 'dd-mm-yyyy') },
  { header: 'Soort onderwijs', width: 20, cell: (row) => textCell(row.educationType) },
  { header: 'Basisschool', width: 18, cell: (row) => textCell(row.primarySchool) },
  { header: 'Groep', width: 8, cell: (row) => textCell(row.schoolGroup) },
  { header: 'Voortgezet onderwijs', width: 20, cell: (row) => textCell(row.secondarySchool) },
  { header: 'Voornaam volwassene / ouder-verzorger', width: 22, cell: (row) => textCell(row.contactFirstName) },
  { header: 'Achternaam volwassene / ouder-verzorger', width: 22, cell: (row) => textCell(row.contactLastName) },
  { header: 'Geboortedatum volwassene', width: 18, cell: (row) => dateCell(parseCsvDate(row.contactBirthDate), 'dd-mm-yyyy') },
  { header: 'Telefoonnummer', width: 16, cell: (row) => textCell(row.phone) },
  { header: 'E-mailadres', width: 24, cell: (row) => textCell(row.email) },
  { header: 'Voornaam tweede contact', width: 18, cell: (row) => textCell(row.secondContactFirstName) },
  { header: 'Achternaam tweede contact', width: 18, cell: (row) => textCell(row.secondContactLastName) },
  { header: 'Telefoonnummer tweede contact', width: 18, cell: (row) => textCell(row.secondContactPhone) },
  { header: 'E-mailadres tweede contact', width: 24, cell: (row) => textCell(row.secondContactEmail) },
  { header: 'Contactpersoon noodgevallen', width: 20, cell: (row) => textCell(row.emergencyContactName) },
  { header: 'Telefoonnummer noodgevallen', width: 18, cell: (row) => textCell(row.emergencyContactPhone) },
  { header: 'Wijk', width: 20, cell: (row) => textCell(SPORT_DISTRICT_LABELS[row.district as SportDistrict] ?? row.district) },
  { header: 'Kind sport bij sportvereniging', width: 20, cell: (row) => textCell(row.childInSportsClub) },
  { header: 'Andere sportactiviteit', width: 20, cell: (row) => textCell(row.otherActivity) },
  { header: 'Naam ambulant begeleider', width: 20, cell: (row) => textCell(row.outreachWorkerName) },
  { header: 'Organisatie ambulant begeleider', width: 22, cell: (row) => textCell(row.outreachWorkerOrganization) },
  { header: 'Toestemming contact opnemen', width: 18, cell: (row) => textCell(row.consentContact) },
  { header: 'Toestemming gegevens gebruiken', width: 18, cell: (row) => textCell(row.consentDataUse) },
  { header: 'Toestemming foto\'s', width: 16, cell: (row) => textCell(row.consentPhotos) },
  { header: 'Opmerking', width: 30, wrap: true, cell: (row) => textCell(row.remark, true) },
  { header: 'Activiteiten', width: 30, wrap: true, cell: (row) => textCell(row.activities.join('; '), true) },
];

// Deterministic across runs regardless of input order: every unique label across the whole dataset, alphabetical.
function collectActivityLabels(rows: SportReportRow[]): string[] {
  const labels = new Set<string>();
  for (const row of rows) {
    for (const activity of row.activities) {
      labels.add(activity);
    }
  }
  return [...labels].sort((a, b) => a.localeCompare(b, 'nl'));
}

function headerRow(activityLabels: string[]): Row {
  return [
    ...FIXED_COLUMNS.map((column): Cell => ({ value: column.header, type: String, fontWeight: 'bold' })),
    ...activityLabels.map((label): Cell => ({ value: label, type: String, fontWeight: 'bold' })),
  ];
}

function dataRow(row: SportReportRow, activityLabels: string[]): Row {
  const selected = new Set(row.activities);
  return [
    ...FIXED_COLUMNS.map((column) => column.cell(row)),
    ...activityLabels.map((label): Cell => (selected.has(label) ? { value: true, type: Boolean } : { value: '', type: String })),
  ];
}

/** The exact cell data `writeSportReportExcel` hands to `write-excel-file`, exposed so tests can check cell types/values directly. */
export function buildSportReportSheetData(rows: SportReportRow[]): Row[] {
  const activityLabels = collectActivityLabels(rows);
  return [headerRow(activityLabels), ...rows.map((row) => dataRow(row, activityLabels))];
}

function buildSportReportColumns(rows: SportReportRow[]): { width: number }[] {
  const activityLabels = collectActivityLabels(rows);
  return [...FIXED_COLUMNS.map((column) => ({ width: column.width })), ...activityLabels.map(() => ({ width: 14 }))];
}

/** Writes the full Sport report as an XLSX Buffer. Never touches S3; that's the worker's job (SPORT-RPT-005). */
export async function writeSportReportExcel(rows: SportReportRow[]): Promise<Buffer> {
  const data = buildSportReportSheetData(rows);
  const columns = buildSportReportColumns(rows);

  const file = writeXlsxFile(data, { sheet: 'Sportoverzicht', stickyRowsCount: 1, columns });
  return file.toBuffer();
}
