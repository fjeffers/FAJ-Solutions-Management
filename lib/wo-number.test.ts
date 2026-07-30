import { describe, it, expect } from 'vitest';
import { nextWorkOrderNumber, FIRST_WO_NUMBER } from './wo-number';

describe('nextWorkOrderNumber', () => {
  it('starts the sequence when there are no FAJ-numbered jobs', () => {
    expect(nextWorkOrderNumber([])).toBe('1001');
    expect(Number(nextWorkOrderNumber([]))).toBe(FIRST_WO_NUMBER);
  });

  // The reason this module exists: all 61 production work orders are 8-digit
  // numbers inherited from a FieldNation ticket, including internal ones.
  it('ignores imported ticket numbers so the sequence stays readable', () => {
    const production = ['18934129', '19016762', '19101298', '19101310', 'WO-622825'];
    expect(nextWorkOrderNumber(production)).toBe('1001');
  });

  it('continues from the highest FAJ number, not the highest number overall', () => {
    expect(nextWorkOrderNumber(['1001', '1002', '19101298'])).toBe('1003');
  });

  it('ignores non-numeric references entirely', () => {
    expect(nextWorkOrderNumber(['WO-622825', 'Q-2026-004', ''])).toBe('1001');
  });

  it('never hands out a number already in use', () => {
    // 1003 typed by hand out of sequence — the next must skip past it.
    expect(nextWorkOrderNumber(['1001', '1002', '1003'])).toBe('1004');
    expect(nextWorkOrderNumber(['1001', '1003'])).toBe('1004');
  });

  it('tolerates nulls, blanks and stray whitespace', () => {
    expect(nextWorkOrderNumber([null, undefined, '  ', '1005'])).toBe('1006');
    expect(nextWorkOrderNumber([' 1005 '])).toBe('1006');
  });

  it('produces a distinct number for each job in a run', () => {
    // What an 18-site go-back list does: approve sequentially, each seeing the
    // one before. Parallel approval would collide, which is why the caller
    // awaits each in turn.
    const existing = ['19101298'];
    const issued: string[] = [];
    for (let i = 0; i < 18; i += 1) {
      const n = nextWorkOrderNumber([...existing, ...issued]);
      issued.push(n);
    }
    expect(new Set(issued).size).toBe(18);
    expect(issued[0]).toBe('1001');
    expect(issued.at(-1)).toBe('1018');
  });
});
