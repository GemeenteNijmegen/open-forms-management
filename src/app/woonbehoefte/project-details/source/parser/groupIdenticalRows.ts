import { RawSourceRow } from './RepeatingGroupValueParser';

/**
 * Voorziening- en KOVA-bronregels hebben geen eigen aantalveld: het aantal aansluitingen komt voort uit
 * hoeveel identieke bronregels er zijn. Wonen wordt nooit gegroepeerd en gebruikt dit bestand dus niet.
 */
export interface RowGroup {
  row: RawSourceRow;
  count: number;
  order: number;
}

/**
 * Vergelijkt alle veldnamen en waarden van een bronregel; de volgorde van de velden onderling maakt niets
 * uit. Alleen echt identieke bronregels tellen mee als hetzelfde; een regel die op één veld afwijkt blijft
 * een eigen regel, ook al lijkt hij verder sterk op een andere.
 */
function canonicalSignature(row: RawSourceRow): string {
  return JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key]]));
}

export function groupIdenticalRows(rows: RawSourceRow[]): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  rows.forEach((row, index) => {
    const signature = canonicalSignature(row);
    const existing = groups.get(signature);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(signature, { row, count: 1, order: index });
    }
  });
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
