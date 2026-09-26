import { RawSourceRow } from './RepeatingGroupValueParser';

/**
 * Wonen, voorziening en KOVA lezen elk hun eigen bronvelden, maar op dezelfde manier: een lege string telt
 * niet als ingevuld, en een getal blijft een getal (ook 0). Deze twee functies zijn dus geen vertaalstap,
 * ze filteren alleen op het juiste JavaScript-type.
 */
export function stringField(row: RawSourceRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function numberField(row: RawSourceRow, key: string): number | undefined {
  const value = row[key];
  return typeof value === 'number' ? value : undefined;
}

/** Als de bronwaarde 'anders' is, staat de eigenlijke tekst in het bijbehorende ...Anders-veld. Een ontbrekende waarde mag leeg blijven, maar wordt nooit geraden. */
export function resolveAndersValue(code: string | undefined, andersValue: string | undefined): string {
  if (code === undefined) {
    return andersValue ?? '';
  }
  return code === 'anders' ? (andersValue ?? code) : code;
}
