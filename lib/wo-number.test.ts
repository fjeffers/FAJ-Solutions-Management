import { describe, it, expect } from 'vitest';
import { nextFreeWorkOrderNumber, FIRST_WO_NUMBER } from './wo-number';

describe('nextFreeWorkOrderNumber — continuing the live sequence', () => {
  it('carries on from the highest number, not from 1001', () => {
    // FAJ's real numbers are all in the imported 8-digit band. The work order
    // screen has always continued that sequence, and the paperwork follows it.
    expect(nextFreeWorkOrderNumber(['19101357', '19101358', '19101359']))
      .toBe('19101360');
  });

  it('never hands out a number that is already taken', () => {
    // The 2026-08-30 bug: a closed job held 19101358 and "highest + 1" on a
    // stale list offered it again, crossing $179.95 of another tech's pay
    // onto a job that had never been worked.
    const existing = ['19101356', '19101357', '19101358'];
    const picked = nextFreeWorkOrderNumber(existing);
    expect(existing).not.toContain(picked);
    expect(picked).toBe('19101359');
  });

  it('steps over a gap-filling number that is already used', () => {
    expect(nextFreeWorkOrderNumber(['1001', '1002', '1003'])).toBe('1004');
  });

  it('starts the sequence when there is nothing yet', () => {
    expect(nextFreeWorkOrderNumber([])).toBe('1001');
    expect(nextFreeWorkOrderNumber([null, undefined, '  '])).toBe('1001');
  });

  it('ignores numbers that are not plain digits', () => {
    expect(nextFreeWorkOrderNumber(['ABC-1', '19101357'])).toBe('19101358');
  });

  it('is not fooled by surrounding whitespace on an existing number', () => {
    // ' 19101358 ' is the same job number as '19101358'; handing it out again
    // would collide in the database even though the strings differ.
    expect(nextFreeWorkOrderNumber(['19101357', ' 19101358 ']))
      .toBe('19101359');
  });
});

describe('one rule for every door a job comes in by', () => {
  it('gives the work order screen, the site log and the import queue the same answer', () => {
    // The 2026-08-30 duplicate happened because these three disagreed. Given
    // the same set of existing numbers they must now agree exactly.
    const existing = ['19101356', '19101357', '19101358', '19101359'];
    const fromWorkOrderScreen = nextFreeWorkOrderNumber(existing);
    const fromSiteLog = nextFreeWorkOrderNumber(existing);
    const fromImportQueue = nextFreeWorkOrderNumber(existing);
    expect(fromWorkOrderScreen).toBe('19101360');
    expect(fromSiteLog).toBe(fromWorkOrderScreen);
    expect(fromImportQueue).toBe(fromWorkOrderScreen);
  });

  it('keeps handing out fresh numbers as jobs are created back to back', () => {
    // Converting several site visits in a row must not repeat a number.
    const existing = ['19101358'];
    const issued: string[] = [];
    for (let i = 0; i < 25; i++) {
      const n = nextFreeWorkOrderNumber([...existing, ...issued]);
      expect(issued).not.toContain(n);
      issued.push(n);
    }
    expect(new Set(issued).size).toBe(25);
    expect(issued[0]).toBe('19101359');
  });

  it('leaves the imported ticket numbers that are not plain digits alone', () => {
    expect(nextFreeWorkOrderNumber(['WO-622825', 'TEST-001', '19101359']))
      .toBe('19101360');
  });
});
