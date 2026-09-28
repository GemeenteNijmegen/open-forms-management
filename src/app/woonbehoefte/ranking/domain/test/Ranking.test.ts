import { insertIntoOrder, moveWithinOrder, positionInOrder, removeFromOrder } from '../Ranking';

const ORDER = ['OF-1', 'OF-2', 'OF-3', 'OF-4', 'OF-5'];

describe('insertIntoOrder', () => {
  it('inserts at the start, middle and end (append)', () => {
    expect(insertIntoOrder(ORDER, 'OF-NEW', 1)).toEqual(['OF-NEW', 'OF-1', 'OF-2', 'OF-3', 'OF-4', 'OF-5']);
    expect(insertIntoOrder(ORDER, 'OF-NEW', 3)).toEqual(['OF-1', 'OF-2', 'OF-NEW', 'OF-3', 'OF-4', 'OF-5']);
    expect(insertIntoOrder(ORDER, 'OF-NEW', 6)).toEqual(['OF-1', 'OF-2', 'OF-3', 'OF-4', 'OF-5', 'OF-NEW']);
  });

  it('rejects a case that is already ranked', () => {
    expect(() => insertIntoOrder(ORDER, 'OF-3', 1)).toThrow(/already ranked/);
  });

  it('rejects a position outside 1..N+1', () => {
    expect(() => insertIntoOrder(ORDER, 'OF-NEW', 0)).toThrow(/out of range/);
    expect(() => insertIntoOrder(ORDER, 'OF-NEW', 7)).toThrow(/out of range/);
  });
});

describe('moveWithinOrder', () => {
  it('moves up and down over multiple positions, begin/middle/end', () => {
    expect(moveWithinOrder(ORDER, 'OF-5', 1)).toEqual(['OF-5', 'OF-1', 'OF-2', 'OF-3', 'OF-4']);
    expect(moveWithinOrder(ORDER, 'OF-1', 5)).toEqual(['OF-2', 'OF-3', 'OF-4', 'OF-5', 'OF-1']);
    expect(moveWithinOrder(ORDER, 'OF-2', 4)).toEqual(['OF-1', 'OF-3', 'OF-4', 'OF-2', 'OF-5']);
    expect(moveWithinOrder(ORDER, 'OF-4', 2)).toEqual(['OF-1', 'OF-4', 'OF-2', 'OF-3', 'OF-5']);
  });

  it('is a no-op (identical order) when moved to its own position', () => {
    expect(moveWithinOrder(ORDER, 'OF-3', 3)).toEqual(ORDER);
  });

  it('rejects a case that is not ranked', () => {
    expect(() => moveWithinOrder(ORDER, 'OF-UNRANKED', 1)).toThrow(/not ranked/);
  });

  it('rejects a position outside 1..N', () => {
    expect(() => moveWithinOrder(ORDER, 'OF-1', 0)).toThrow(/out of range/);
    expect(() => moveWithinOrder(ORDER, 'OF-1', 6)).toThrow(/out of range/);
  });
});

describe('removeFromOrder', () => {
  it('removes from the start, middle and end, shifting successors up', () => {
    expect(removeFromOrder(ORDER, 'OF-1')).toEqual(['OF-2', 'OF-3', 'OF-4', 'OF-5']);
    expect(removeFromOrder(ORDER, 'OF-3')).toEqual(['OF-1', 'OF-2', 'OF-4', 'OF-5']);
    expect(removeFromOrder(ORDER, 'OF-5')).toEqual(['OF-1', 'OF-2', 'OF-3', 'OF-4']);
  });

  it('is a no-op for a case that is not ranked', () => {
    expect(removeFromOrder(ORDER, 'OF-UNRANKED')).toEqual(ORDER);
  });
});

describe('positionInOrder', () => {
  it('returns the 1-based position, or undefined when unranked', () => {
    expect(positionInOrder(ORDER, 'OF-1')).toBe(1);
    expect(positionInOrder(ORDER, 'OF-5')).toBe(5);
    expect(positionInOrder(ORDER, 'OF-UNRANKED')).toBeUndefined();
  });
});
