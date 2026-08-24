import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { logger } from '../../../observability/Logger';
import { ApplicantType } from '../domain/WoonbehoefteSource';

// Loose: the CSV carries many more Open Forms columns (choice-arrays, upload metadata, networkShare,
// internalNotificationEmails) this feature deliberately does not normalize.
const woonbehoefteCsvRowSchema = z.looseObject({
  Inzendingdatum: z.string(),
  projectNaam: z.string(),
  korteBeschrijvingVanHetProjectProgrammaEnFasering: z.string(),
  naamContactpersoon: z.string(),
  telefoonnummerContactpersoon: z.string(),
  emailadresContactpersoon: z.string(),
  heeftLopendeAanvraagLiander: z.string(),
  eanCodeOfAanmeldnummer: z.string(),
  totaalAantalWoningen: z.string(),
  geplandeStartdatumBouw: z.string(),
  toelichtingStartBouw: z.string(),
  geplandeDatumOpleveringBouw: z.string(),
  isIndividueleWoningeigenaar: z.string(),
  dientProjectInNamensOverheid: z.string(),
  isCollectieveWoonvorm: z.string(),
  categorieCollectieveWoonvorm: z.string(),
  heeftCollectieveVoorzieningen: z.string(),
  heeftKova: z.string(),
  heeftProjectrijpheid1: z.string(),
  heeftProjectrijpheid2: z.string(),
  heeftProjectrijpheid3: z.string(),
  heeftProjectrijpheid4: z.string(),
  heeftProjectrijpheid5: z.string(),
  heeftProjectrijpheid6: z.string(),
});

export type WoonbehoefteCsvRow = z.infer<typeof woonbehoefteCsvRowSchema>;

export interface ParsedWoonbehoefteCsv {
  registrationAt: string;
  projectName?: string;
  projectDescription?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  hasExistingLianderRequest?: boolean;
  eanOrApplicationNumber?: string;
  totalHomes?: number;
  submittedStartDate?: string;
  startDateExplanation?: string;
  submittedCompletionDate?: string;
  submittedProjectReadiness?: 1 | 2 | 3 | 4 | 5 | 6;
  applicantType: ApplicantType;
  isCollectiveHousing?: boolean;
  collectiveHousingCategory?: string;
  hasCollectiveFacilities?: boolean;
  hasKova?: boolean;
}

