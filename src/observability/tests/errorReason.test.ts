import { errorReason } from '../errorReason';

describe('errorReason', () => {
  it('returns the message of an Error', () => {
    expect(errorReason(new Error('something went wrong'))).toBe('something went wrong');
  });

  it('stringifies a non-Error value', () => {
    expect(errorReason('plain string')).toBe('plain string');
    expect(errorReason({ some: 'object' })).toBe('[object Object]');
  });
});
