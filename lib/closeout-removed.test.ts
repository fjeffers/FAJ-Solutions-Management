import { describe, expect, it } from 'vitest';
import { listFor, parseCloseoutLists } from './closeout';

describe('Removed closeout lists', () => {
  it('leaves the LDS 47-item list off every job; LDS jobs get the list with no words', () => {
    const lists = parseCloseoutLists([
      { id: '1', name: 'Standard', keywords: [], items: ['Photos'], sort: 9 },
      { id: '2', name: 'LDS church install (5 days)', keywords: ['lds-'], items: ['Day 1 · Teams check-in on arrival; Smartsheet checkout before leaving'], sort: 3 },
    ]);
    expect(lists.map((l) => l.name)).toEqual(['Standard']);
    expect(listFor(lists, 'LDS-1103 - 5333202 - FAYETTEVILLE', '').name).toBe('Standard');
  });
});
