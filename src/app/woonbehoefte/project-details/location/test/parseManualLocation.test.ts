import { parseManualLocation } from '../parseManualLocation';

// Geojson.io-export met vijf unieke hoekpunten plus sluitpunt, uit 05-tests-en-samples.md.
const VALID_RING = [
  [5.861824, 51.8464654], [5.8623068, 51.8464787], [5.8622317, 51.8462732],
  [5.8619313, 51.84626], [5.8614271, 51.8463528], [5.861824, 51.8464654],
];

describe('parseManualLocation', () => {
  it('accepteert een losse Polygon', () => {
    const result = parseManualLocation(JSON.stringify({ type: 'Polygon', coordinates: [VALID_RING] }));
    expect(result).toEqual({ valid: true, polygon: { type: 'Polygon', coordinates: [VALID_RING] } });
  });

  it('accepteert de één-feature-FeatureCollection-export van geojson.io', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [VALID_RING] } }],
    });

    const result = parseManualLocation(text);

    expect(result).toEqual({ valid: true, polygon: { type: 'Polygon', coordinates: [VALID_RING] } });
  });

  it('accepteert een losse Feature, met properties in de invoer maar lege properties in de uitvoer', () => {
    const text = JSON.stringify({
      type: 'Feature', properties: { naam: 'projectgebied' }, geometry: { type: 'Polygon', coordinates: [VALID_RING] },
    });

    const result = parseManualLocation(text);

    expect(result).toEqual({ valid: true, polygon: { type: 'Polygon', coordinates: [VALID_RING] } });
  });

  it('weigert de drie-feature-export: een Nijmegen-rechthoek, een nul-oppervlak-polygon en de bedoelde polygon', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[5.8, 51.8], [5.9, 51.8], [5.9, 51.9], [5.8, 51.9], [5.8, 51.8]]] } },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[5.86, 51.85], [5.86, 51.85], [5.86, 51.85], [5.86, 51.85]]] } },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [VALID_RING] } },
      ],
    });

    expect(parseManualLocation(text)).toEqual({ valid: false, issue: 'MULTIPLE_FEATURES' });
  });

  it('weigert een FeatureCollection zonder features-array', () => {
    expect(parseManualLocation(JSON.stringify({ type: 'FeatureCollection' }))).toEqual({ valid: false, issue: 'INVALID_SHAPE' });
  });

  it('weigert een MultiPolygon', () => {
    const result = parseManualLocation(JSON.stringify({ type: 'MultiPolygon', coordinates: [[VALID_RING]] }));
    expect(result).toEqual({ valid: false, issue: 'INVALID_SHAPE' });
  });

  it('weigert een polygon met een gat', () => {
    const hole = [[5.8621, 51.8464], [5.8622, 51.8464], [5.8622, 51.8463], [5.8621, 51.8463], [5.8621, 51.8464]];
    const result = parseManualLocation(JSON.stringify({ type: 'Polygon', coordinates: [VALID_RING, hole] }));
    expect(result).toEqual({ valid: false, issue: 'HOLE' });
  });

  it('weigert een zelfkruisende bow-tie polygon', () => {
    const bowtie = [[5.85, 51.85], [5.86, 51.86], [5.86, 51.85], [5.85, 51.86], [5.85, 51.85]];
    const result = parseManualLocation(JSON.stringify({ type: 'Polygon', coordinates: [bowtie] }));
    expect(result).toEqual({ valid: false, issue: 'SELF_INTERSECTING' });
  });

  it('weigert verwisselde lengte-/breedtegraad', () => {
    const swapped = VALID_RING.map(([lon, lat]) => [lat, lon]);
    const result = parseManualLocation(JSON.stringify({ type: 'Polygon', coordinates: [swapped] }));
    expect(result).toEqual({ valid: false, issue: 'IMPLAUSIBLE_COORDINATES' });
  });

  it('geeft MISSING voor lege invoer', () => {
    expect(parseManualLocation('')).toEqual({ valid: false, issue: 'MISSING' });
    expect(parseManualLocation('   ')).toEqual({ valid: false, issue: 'MISSING' });
  });

  it('geeft UNREADABLE voor tekst die geen geldige JSON is', () => {
    expect(parseManualLocation('{niet geldige json')).toEqual({ valid: false, issue: 'UNREADABLE' });
  });

  it('geeft INVALID_SHAPE voor geldige JSON die geen object is', () => {
    expect(parseManualLocation('[1, 2, 3]')).toEqual({ valid: false, issue: 'INVALID_SHAPE' });
    expect(parseManualLocation('"tekst"')).toEqual({ valid: false, issue: 'INVALID_SHAPE' });
  });

  it('geeft TOO_LARGE voor invoer ruim boven de redelijke lengte, in plaats van te crashen op een enorme string', () => {
    const hugeText = `{"padding": "${'x'.repeat(25_000)}"}`;
    expect(parseManualLocation(hugeText)).toEqual({ valid: false, issue: 'TOO_LARGE' });
  });
});
