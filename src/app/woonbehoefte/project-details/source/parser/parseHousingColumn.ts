import { randomUUID } from 'crypto';
import { buildOtherDetails } from './buildOtherDetails';
import { numberField, resolveAndersValue, stringField } from './RawSourceRowFields';
import { RawSourceRow } from './RepeatingGroupValueParser';
import { HousingLine, HousingLineType } from '../../domain/ProjectDetails';

const HOUSING_EXCLUDED_KEYS = new Set([
  'aantalWoningen', 'typeWoonobject', 'aantalAansluitingen',
  'aansluitingKleinverbruik', 'aansluitingKleinverbruikAnders', 'aansluitingGrootverbruik', 'aansluitingGrootverbruikAnders',
]);

/**
 * woonhuis wordt altijd Woonhuis. Elke andere bronwaarde is een gecombineerde appartementbron: met de
 * collectief-vlag op nee wordt dat Appartementen, met de vlag op ja en precies één zo'n bronregel
 * Collectief wonen, en met de vlag op ja en meerdere van die bronregels Appartementen/collectief wonen.
 * Er komt nooit een extra werkregel bij enkel op basis van de vlag.
 */
function deriveHousingLineType(typeWoonobject: string | undefined, isCollectiveHousing: boolean, apartmentRowCount: number): HousingLineType {
  if (typeWoonobject === 'woonhuis') {
    return 'WOONHUIS';
  }
  if (!isCollectiveHousing) {
    return 'APPARTEMENTEN';
  }
  return apartmentRowCount === 1 ? 'COLLECTIEF_WONEN' : 'APPARTEMENTEN_COLLECTIEF_WONEN';
}

function buildHousingLine(row: RawSourceRow, type: HousingLineType, order: number): HousingLine {
  // In de echte data is dit veld 'ja', 'nee' of leeg, niet enkel wel-of-niet ingevuld: een 'nee' hier
  // betekent geen grootverbruik, en moet dus de kleinverbruik-tak gebruiken.
  const isGrootverbruik = stringField(row, 'isGrootverbruikaansluiting') === 'ja';
  const connectionType = isGrootverbruik
    ? resolveAndersValue(stringField(row, 'aansluitingGrootverbruik'), stringField(row, 'aansluitingGrootverbruikAnders'))
    : resolveAndersValue(stringField(row, 'aansluitingKleinverbruik'), stringField(row, 'aansluitingKleinverbruikAnders'));
  const homesAccordingToForm = numberField(row, 'aantalWoningen');

  return {
    lineId: randomUUID(),
    order,
    type,
    connectionCount: numberField(row, 'aantalAansluitingen') ?? 0,
    connectionType,
    otherDetails: buildOtherDetails(row, HOUSING_EXCLUDED_KEYS),
    ...(homesAccordingToForm !== undefined ? { homesAccordingToForm } : {}),
  };
}

/** Wonen krijgt nooit groepering: elke bronregel in woningenEnAansluitingen wordt zijn eigen werkregel, ook als twee regels toevallig identiek zijn. */
export function buildHousingLines(rows: RawSourceRow[], isCollectiveHousing: boolean): Record<string, HousingLine> {
  const apartmentRowCount = rows.filter((row) => stringField(row, 'typeWoonobject') !== 'woonhuis').length;
  const lines: Record<string, HousingLine> = {};
  rows.forEach((row, order) => {
    const type = deriveHousingLineType(stringField(row, 'typeWoonobject'), isCollectiveHousing, apartmentRowCount);
    const line = buildHousingLine(row, type, order);
    lines[line.lineId] = line;
  });
  return lines;
}
