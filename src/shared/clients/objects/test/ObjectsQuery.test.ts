import { DataFilterOperator, serializeObjectsQuery, serializeOrdering } from '../ObjectsQuery';

describe('serializeObjectsQuery', () => {
  it.each<DataFilterOperator>(['exact', 'gt', 'gte', 'lt', 'lte', 'icontains'])('serializes a %s data filter', (operator) => {
    const params = serializeObjectsQuery({ dataFilters: [{ path: ['height'], operator, value: 100 }] });

    expect(params.get('data_attr')).toBe(`height__${operator}__100`);
  });

  it('serializes an in filter with pipe-separated values', () => {
    const params = serializeObjectsQuery({ dataFilters: [{ path: ['gebied'], operator: 'in', value: ['Dukenburg', 'Noord'] }] });

    expect(params.get('data_attr')).toBe('gebied__in__Dukenburg|Noord');
  });

  it('serializes a nested data filter path with double underscores', () => {
    const params = serializeObjectsQuery({ dataFilters: [{ path: ['dimensions', 'height'], operator: 'exact', value: 100 }] });

    expect(params.get('data_attr')).toBe('dimensions__height__exact__100');
  });

  it('serializes two data filters as two data_attr parameters', () => {
    const params = serializeObjectsQuery({
      dataFilters: [
        { path: ['height'], operator: 'exact', value: 100 },
        { path: ['naam'], operator: 'icontains', value: 'boom' },
      ],
    });

    expect(params.getAll('data_attr')).toEqual(['height__exact__100', 'naam__icontains__boom']);
  });

  it('allows commas in a data_attr value', () => {
    const params = serializeObjectsQuery({ dataFilters: [{ path: ['naam'], operator: 'icontains', value: 'Jansen, de' }] });

    expect(params.get('data_attr')).toBe('naam__icontains__Jansen, de');
  });

  it('rejects a data filter value containing a double underscore', () => {
    expect(() => serializeObjectsQuery({ dataFilters: [{ path: ['naam'], operator: 'exact', value: 'a__b' }] })).toThrow(
      'must not contain a double underscore',
    );
  });

  it('rejects an empty data filter path', () => {
    expect(() => serializeObjectsQuery({ dataFilters: [{ path: [], operator: 'exact', value: 'x' }] })).toThrow('must not be empty');
  });

  it('serializes a single ascending ordering field', () => {
    const params = serializeObjectsQuery({ ordering: { path: ['record', 'index'] } });

    expect(params.get('ordering')).toBe('record__index');
  });

  it('serializes a single descending ordering field', () => {
    const params = serializeObjectsQuery({ ordering: { path: ['record', 'registrationAt'], direction: 'desc' } });

    expect(params.get('ordering')).toBe('-record__registrationAt');
  });

  it('serializes multiple ordering fields with mixed direction', () => {
    const params = serializeObjectsQuery({
      ordering: [
        { path: ['record', 'data', 'length'], direction: 'desc' },
        { path: ['record', 'index'] },
      ],
    });

    expect(params.get('ordering')).toBe('-record__data__length,record__index');
  });

  it('serializes ordering via the exported serializeOrdering helper', () => {
    expect(serializeOrdering({ path: ['uuid'] })).toBe('uuid');
  });

  it('rejects an empty ordering field path', () => {
    expect(() => serializeObjectsQuery({ ordering: { path: [] } })).toThrow('must not be empty');
  });

  it('sets type, typeVersion, data_icontains, date and registrationDate', () => {
    const params = serializeObjectsQuery({
      type: 'https://example.org/objecttypes/1',
      typeVersion: 2,
      dataSearch: 'boom',
      date: '2026-08-20',
      registrationDate: '2026-08-19',
    });

    expect(params.get('type')).toBe('https://example.org/objecttypes/1');
    expect(params.get('typeVersion')).toBe('2');
    expect(params.get('data_icontains')).toBe('boom');
    expect(params.get('date')).toBe('2026-08-20');
    expect(params.get('registrationDate')).toBe('2026-08-19');
  });

  it('sets page and pageSize', () => {
    const params = serializeObjectsQuery({ page: 3, pageSize: 250 });

    expect(params.get('page')).toBe('3');
    expect(params.get('pageSize')).toBe('250');
  });

  it('rejects a pageSize above the API maximum of 500', () => {
    expect(() => serializeObjectsQuery({ pageSize: 501 })).toThrow('between 1 and 500');
  });

  it('rejects a non-positive page', () => {
    expect(() => serializeObjectsQuery({ page: 0 })).toThrow('positive integer');
  });

  it('rejects an invalid date', () => {
    expect(() => serializeObjectsQuery({ date: '20-08-2026' })).toThrow('ISO date');
  });

  it('rejects an invalid registrationDate', () => {
    expect(() => serializeObjectsQuery({ registrationDate: 'not-a-date' })).toThrow('ISO date');
  });

  it('url-encodes values with spaces and special characters', () => {
    const params = serializeObjectsQuery({ dataSearch: 'Aanmelden sportactiviteit' });

    expect(params.toString()).toBe('data_icontains=Aanmelden+sportactiviteit');
  });

  it('produces an empty query for an empty ObjectsQuery', () => {
    expect(serializeObjectsQuery({}).toString()).toBe('');
  });
});
