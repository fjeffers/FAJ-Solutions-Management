import { describe, it, expect } from 'vitest';
import { form1099Threshold, needs1099, thresholdNeedsCheck, maskTaxId } from './tax1099';

describe('1099-NEC threshold', () => {
  it('is $600 through 2025 and $2,000 from 2026', () => {
    expect(form1099Threshold(2024)).toBe(600);
    expect(form1099Threshold(2025)).toBe(600);
    expect(form1099Threshold(2026)).toBe(2000);
  });
  it('flags exactly-at-threshold as needing a 1099, a cent under as not', () => {
    expect(needs1099(2000, 2026)).toBe(true);
    expect(needs1099(1999.99, 2026)).toBe(false);
    expect(needs1099(600, 2025)).toBe(true);
  });
  it('the 2026 picture: $2,800 needs one, $310 does not', () => {
    expect(needs1099(2800, 2026)).toBe(true);
    expect(needs1099(310, 2026)).toBe(false);
    // Under the old rule $1,200 would have needed one; in 2026 it does not.
    expect(needs1099(1200, 2026)).toBe(false);
  });
  it('asks to confirm the inflation-indexed figure from 2027', () => {
    expect(thresholdNeedsCheck(2026)).toBe(false);
    expect(thresholdNeedsCheck(2027)).toBe(true);
  });
});

describe('masking a tax ID', () => {
  it('shows only the last four', () => {
    expect(maskTaxId('SSN', '6789')).toBe('SSN •••-••-6789');
    expect(maskTaxId('EIN', '4321')).toBe('EIN ••-•••4321');
    expect(maskTaxId(null, '1111')).toBe('•••-••-1111');
    expect(maskTaxId('SSN', null)).toBe('');
  });
});
