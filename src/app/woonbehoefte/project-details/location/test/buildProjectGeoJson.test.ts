import { buildProjectGeoJson } from '../buildProjectGeoJson';

describe('buildProjectGeoJson', () => {
  it('bouwt één FeatureCollection met precies één Feature, lege properties en de opgegeven geometrie ongewijzigd', () => {
    const polygon = { type: 'Polygon' as const, coordinates: [[[5.86, 51.85], [5.87, 51.85], [5.87, 51.86], [5.86, 51.85]]] };

    const geoJson = buildProjectGeoJson(polygon);

    expect(geoJson.type).toBe('FeatureCollection');
    expect(geoJson.features).toHaveLength(1);
    expect(geoJson.features[0]).toEqual({ type: 'Feature', properties: {}, geometry: polygon });
  });
});
