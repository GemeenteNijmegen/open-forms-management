import { HttpClientError } from '../../http/HttpClientError';
import { parseObjectResource, parseObjectsPage, requireRegistrationAt } from '../ObjectsResponse';

function validObject(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://mijn-services.accp.nijmegen.nl/objects/api/v2/objects/c48c6597-8034-4a10-9885-eb5a0863a61d',
    uuid: 'c48c6597-8034-4a10-9885-eb5a0863a61d',
    type: 'https://example.org/objecttypes/nijmegenverzoek',
    record: {
      index: 1,
      typeVersion: 1,
      data: { formName: 'Aanmelden sportactiviteit' },
      startAt: '2026-08-20',
      endAt: null,
      registrationAt: '2026-08-20',
    },
    ...overrides,
  };
}

describe('parseObjectsPage', () => {
  it('accepts a realistic valid page fixture', () => {
    const body = {
      count: 2,
      next: 'https://mijn-services.accp.nijmegen.nl/objects/api/v2/objects?page=2',
      previous: null,
      results: [validObject(), validObject({ uuid: '2b22ef6f-5b84-4955-9875-b965faf1397b' })],
    };

    const page = parseObjectsPage(body);

    expect(page.count).toBe(2);
    expect(page.next).toBe(body.next);
    expect(page.previous).toBeNull();
    expect(page.results).toHaveLength(2);
    expect(page.results[0].uuid).toBe('c48c6597-8034-4a10-9885-eb5a0863a61d');
  });

  it('keeps unknown extra API properties without breaking', () => {
    const body = {
      count: 1,
      next: null,
      previous: null,
      results: [validObject({ someFutureField: 'value' })],
      apiVersionHint: '1.2.1',
    };

    const page = parseObjectsPage(body);

    expect(page.results).toHaveLength(1);
  });

  it('keeps record.data fully generic', () => {
    const body = { count: 1, next: null, previous: null, results: [validObject({ record: { ...validObject().record, data: { any: 'shape', nested: { a: 1 } } } })] };

    const page = parseObjectsPage(body);

    expect(page.results[0].record.data).toEqual({ any: 'shape', nested: { a: 1 } });
  });

  it.each([
    ['a string instead of an object', 'not-a-page'],
    ['null', null],
    ['an array', []],
  ])('rejects a page envelope that is %s', (_description, body) => {
    expect(() => parseObjectsPage(body)).toThrow(HttpClientError);
  });

  it('rejects a page missing count', () => {
    expect(() => parseObjectsPage({ next: null, previous: null, results: [] })).toThrow(HttpClientError);
  });

  it('rejects a page missing results', () => {
    expect(() => parseObjectsPage({ count: 0, next: null, previous: null })).toThrow(HttpClientError);
  });

  it('rejects a page with a non-string, non-null next', () => {
    expect(() => parseObjectsPage({ count: 1, next: 42, previous: null, results: [] })).toThrow(HttpClientError);
  });

  it('rejects a result item without a record', () => {
    expect(() => parseObjectsPage({ count: 1, next: null, previous: null, results: [{ uuid: 'x' }] })).toThrow(HttpClientError);
  });

  it('rejects a malformed record', () => {
    expect(() => parseObjectsPage({ count: 1, next: null, previous: null, results: [{ record: 'not-an-object' }] })).toThrow(HttpClientError);
  });
});

describe('parseObjectResource', () => {
  it('accepts a valid single object', () => {
    const object = parseObjectResource(validObject());

    expect(object.uuid).toBe('c48c6597-8034-4a10-9885-eb5a0863a61d');
    expect(object.record.registrationAt).toBe('2026-08-20');
  });

  it('rejects an object without a record', () => {
    expect(() => parseObjectResource({ uuid: 'x' })).toThrow(HttpClientError);
  });
});

describe('requireRegistrationAt', () => {
  it('returns a valid registrationAt', () => {
    expect(requireRegistrationAt(parseObjectResource(validObject()))).toBe('2026-08-20');
  });

  it('throws invalid-response for a missing registrationAt', () => {
    const object = parseObjectResource(validObject({ record: { ...validObject().record, registrationAt: undefined } }));

    expect(() => requireRegistrationAt(object)).toThrow(HttpClientError);
    try {
      requireRegistrationAt(object);
      fail('expected requireRegistrationAt to throw');
    } catch (error) {
      expect((error as HttpClientError).category).toBe('invalid-response');
    }
  });

  it('throws invalid-response for a malformed registrationAt', () => {
    const object = parseObjectResource(validObject({ record: { ...validObject().record, registrationAt: '20-08-2026' } }));

    expect(() => requireRegistrationAt(object)).toThrow(HttpClientError);
  });
});
