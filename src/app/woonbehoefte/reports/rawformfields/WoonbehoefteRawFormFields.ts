import { parse } from 'csv-parse/sync';

export interface WoonbehoefteRawFormRow {
  /** Original CSV column order, minus excluded technical fields. */
  headers: string[];
  values: Record<string, string>;
}

const EXCLUDED_EXACT_FIELDS = new Set(['internalNotificationEmails', 'networkShare']);

/** Open Forms upload-component keys carry only opaque file metadata (url/name/size), never inhoudelijke input. */
function isUploadComponentField(header: string): boolean {
  return header.startsWith('upload');
}

/** Kept separate and exported so the exclusion rule stays easy to extend as new technical fields turn up in real exports. */
export function isExcludedRawFormField(header: string): boolean {
  return EXCLUDED_EXACT_FIELDS.has(header) || isUploadComponentField(header);
}

/**
 * A minimal, standalone raw reader for the "alle formuliervelden" option: it does not extend
 * WoonbehoefteCsvParser, which deliberately stays a normalized subset. Nested/repeating JSON values are
 * kept as their raw CSV string, not interpreted.
 */
export function parseWoonbehoefteRawFormRow(csvText: string): WoonbehoefteRawFormRow {
  const rows: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true });
  if (rows.length !== 1) {
    throw new Error(`Woonbehoefte raw form CSV must contain exactly one submission row, got ${rows.length}`);
  }

  const headers = Object.keys(rows[0]).filter((header) => !isExcludedRawFormField(header));
  const values = Object.fromEntries(headers.map((header) => [header, rows[0][header]]));
  return { headers, values };
}

/** Union of headers across every successfully parsed row, first-seen order over rows already in report order. */
export function collectRawFormFieldHeaders(rows: WoonbehoefteRawFormRow[]): string[] {
  const seen = new Set<string>();
  const headers: string[] = [];
  for (const row of rows) {
    for (const header of row.headers) {
      if (!seen.has(header)) {
        seen.add(header);
        headers.push(header);
      }
    }
  }
  return headers;
}

/** First version returns the CSV string close to verbatim. The one seam to change if a nicer JSON/multiline formatter is added later. */
export function serializeRawFormFieldValue(value: string): string {
  return value;
}
