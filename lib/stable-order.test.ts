import { describe, it, expect } from 'vitest';
import { keepOrder } from './stable-order';

describe('keepOrder', () => {
  it('keeps each item where it was when the list is reordered', () => {
    expect(keepOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
  });
  it('puts new items on the end and drops gone ones', () => {
    expect(keepOrder(['a', 'b', 'c'], ['d', 'c', 'a'])).toEqual(['a', 'c', 'd']);
  });
  it('takes the first list as it comes', () => {
    expect(keepOrder([], ['b', 'a'])).toEqual(['b', 'a']);
  });
});
