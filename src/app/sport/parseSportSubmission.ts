import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { SportSubmission, SportSubmissionChild } from './SportSubmission';
import { logger } from '../../observability/Logger';

// Also carries the reporter-only columns (data contract columns not needed by the Sportpagina itself), so the
// reporter can build its own richer row on top of this same validated parse instead of a second CSV interpretation.
const sportCsvRowSchema = z.looseObject({
  Formuliernaam: z.string(),
  Inzendingdatum: z.string(),
  aanmeldType: z.enum(['kind', 'volwassene']),
  stadsdeel: z.string(),
  voornaam: z.string(),
  achternaam: z.string(),
  geboortedatum: z.string(),
  telefoonnummer: z.string(),
  eMailadres: z.string(),
  voornaamTweedeContact: z.string(),
  achternaamTweedeContact: z.string(),
  telefoonnummerTweedeContact: z.string(),
  eMailadresTweedeContact: z.string(),
  naamNoodgevallen: z.string(),
  telefoonnummerNoodgevallen: z.string(),
  opmerking: z.string(),
  aanmeldenSportactiviteit: z.string(),
  sportactiviteitenData: z.string(),
  sportactiviteitAnders: z.string(),
  sportUwKindBijEenSportvereniging: z.string(),
  naamAmbulantBegeleider: z.string(),
  organisatieAmbulantBegeleider: z.string(),
  toestemmingContactOpnemen: z.string(),
  toestemmingGegevens: z.string(),
  toestemmingFotos: z.string(),
  voornaamKind: z.string(),
  achternaamKind: z.string(),
  geboortedatumKind: z.string(),
  soortOnderwijsDatUwKindVolgt: z.string(),
  basisschool: z.string(),
  groep: z.string(),
  voorgezetOnderwijs: z.string(),
});

export type SportCsvRow = z.infer<typeof sportCsvRowSchema>;

/**
 * Parses one Open Forms "Aanmelden sportactiviteit" CSV export (one header row, one submission row) into the
 * validated row both the Sportpagina's `parseSportSubmission` and the reporter build their own model on top of.
 */
export function parseSportCsvRow(csvText: string): SportCsvRow {
  const rows: unknown[] = parse(csvText, { columns: true, skip_empty_lines: true });
  if (rows.length !== 1) {
    throw new Error(`Sport CSV must contain exactly one submission row, got ${rows.length}`);
  }

  const result = sportCsvRowSchema.safeParse(rows[0]);
  if (!result.success) {
    logger.warn('Sport CSV row failed validation', {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    throw new Error('Sport CSV row failed validation');
  }
  return result.data;
}

/**
 * Parses one Open Forms "Aanmelden sportactiviteit" CSV export into the model the Sportpagina needs.
 * `reference` comes from the Object the CSV was fetched for, not from the CSV itself.
 */
export function parseSportSubmission(csvText: string, reference: string): SportSubmission {
  const row = parseSportCsvRow(csvText);
  const child = row.aanmeldType === 'kind' ? buildChild(row) : undefined;

  return {
    reference,
    submittedAt: parseSubmittedAt(row.Inzendingdatum),
    district: row.stadsdeel,
    aanmeldType: row.aanmeldType,
    contactName: `${row.voornaam} ${row.achternaam}`.trim(),
    phone: row.telefoonnummer,
    email: row.eMailadres,
    activities: parseActivities(row.aanmeldenSportactiviteit, row.sportactiviteitenData),
    // objectUuid/hasPdf don't come from the CSV; buildSportSubmissions fills them in from the Object.
    hasPdf: false,
    ...(row.opmerking ? { remark: row.opmerking } : {}),
    ...(child ? { child } : {}),
  };
}

function buildChild(row: SportCsvRow): SportSubmissionChild {
  const school = row.basisschool || row.voorgezetOnderwijs || undefined;
  return {
    name: `${row.voornaamKind} ${row.achternaamKind}`.trim(),
    ...(row.geboortedatumKind ? { birthDate: row.geboortedatumKind } : {}),
    ...(school ? { school } : {}),
  };
}

/**
 * `Inzendingdatum` is `YYYY-MM-DD HH:mm:ss.ffffff` (microseconds, no timezone). Date only supports
 * millisecond precision, and this app always compares/sorts these in UTC, so both are normalized here.
 */
export function parseSubmittedAt(value: string): Date {
  const [datePart, timePart = ''] = value.split(' ');
  const [time, fraction = ''] = timePart.split('.');
  const milliseconds = fraction.slice(0, 3).padEnd(3, '0');
  return new Date(`${datePart}T${time}.${milliseconds}Z`);
}

/**
 * `aanmeldenSportactiviteit` is a Python-dict literal of selected activity keys to booleans;
 * `sportactiviteitenData` is a Python list of `[key, label]` pairs for the district's activities.
 * Together they give the readable labels for the selected activities, including `notApplicable` ->
 * "Niet van toepassing", which is already the label Open Forms serializes for that key.
 */
export function parseActivities(selectionField: string, labelsField: string): string[] {
  const selected = parsePythonBooleanDict(selectionField);
  const labels = parsePythonPairList(labelsField);
  return Object.entries(selected)
    .filter(([, isSelected]) => isSelected)
    .map(([key]) => labels[key] ?? key);
}

function parsePythonBooleanDict(value: string): Record<string, boolean> {
  return Object.fromEntries(
    [...value.matchAll(/'([^']+)':\s*(True|False)/g)].map((match) => [match[1], match[2] === 'True']),
  );
}

function parsePythonPairList(value: string): Record<string, string> {
  return Object.fromEntries(
    [...value.matchAll(/\['([^']*)',\s*'([^']*)'\]/g)].map((match) => [match[1], match[2]]),
  );
}
