import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { parseRepeatingGroupRows, RawSourceRow } from './parser/RepeatingGroupValueParser';
import { logger } from '../../../../observability/Logger';

/** Loose: net als WoonbehoefteCsvParser draagt de CSV veel meer Open Forms-kolommen die deze feature niet nodig heeft. */
const projectDetailsCsvRowSchema = z.looseObject({
  projectNaam: z.string(),
  korteBeschrijvingVanHetProjectProgrammaEnFasering: z.string(),
  isCollectieveWoonvorm: z.string(),
  woningenEnAansluitingen: z.string(),
  collectieveVoorzieningenAansluitingen: z.string(),
  kovaAansluitingen: z.string(),
  projectZonnepanelenAchterMeter: z.string(),
  projectAantalZonnepanelen: z.string(),
  projectWattpiekPerZonnepaneel: z.string(),
  projectLaadpalenAchterMeter: z.string(),
  projectAantalLaadpalen: z.string(),
  projectMaxPiekvermogenLaadpalenKw: z.string(),
});

export type ProjectDetailsCsvRow = z.infer<typeof projectDetailsCsvRowSchema>;

export interface ProjectDetailsProjectWideFields {
  solarPanelsBehindMeter?: string;
  solarPanelCount?: string;
  solarPanelWattPeak?: string;
  chargingPointsBehindMeter?: string;
  chargingPointCount?: string;
  chargingPointsMaxPowerKw?: string;
}

export interface ProjectDetailsCsvData {
  projectName?: string;
  projectDescription?: string;
  isCollectiveHousing: boolean;
  housingRows: RawSourceRow[];
  facilityRows: RawSourceRow[];
  kovaRows: RawSourceRow[];
  projectWideFields: ProjectDetailsProjectWideFields;
}

/** Zelfde één-rij-eis als WoonbehoefteCsvParser en WoonbehoefteRawFormFields: één Open Forms-inzending per CSV. */
export function parseProjectDetailsCsvRow(csvText: string): ProjectDetailsCsvRow {
  const rows: unknown[] = parse(csvText, { columns: true, skip_empty_lines: true });
  if (rows.length !== 1) {
    throw new Error(`Projectdetails CSV must contain exactly one submission row, got ${rows.length}`);
  }

  const result = projectDetailsCsvRowSchema.safeParse(rows[0]);
  if (!result.success) {
    logger.warn('Projectdetails CSV row failed validation', {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    throw new Error('Projectdetails CSV row failed validation');
  }
  return result.data;
}

function parseDictListColumn(value: string, reference: string, columnName: string): RawSourceRow[] {
  try {
    return parseRepeatingGroupRows(value);
  } catch (error) {
    logger.warn('Projectdetails CSV column is not a valid Python-literal dict list', {
      reference, columnName, reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Parst de primaire CSV naar de ruwe vorm die buildProjectDetailsPrefill omzet naar werkregels. Logt bij
 * een fout alleen de kolomnaam en de reden, nooit de veldinhoud zelf.
 */
export function parseProjectDetailsCsv(csvText: string, reference: string): ProjectDetailsCsvData {
  const row = parseProjectDetailsCsvRow(csvText);

  return {
    ...(row.projectNaam ? { projectName: row.projectNaam } : {}),
    ...(row.korteBeschrijvingVanHetProjectProgrammaEnFasering
      ? { projectDescription: row.korteBeschrijvingVanHetProjectProgrammaEnFasering } : {}),
    isCollectiveHousing: row.isCollectieveWoonvorm === 'ja',
    housingRows: parseDictListColumn(row.woningenEnAansluitingen, reference, 'woningenEnAansluitingen'),
    facilityRows: parseDictListColumn(row.collectieveVoorzieningenAansluitingen, reference, 'collectieveVoorzieningenAansluitingen'),
    kovaRows: parseDictListColumn(row.kovaAansluitingen, reference, 'kovaAansluitingen'),
    projectWideFields: {
      ...(row.projectZonnepanelenAchterMeter ? { solarPanelsBehindMeter: row.projectZonnepanelenAchterMeter } : {}),
      ...(row.projectAantalZonnepanelen ? { solarPanelCount: row.projectAantalZonnepanelen } : {}),
      ...(row.projectWattpiekPerZonnepaneel ? { solarPanelWattPeak: row.projectWattpiekPerZonnepaneel } : {}),
      ...(row.projectLaadpalenAchterMeter ? { chargingPointsBehindMeter: row.projectLaadpalenAchterMeter } : {}),
      ...(row.projectAantalLaadpalen ? { chargingPointCount: row.projectAantalLaadpalen } : {}),
      ...(row.projectMaxPiekvermogenLaadpalenKw ? { chargingPointsMaxPowerKw: row.projectMaxPiekvermogenLaadpalenKw } : {}),
    },
  };
}
