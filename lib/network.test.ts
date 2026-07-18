import { describe, it, expect } from 'vitest';
import { genTargetLabel } from './network';

describe('genTargetLabel', () => {
  it('expands {jack} to one label per jack letter', () => {
    expect(genTargetLabel('2153', 'A,B,C', '{room}-{jack}')).toBe('2153-A, 2153-B, 2153-C');
  });

  it('expands {jacks} inside a single label', () => {
    expect(genTargetLabel('2153', 'A,B,C', '{room} {jacks}')).toBe('2153 A,B,C');
  });

  it('defaults to A,B,C when jacks is null or empty', () => {
    expect(genTargetLabel('2101', null, '{room}-{jack}')).toBe('2101-A, 2101-B, 2101-C');
    expect(genTargetLabel('2101', '  ', '{room}-{jack}')).toBe('2101-A, 2101-B, 2101-C');
  });

  it('handles fewer jacks and stray whitespace', () => {
    expect(genTargetLabel('21A', ' A , B ', '{room}-{jack}')).toBe('21A-A, 21A-B');
  });

  it('works with a scheme that has no jack token', () => {
    expect(genTargetLabel('2110', 'A,B,C', 'FLR21-{room}')).toBe('FLR21-2110');
  });
});
