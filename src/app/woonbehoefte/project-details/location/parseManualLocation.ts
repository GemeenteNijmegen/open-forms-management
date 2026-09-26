import { checkProjectPolygon } from './checkProjectPolygon';
import { ProjectLocationOutcome } from './ProjectLocation';

/**
 * Bovengrens voor de geplakte tekst (in tekens). Ruim boven een redelijke handgetekende polygon uit
 * geojson.io, ver onder de DynamoDB-itemgrens; begrenst zowel de POST-body als het werk dat de parser en
 * checkProjectPolygon verderop nog moeten doen.
 */
const MAX_MANUAL_LOCATION_LENGTH = 20_000;

interface ResolvedGeometry {
  readonly ok: true;
  readonly geometry: unknown;
}

interface UnresolvedGeometry {
  readonly ok: false;
  readonly issue: 'MULTIPLE_FEATURES' | 'INVALID_SHAPE';
}

/**
 * Herkent zowel een losse Polygon als de één-feature-FeatureCollection-export van geojson.io en geeft de
 * geometrie terug die checkProjectPolygon moet keuren. Bij meer dan één feature wordt geweigerd: de code
 * kiest nooit zelf welk van meerdere getekende vlakken bedoeld is.
 */
function resolveGeometry(parsed: unknown): ResolvedGeometry | UnresolvedGeometry {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, issue: 'INVALID_SHAPE' };
  }
  const candidate = parsed as { type?: unknown; features?: unknown };
  if (candidate.type !== 'FeatureCollection') {
    return { ok: true, geometry: parsed };
  }
  if (!Array.isArray(candidate.features)) {
    return { ok: false, issue: 'INVALID_SHAPE' };
  }
  if (candidate.features.length !== 1) {
    return { ok: false, issue: 'MULTIPLE_FEATURES' };
  }
  const feature = candidate.features[0] as { type?: unknown; geometry?: unknown };
  if (feature?.type !== 'Feature') {
    return { ok: false, issue: 'INVALID_SHAPE' };
  }
  return { ok: true, geometry: feature.geometry };
}

/**
 * Parst wat een medewerker in het tekstveld plakt. Dit is gewone JSON, niet de Python-achtige notatie van
 * de bron-CSV. Levert dezelfde ProjectLocationOutcome als de bronlocatie op, zodat beide dezelfde
 * geometriecontrole (checkProjectPolygon) delen.
 */
export function parseManualLocation(text: string): ProjectLocationOutcome {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { valid: false, issue: 'MISSING' };
  }
  if (trimmed.length > MAX_MANUAL_LOCATION_LENGTH) {
    return { valid: false, issue: 'TOO_LARGE' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { valid: false, issue: 'UNREADABLE' };
  }

  const resolved = resolveGeometry(parsed);
  if (!resolved.ok) {
    return { valid: false, issue: resolved.issue };
  }
  return checkProjectPolygon(resolved.geometry);
}
