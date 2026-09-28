import { checkProjectPolygon } from './checkProjectPolygon';
import { ProjectLocationOutcome } from './ProjectLocation';
import { parseRepeatingGroupValue } from '../source/parser/RepeatingGroupValueParser';

/**
 * De projectLocatie-cel is, net als de herhalende groepen, een Python-achtige dict-notatie, bijvoorbeeld
 * {'type': 'Polygon', 'coordinates': [[[lon, lat], ...]]}, geen JSON; JSON.parse loopt hierop stuk. Een
 * lege of ontbrekende cel is een afwezige locatie, geen parsefout.
 */
export function parseSubmittedLocation(value: string | undefined): ProjectLocationOutcome {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    return { valid: false, issue: 'MISSING' };
  }

  let parsed: unknown;
  try {
    parsed = parseRepeatingGroupValue(trimmed);
  } catch {
    return { valid: false, issue: 'UNREADABLE' };
  }

  return checkProjectPolygon(parsed);
}