/** Parses one Open Forms "Aanmelden stroomaansluiting woningbouw" CSV export (one header row, one submission row). */
export function parseWoonbehoefteCsvRow(csvText: string): WoonbehoefteCsvRow {
  const rows: unknown[] = parse(csvText, { columns: true, skip_empty_lines: true });
  if (rows.length !== 1) {
    throw new Error(`Woonbehoefte CSV must contain exactly one submission row, got ${rows.length}`);
  }

  const result = woonbehoefteCsvRowSchema.safeParse(rows[0]);
  if (!result.success) {
    logger.warn('Woonbehoefte CSV row failed validation', {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    throw new Error('Woonbehoefte CSV row failed validation');
  }
  return result.data;
}

export function parseWoonbehoefteCsv(csvText: string, reference: string): ParsedWoonbehoefteCsv {
  const row = parseWoonbehoefteCsvRow(csvText);

  const isIndividualHomeowner = parseJaNee(row.isIndividueleWoningeigenaar);
  const isMunicipalityNijmegen = parseJaNee(row.dientProjectInNamensOverheid);
  const isCollectiveHousing = parseJaNee(row.isCollectieveWoonvorm);

  return {
    registrationAt: parseInzendingdatum(row.Inzendingdatum).toISOString(),
    ...(row.projectNaam ? { projectName: row.projectNaam } : {}),
    ...(row.korteBeschrijvingVanHetProjectProgrammaEnFasering ? { projectDescription: row.korteBeschrijvingVanHetProjectProgrammaEnFasering } : {}),
    ...(row.naamContactpersoon ? { contactName: row.naamContactpersoon } : {}),
    ...(row.telefoonnummerContactpersoon ? { contactPhone: row.telefoonnummerContactpersoon } : {}),
    ...(row.emailadresContactpersoon ? { contactEmail: row.emailadresContactpersoon } : {}),
    ...(row.heeftLopendeAanvraagLiander ? { hasExistingLianderRequest: parseJaNee(row.heeftLopendeAanvraagLiander) } : {}),
    ...(row.eanCodeOfAanmeldnummer ? { eanOrApplicationNumber: row.eanCodeOfAanmeldnummer } : {}),
    ...(row.totaalAantalWoningen ? { totalHomes: parseTotalHomes(row.totaalAantalWoningen, reference) } : {}),
    ...(row.geplandeStartdatumBouw ? { submittedStartDate: row.geplandeStartdatumBouw } : {}),
    ...(row.toelichtingStartBouw ? { startDateExplanation: row.toelichtingStartBouw } : {}),
    ...(row.geplandeDatumOpleveringBouw ? { submittedCompletionDate: row.geplandeDatumOpleveringBouw } : {}),
    ...withOptional('submittedProjectReadiness', resolveProjectReadiness(row, reference)),
    ...(row.isCollectieveWoonvorm ? { isCollectiveHousing } : {}),
    ...(row.categorieCollectieveWoonvorm ? { collectiveHousingCategory: row.categorieCollectieveWoonvorm } : {}),
    applicantType: deriveApplicantType(isIndividualHomeowner, isMunicipalityNijmegen),
    ...(row.heeftCollectieveVoorzieningen ? { hasCollectiveFacilities: parseJaNee(row.heeftCollectieveVoorzieningen) } : {}),
    ...(row.heeftKova ? { hasKova: parseJaNee(row.heeftKova) } : {}),
  };
}

/** `ja`/`nee` are the only meaningful values the form emits; anything else (including empty) is unknown, never guessed. */
function parseJaNee(value: string): boolean | undefined {
  if (value === 'ja') {
    return true;
  }
  if (value === 'nee') {
    return false;
  }
  return undefined;
}

function parseTotalHomes(value: string, reference: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    logger.warn('Woonbehoefte CSV totaalAantalWoningen is not numeric', { reference, value });
    return undefined;
  }
  return parsed;
}

/**
 * `Inzendingdatum` is `YYYY-MM-DD HH:mm:ss.ffffff` (microseconds, no timezone), the same shape Sport's
 * CSV export uses. Date only supports millisecond precision; both are normalized to UTC here.
 */
function parseInzendingdatum(value: string): Date {
  const [datePart, timePart = ''] = value.split(' ');
  const [time, fraction = ''] = timePart.split('.');
  const milliseconds = fraction.slice(0, 3).padEnd(3, '0');
  return new Date(`${datePart}T${time}.${milliseconds}Z`);
}

const READINESS_FIELDS = [
  'heeftProjectrijpheid1', 'heeftProjectrijpheid2', 'heeftProjectrijpheid3',
  'heeftProjectrijpheid4', 'heeftProjectrijpheid5', 'heeftProjectrijpheid6',
] as const;

/**
 * The conditional form normally leaves exactly one `heeftProjectrijpheidN` as `ja`. Zero or more than
 * one selected is a source data conflict this never guesses through: it logs a WARN and leaves the
 * readiness unset, so the medewerker resolves it from the application PDF instead.
 */
function resolveProjectReadiness(row: WoonbehoefteCsvRow, reference: string): 1 | 2 | 3 | 4 | 5 | 6 | undefined {
  const selected = READINESS_FIELDS
    .map((field, index) => ({ index: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6, value: row[field] }))
    .filter((entry) => entry.value === 'ja')
    .map((entry) => entry.index);

  if (selected.length === 1) {
    return selected[0];
  }

  logger.warn('Woonbehoefte CSV projectrijpheid could not be determined unambiguously', { reference, selectedCount: selected.length });
  return undefined;
}

/**
 * `isCollectieveWoonvorm` is a separate, orthogonal characteristic (`isCollectiveHousing` on the source
 * record), never a primary applicant type. Missing/ambiguous source booleans stay `UNKNOWN`, never a
 * silent `PROJECT_APPLICANT` guess.
 */
function deriveApplicantType(
  isIndividualHomeowner: boolean | undefined,
  isMunicipalityNijmegen: boolean | undefined,
): ApplicantType {
  if (isIndividualHomeowner === true) {
    return 'INDIVIDUAL';
  }
  if (isMunicipalityNijmegen === true) {
    return 'MUNICIPALITY_NIJMEGEN';
  }
  if (isIndividualHomeowner === false && isMunicipalityNijmegen === false) {
    return 'PROJECT_APPLICANT';
  }
  return 'UNKNOWN';
}

function withOptional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}
