import { ProjectLocationIssueCode, ProjectLocationOutcome, ProjectPolygon } from './ProjectLocation';

/**
 * De 148 echte projectLocatie-waarden in de acceptatiedataset liggen tussen lon 5.78-5.89 en lat 51.80-51.89.
 * Deze grenzen geven daar een ruime marge (heel Nijmegen en omgeving) omheen, breed genoeg voor een dossier
 * elders in de gemeente, maar smal genoeg om verwisselde assen (lat/lon om) en RD New-coördinaten
 * (honderdduizenden) altijd te weigeren. Geen coördinatentransformatie, alleen deze plausibiliteitscheck.
 */
const PLAUSIBLE_LONGITUDE_RANGE = [5.5, 6.2] as const;
const PLAUSIBLE_LATITUDE_RANGE = [51.6, 52.1] as const;

/**
 * Drempelwaarde om te beslissen of een ring feitelijk geen oppervlak heeft, en dus een ontaarde polygon
 * is. De kleinste echte projectLocatie in de acceptatiedataset heeft een oppervlakte van ongeveer 3,7e-9;
 * deze drempel ligt daar ruim onder, zodat zo'n kleine maar echte polygon nooit ten onrechte wordt afgewezen.
 */
const ZERO_AREA_EPSILON = 1e-12;

/**
 * Bovengrens voor het aantal punten in de ring. De langste echte bronring in de acceptatiedataset heeft
 * 23 punten; deze grens ligt daar ruim boven, maar voorkomt dat een extreem grote handmatige tekening de
 * zelfkruisingscheck (die elk paar randen vergelijkt) onnodig zwaar maakt.
 */
const MAX_RING_POINTS = 1_000;

function invalid(issue: ProjectLocationIssueCode): ProjectLocationOutcome {
  return { valid: false, issue };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPosition(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

function isWithinPlausibleBounds(position: readonly [number, number]): boolean {
  const [lon, lat] = position;
  return lon >= PLAUSIBLE_LONGITUDE_RANGE[0] && lon <= PLAUSIBLE_LONGITUDE_RANGE[1]
    && lat >= PLAUSIBLE_LATITUDE_RANGE[0] && lat <= PLAUSIBLE_LATITUDE_RANGE[1];
}

/**
 * Bepaalt of de ring een echt oppervlak omsluit. Dit wordt gebruikt om een ontaarde polygon te herkennen:
 * als alle punten van de ring samenvallen of op één rechte lijn liggen, omsluiten ze geen vlak en is de
 * opgegeven "polygon" in werkelijkheid een punt of een lijn, geen bruikbare projectlocatie.
 */
function ringArea(ring: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function orientation(p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]): -1 | 0 | 1 {
  const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(value) < Number.EPSILON) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function onSegment(p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]): boolean {
  return q[0] <= Math.max(p[0], r[0]) && q[0] >= Math.min(p[0], r[0])
    && q[1] <= Math.max(p[1], r[1]) && q[1] >= Math.min(p[1], r[1]);
}

/**
 * Bepaalt of twee lijnstukken (twee randen van de polygon) elkaar ergens snijden, raken of gedeeltelijk
 * overlappen. Hiermee wordt verderop getest of twee niet-aangrenzende randen van de polygon elkaar
 * kruisen; is dat zo, dan tekent de polygon over zichzelf heen en is hij zelfkruisend.
 */
function segmentsIntersect(
  p1: readonly [number, number], p2: readonly [number, number], p3: readonly [number, number], p4: readonly [number, number],
): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }
  if (o1 === 0 && onSegment(p1, p3, p2)) {
    return true;
  }
  if (o2 === 0 && onSegment(p1, p4, p2)) {
    return true;
  }
  if (o3 === 0 && onSegment(p3, p1, p4)) {
    return true;
  }
  if (o4 === 0 && onSegment(p3, p2, p4)) {
    return true;
  }
  return false;
}

/**
 * Alleen niet-aangrenzende randen vergelijken: twee aangrenzende randen delen bewust hun hoekpunt, dat is
 * een normale polygon, geen zelfkruising.
 */
function ringIsSelfIntersecting(ring: readonly (readonly [number, number])[]): boolean {
  const edgeCount = ring.length - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    for (let j = i + 2; j < edgeCount; j += 1) {
      if (i === 0 && j === edgeCount - 1) {
        continue;
      }
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Eén gedeelde controle voor zowel de bronlocatie (parseSubmittedLocation) als de handmatige invoer
 * (parseManualLocation): al geparste JSON/Python-waarde in, een geometrie of een beperkte reden-code uit.
 * Geen ringrichtingnormalisatie en geen coördinatenreparatie, alleen keuren.
 */
export function checkProjectPolygon(value: unknown): ProjectLocationOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('INVALID_SHAPE');
  }
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'Polygon' || !Array.isArray(candidate.coordinates)) {
    return invalid('INVALID_SHAPE');
  }

  const rings = candidate.coordinates;
  if (rings.length === 0) {
    return invalid('INVALID_SHAPE');
  }
  if (rings.length > 1) {
    return invalid('HOLE');
  }

  const ring = rings[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    return invalid('INVALID_SHAPE');
  }
  if (ring.length > MAX_RING_POINTS) {
    return invalid('TOO_LARGE');
  }
  if (!ring.every(isPosition)) {
    return invalid('INVALID_SHAPE');
  }
  const positions = ring as [number, number][];
  const [firstLon, firstLat] = positions[0];
  const [lastLon, lastLat] = positions[positions.length - 1];
  if (firstLon !== lastLon || firstLat !== lastLat) {
    return invalid('INVALID_SHAPE');
  }

  if (!positions.every(isWithinPlausibleBounds)) {
    return invalid('IMPLAUSIBLE_COORDINATES');
  }
  /*
   * Deze check loopt bewust vóór de oppervlaktecheck: bij een zelfkruisende ring (bijvoorbeeld een
   * symmetrische bow-tie) kan de berekende oppervlakte toevallig op 0 uitkomen, ook al liggen de punten
   * niet allemaal op elkaar of op één lijn. Zonder deze volgorde zou zo'n polygon dan ten onrechte als
   * "nul oppervlak" worden afgewezen, terwijl zelfkruising de eigenlijke reden is.
   */
  if (ringIsSelfIntersecting(positions)) {
    return invalid('SELF_INTERSECTING');
  }
  if (ringArea(positions) < ZERO_AREA_EPSILON) {
    return invalid('ZERO_AREA');
  }

  const polygon: ProjectPolygon = { type: 'Polygon', coordinates: [positions] };
  return { valid: true, polygon };
}
