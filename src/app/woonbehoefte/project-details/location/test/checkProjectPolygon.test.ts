import { checkProjectPolygon } from '../checkProjectPolygon';

// Geojson.io-export met vijf unieke hoekpunten plus sluitpunt, uit 05-tests-en-samples.md.
const VALID_RING = [
  [5.861824, 51.8464654], [5.8623068, 51.8464787], [5.8622317, 51.8462732],
  [5.8619313, 51.84626], [5.8614271, 51.8463528], [5.861824, 51.8464654],
];

// Vier verschillende hoekpunten (bow-tie), niet slechts een dubbel punt.
const BOWTIE_RING = [
  [5.85, 51.85], [5.86, 51.86], [5.86, 51.85], [5.85, 51.86], [5.85, 51.85],
];

describe('checkProjectPolygon', () => {
  it('accepteert een gesloten, niet-zelfkruisende ring binnen Nijmegen', () => {
    const result = checkProjectPolygon({ type: 'Polygon', coordinates: [VALID_RING] });
    expect(result).toEqual({ valid: true, polygon: { type: 'Polygon', coordinates: [VALID_RING] } });
  });

  it('weigert een tweede ring (gat)', () => {
    const hole = [[5.8621, 51.8464], [5.8622, 51.8464], [5.8622, 51.8463], [5.8621, 51.8463], [5.8621, 51.8464]];
    const result = checkProjectPolygon({ type: 'Polygon', coordinates: [VALID_RING, hole] });
    expect(result).toEqual({ valid: false, issue: 'HOLE' });
  });

  it('weigert een zelfkruisende bow-tie ring', () => {
    const result = checkProjectPolygon({ type: 'Polygon', coordinates: [BOWTIE_RING] });
    expect(result).toEqual({ valid: false, issue: 'SELF_INTERSECTING' });
  });

  it('weigert een ring met nul oppervlak (alle punten gelijk)', () => {
    const point = [5.86, 51.85];
    const ring = [point, point, point, point];
    const result = checkProjectPolygon({ type: 'Polygon', coordinates: [ring] });
    expect(result).toEqual({ valid: false, issue: 'ZERO_AREA' });
  });

  it('weigert een ring met nul oppervlak (alle punten op één lijn)', () => {
    const ring = [[5.85, 51.85], [5.86, 51.85], [5.87, 51.85], [5.85, 51.85]];
    const result = checkProjectPolygon({ type: 'Polygon', coordinates: [ring] });
    expect(result).toEqual({ valid: false, issue: 'ZERO_AREA' });
  });

  it('weigert verwisselde lengte-/breedtegraad', () => {
    const swapped = VALID_RING.map(([lon, lat]) => [lat, lon]);
    const result = checkProjectPolygon({ type: 'Polygon', coordinates: [swapped] });
    expect(result).toEqual({ valid: false, issue: 'IMPLAUSIBLE_COORDINATES' });
  });

  it('weigert RD New-achtige coördinaten', () => {
    const rdRing = [[186000, 430000], [186100, 430000], [186100, 430100], [186000, 430100], [186000, 430000]];
    const result = checkProjectPolygon({ type: 'Polygon', coordinates: [rdRing] });
    expect(result).toEqual({ valid: false, issue: 'IMPLAUSIBLE_COORDINATES' });
  });

  it('weigert een niet-gesloten ring', () => {
    const openRing = VALID_RING.slice(0, -1);
    const result = checkProjectPolygon({ type: 'Polygon', coordinates: [openRing] });
    expect(result).toEqual({ valid: false, issue: 'INVALID_SHAPE' });
  });

  it('weigert een MultiPolygon', () => {
    const result = checkProjectPolygon({ type: 'MultiPolygon', coordinates: [[VALID_RING]] });
    expect(result).toEqual({ valid: false, issue: 'INVALID_SHAPE' });
  });

  it('weigert waarden die geen object zijn', () => {
    expect(checkProjectPolygon('niet een polygon')).toEqual({ valid: false, issue: 'INVALID_SHAPE' });
    expect(checkProjectPolygon(null)).toEqual({ valid: false, issue: 'INVALID_SHAPE' });
    expect(checkProjectPolygon([1, 2, 3])).toEqual({ valid: false, issue: 'INVALID_SHAPE' });
  });
});
