const DUTCH_MONTHS_FULL = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

/** `YYYYMM` (e.g. `202802`) as a period a medewerker vaststelt, formatted `augustus 2028`. */
export function formatPeriodLabel(period: number | undefined): string {
  if (period === undefined) {
    return 'Nog niet vastgesteld';
  }
  const year = Math.floor(period / 100);
  const month = period % 100;
  return `${DUTCH_MONTHS_FULL[month - 1] ?? month} ${year}`;
}

export function periodYear(period: number | undefined): number | undefined {
  return period === undefined ? undefined : Math.floor(period / 100);
}

/** `YYYY-MM-DD` from a form/source date-only field, formatted `30 augustus 2028`. */
export function formatDutchDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const monthLabel = DUTCH_MONTHS_FULL[Number(month) - 1] ?? month;
  return `${Number(day)} ${monthLabel} ${year}`;
}

/** A full ISO timestamp, formatted `24 augustus 2026 15:42`. */
export function formatDutchDateTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  const day = date.getUTCDate();
  const monthLabel = DUTCH_MONTHS_FULL[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${monthLabel} ${year} ${hours}:${minutes}`;
}

/** A full ISO timestamp, formatted as date only: `24 augustus 2026`. Used for "Status sinds", where the time of day adds nothing. */
export function formatDutchDateOnly(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  const day = date.getUTCDate();
  const monthLabel = DUTCH_MONTHS_FULL[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${monthLabel} ${year}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${Math.round(kilobytes)} KB`;
  }
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}
