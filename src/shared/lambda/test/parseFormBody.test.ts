import { parseFormBody } from '../parseFormBody';

describe('parseFormBody', () => {
  it('returns an empty URLSearchParams for a missing body', () => {
    expect(parseFormBody(undefined, false).toString()).toBe('');
  });

  it('parses a plain application/x-www-form-urlencoded body', () => {
    expect(parseFormBody('a=1&b=2', false).getAll('a')).toEqual(['1']);
  });

  it('decodes a base64-encoded body before parsing', () => {
    const encoded = Buffer.from('a=1&b=2').toString('base64');
    expect(parseFormBody(encoded, true).get('b')).toBe('2');
  });
});
