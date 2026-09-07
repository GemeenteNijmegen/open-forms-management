import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { logger } from '../../../../observability/Logger';

// Loose: the CSV carries more Open Forms columns (Formuliernaam, upload metadata, internalNotificationEmails,
// networkShare) this feature deliberately does not normalize. `origineleKenmerk` is the one field this
// feature cannot function without: without it there is nothing to search a hoofdzaak with, so an empty
// value fails validation here rather than silently becoming an empty search field.
const additionalEvidenceCsvRowSchema = z.looseObject({
  Inzendingdatum: z.string(),
  origineleKenmerk: z.string().min(1),
  voorWelkProjectVoegtUDeExtraBewijzenToe: z.string(),
  uwEMailadres: z.string(),
  telefoonnummer: z.string(),
  welkeExtraBewijzenHeeftUToegevoegd: z.string(),
  heeftUNogOpmerkingen: z.string(),
});

export type AdditionalEvidenceCsvRow = z.infer<typeof additionalEvidenceCsvRowSchema>;

export interface ParsedAdditionalEvidenceCsv {
  submittedAt: string;
  originalCaseReference: string;
  submittedProjectName?: string;
  contactEmail?: string;
  contactPhone?: string;
  evidenceDescription?: string;
  remarks?: string;
}

/** Parses one Open Forms "Extra bewijzen stroomaansluiting woningbouw" CSV export (one header row, one submission row). */
export function parseAdditionalEvidenceCsvRow(csvText: string, reference: string): AdditionalEvidenceCsvRow {
  const rows: unknown[] = parse(csvText, { columns: true, skip_empty_lines: true });
  if (rows.length !== 1) {
    throw new Error(`Additional Evidence CSV must contain exactly one submission row, got ${rows.length}`);
  }

  const result = additionalEvidenceCsvRowSchema.safeParse(rows[0]);
  if (!result.success) {
    logger.warn('Additional Evidence CSV row failed validation', {
      reference,
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    throw new Error('Additional Evidence CSV row failed validation');
  }
  return result.data;
}

export function parseAdditionalEvidenceCsv(csvText: string, reference: string): ParsedAdditionalEvidenceCsv {
  const row = parseAdditionalEvidenceCsvRow(csvText, reference);

  return {
    submittedAt: parseInzendingdatum(row.Inzendingdatum).toISOString(),
    originalCaseReference: row.origineleKenmerk,
    ...(row.voorWelkProjectVoegtUDeExtraBewijzenToe ? { submittedProjectName: row.voorWelkProjectVoegtUDeExtraBewijzenToe } : {}),
    ...(row.uwEMailadres ? { contactEmail: row.uwEMailadres } : {}),
    ...(row.telefoonnummer ? { contactPhone: row.telefoonnummer } : {}),
    ...(row.welkeExtraBewijzenHeeftUToegevoegd ? { evidenceDescription: row.welkeExtraBewijzenHeeftUToegevoegd } : {}),
    ...(row.heeftUNogOpmerkingen ? { remarks: row.heeftUNogOpmerkingen } : {}),
  };
}

/**
 * `Inzendingdatum` is `YYYY-MM-DD HH:mm:ss.ffffff` (microseconds, no timezone), the same shape the primary
 * Woonbehoefte CSV export uses. Date only supports millisecond precision; both are normalized to UTC here.
 */
function parseInzendingdatum(value: string): Date {
  const [datePart, timePart = ''] = value.split(' ');
  const [time, fraction = ''] = timePart.split('.');
  const milliseconds = fraction.slice(0, 3).padEnd(3, '0');
  return new Date(`${datePart}T${time}.${milliseconds}Z`);
}
