import { describe, it, expect } from 'vitest';
import { csvCell, csvRow, toCSV } from './csv';

describe('csvCell', () => {
  it('quotes and escapes embedded quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('survives commas and newlines', () => {
    expect(csvCell('Matawan, NJ')).toBe('"Matawan, NJ"');
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  // The reason this module exists. These files get opened in Excel by clients
  // and by the accountant; a cell starting with =, +, - or @ is executed.
  it('neutralises formula injection so Excel treats it as text', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe('"\'=SUM(A1:A9)"');
    expect(csvCell('-2 drops')).toBe('"\'-2 drops"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('@handle')).toBe('"\'@handle"');
  });

  it('neutralises the dangerous ones, not just the cosmetic ones', () => {
    expect(csvCell('=HYPERLINK("http://evil","click")')).toMatch(/^"'=HYPERLINK/);
    expect(csvCell('=cmd|\' /C calc\'!A0')).toMatch(/^"'=cmd/);
  });

  it('guards leading whitespace too — Excel trims before deciding', () => {
    expect(csvCell('   =1+1')).toMatch(/^"'\s+=1\+1"$/);
    expect(csvCell('\t=1+1')).toMatch(/^"'\t=1\+1"$/);
  });

  it('leaves ordinary values alone', () => {
    expect(csvCell('Wendy’s 3255')).toBe('"Wendy’s 3255"');
    expect(csvCell('$1,234.56')).toBe('"$1,234.56"');
    expect(csvCell(4)).toBe('"4"');
  });

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
});

describe('csvRow / toCSV', () => {
  it('joins cells with commas and rows with CRLF (RFC 4180)', () => {
    expect(csvRow(['a', 'b'])).toBe('"a","b"');
    expect(toCSV([['a', 'b'], ['c', 'd']])).toBe('"a","b"\r\n"c","d"');
  });

  it('escapes every cell, not just the first', () => {
    const csv = toCSV([['Name', 'Note'], ['Acme', '-2 drops']]);
    expect(csv).toContain('"\'-2 drops"');
  });

  it('handles an empty sheet and ragged rows', () => {
    expect(toCSV([])).toBe('');
    expect(toCSV([['only'], []])).toBe('"only"\r\n');
  });
});
