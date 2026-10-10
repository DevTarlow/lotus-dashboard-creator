import { describe, expect, it } from 'vitest';
import { moveItem } from '@/lib/utils';

describe('moveItem', () => {
  const items = ['a', 'b', 'c', 'd'];

  it('moves an item forward', () => {
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item backward', () => {
    expect(moveItem(items, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves an item to the last index', () => {
    expect(moveItem(items, 1, 3)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('clamps an out-of-range destination instead of throwing', () => {
    expect(moveItem(items, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(items, 3, -5)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('ignores a source index that is out of range', () => {
    expect(moveItem(items, 9, 0)).toEqual(items);
    expect(moveItem(items, -1, 0)).toEqual(items);
  });

  it('returns an equal copy for a no-op move', () => {
    const result = moveItem(items, 2, 2);
    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });

  it('never mutates the input array', () => {
    const original = [...items];
    moveItem(items, 0, 3);
    expect(items).toEqual(original);
  });

  it('handles empty and single item arrays', () => {
    expect(moveItem([], 0, 0)).toEqual([]);
    expect(moveItem(['only'], 0, 0)).toEqual(['only']);
  });

  it('preserves object identity of the moved items', () => {
    const first = { id: 'first' };
    const second = { id: 'second' };
    const result = moveItem([first, second], 0, 1);
    expect(result[0]).toBe(second);
    expect(result[1]).toBe(first);
  });
});
