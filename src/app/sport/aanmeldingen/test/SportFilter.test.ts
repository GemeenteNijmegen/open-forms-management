import { resolveSportFilter } from '../SportFilter';

const allowedDistricts = ['dukenburg', 'lindenholt', 'nijmegenNoord'] as const;

describe('resolveSportFilter', () => {
  it('defaults to every allowed district and both types when the page is opened without a filter', () => {
    expect(resolveSportFilter(undefined, [...allowedDistricts])).toEqual({
      districts: [...allowedDistricts],
      types: ['kind', 'volwassene'],
    });
  });

  it('defaults the same way when the querystring has no filterSubmitted marker at all', () => {
    expect(resolveSportFilter({ district: 'dukenburg' }, [...allowedDistricts])).toEqual({
      districts: [...allowedDistricts],
      types: ['kind', 'volwassene'],
    });
  });

  it('narrows to exactly the requested district and type once filterSubmitted is set', () => {
    expect(resolveSportFilter({ filterSubmitted: '1', district: 'dukenburg', type: 'kind' }, [...allowedDistricts])).toEqual({
      districts: ['dukenburg'],
      types: ['kind'],
    });
  });

  it('ignores a requested district the medewerker is not allowed to see, without erroring', () => {
    expect(resolveSportFilter({ filterSubmitted: '1', district: 'dukenburg,nijmegenCentrum', type: 'kind' }, [...allowedDistricts])).toEqual({
      districts: ['dukenburg'],
      types: ['kind'],
    });
  });

  it('returns an empty district list, not the default, when filterSubmitted is set but every district was unchecked', () => {
    expect(resolveSportFilter({ filterSubmitted: '1', type: 'kind' }, [...allowedDistricts])).toEqual({
      districts: [],
      types: ['kind'],
    });
  });

  it('returns an empty type list, not the default, when filterSubmitted is set but every type was unchecked', () => {
    expect(resolveSportFilter({ filterSubmitted: '1', district: 'dukenburg' }, [...allowedDistricts])).toEqual({
      districts: ['dukenburg'],
      types: [],
    });
  });

  it('splits comma-joined values from the API Gateway HTTP API payload format', () => {
    expect(resolveSportFilter({ filterSubmitted: '1', district: 'dukenburg,lindenholt', type: 'kind,volwassene' }, [...allowedDistricts])).toEqual({
      districts: ['dukenburg', 'lindenholt'],
      types: ['kind', 'volwassene'],
    });
  });
});
