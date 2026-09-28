import { randomUUID } from 'crypto';
import { buildOtherDetails } from './buildOtherDetails';
import { groupIdenticalRows, RowGroup } from './groupIdenticalRows';
import { resolveAndersValue, stringField } from './RawSourceRowFields';
import { RawSourceRow } from './RepeatingGroupValueParser';
import { KovaLine } from '../../domain/ProjectDetails';

/** Het functieveld heet in de bron kovaActiviteit, niet kovaFunctie: geverifieerd tegen een echte export (woonbehoefte-overzicht-geen-persoonsgegevens.xlsx). */
const KOVA_EXCLUDED_KEYS = new Set(['kovaActiviteit', 'kovaActiviteitAnders', 'kovaAansluiting', 'kovaAansluitingAnders']);

function buildKovaLine(group: RowGroup): KovaLine {
  const { row } = group;
  return {
    lineId: randomUUID(),
    order: group.order,
    function: resolveAndersValue(stringField(row, 'kovaActiviteit'), stringField(row, 'kovaActiviteitAnders')),
    connectionCount: group.count,
    connectionType: resolveAndersValue(stringField(row, 'kovaAansluiting'), stringField(row, 'kovaAansluitingAnders')),
    otherDetails: buildOtherDetails(row, KOVA_EXCLUDED_KEYS),
  };
}

export function buildKovaLines(rows: RawSourceRow[]): Record<string, KovaLine> {
  const groups = groupIdenticalRows(rows);
  return Object.fromEntries(groups.map((group) => {
    const line = buildKovaLine(group);
    return [line.lineId, line];
  }));
}
