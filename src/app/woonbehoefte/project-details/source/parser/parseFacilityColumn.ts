import { randomUUID } from 'crypto';
import { buildOtherDetails } from './buildOtherDetails';
import { groupIdenticalRows, RowGroup } from './groupIdenticalRows';
import { resolveAndersValue, stringField } from './RawSourceRowFields';
import { RawSourceRow } from './RepeatingGroupValueParser';
import { FacilityLine } from '../../domain/ProjectDetails';

const FACILITY_EXCLUDED_KEYS = new Set([
  'collectieveVoorzieningType', 'collectieveVoorzieningTypeAnders', 'collectieveVoorzieningAansluiting', 'collectieveVoorzieningAansluitingAnders',
]);

function buildFacilityLine(group: RowGroup): FacilityLine {
  const { row } = group;
  return {
    lineId: randomUUID(),
    order: group.order,
    facilityType: resolveAndersValue(stringField(row, 'collectieveVoorzieningType'), stringField(row, 'collectieveVoorzieningTypeAnders')),
    connectionCount: group.count,
    connectionType: resolveAndersValue(stringField(row, 'collectieveVoorzieningAansluiting'), stringField(row, 'collectieveVoorzieningAansluitingAnders')),
    otherDetails: buildOtherDetails(row, FACILITY_EXCLUDED_KEYS),
  };
}

export function buildFacilityLines(rows: RawSourceRow[]): Record<string, FacilityLine> {
  const groups = groupIdenticalRows(rows);
  return Object.fromEntries(groups.map((group) => {
    const line = buildFacilityLine(group);
    return [line.lineId, line];
  }));
}
