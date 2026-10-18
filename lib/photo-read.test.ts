import { describe, it, expect } from 'vitest';
import { sanitizeOdometer, sanitizeReceipt, photoSchema, photoPrompt, odometerDiffers, amountDiffers } from './photo-read';

describe('reading a photo', () => {
  it('keeps an odometer number and drops anything else', () => {
    expect(sanitizeOdometer({ reading: 48213.64 })).toEqual({ reading: 48213.6 });
    expect(sanitizeOdometer({ reading: '48,213' })).toEqual({ reading: 48213 });
    expect(sanitizeOdometer({ reading: -4 })).toEqual({ reading: null });
    expect(sanitizeOdometer({ reading: 12_000_000 })).toEqual({ reading: null });
    expect(sanitizeOdometer(null)).toEqual({ reading: null });
  });

  it('keeps what a receipt shows, and gallons only on fuel', () => {
    const today = '2026-10-18';
    expect(sanitizeReceipt({ amount: '$41.237', vendor: '  Shell   #22 ', date: '2026-10-17', category: 'fuel', gallons: 11.2049 }, today))
      .toEqual({ amount: 41.24, vendor: 'Shell #22', date: '2026-10-17', category: 'fuel', gallons: 11.205 });
    expect(sanitizeReceipt({ amount: 12, vendor: 'Deli', date: '2026-10-17', category: 'meals', gallons: 3 }, today).gallons).toBeNull();
    // Not a date from the future, years back, an unknown category or a zero total.
    const odd = sanitizeReceipt({ amount: 0, vendor: '', date: '2027-01-01', category: 'snacks', gallons: null }, today);
    expect(odd).toEqual({ amount: null, vendor: null, date: null, category: null, gallons: null });
    expect(sanitizeReceipt({ date: '2024-01-01' }, today).date).toBeNull();
  });

  it('asks for every field, so the answer always parses', () => {
    expect(photoSchema('odometer')).toMatchObject({ required: ['reading'], additionalProperties: false });
    expect(photoSchema('receipt')).toMatchObject({ required: ['amount', 'vendor', 'date', 'category', 'gallons'] });
    expect(photoPrompt('odometer', '2026-10-18')).toMatch(/trip meter/);
    expect(photoPrompt('receipt', '2026-10-18')).toMatch(/Today is 2026-10-18/);
  });

  it('flags a typed number that differs from the photo', () => {
    expect(odometerDiffers(48213.6, 48213.6)).toBe(false);
    expect(odometerDiffers(48231, 48213.6)).toBe(true);
    expect(odometerDiffers(48231, null)).toBe(false);
    expect(amountDiffers(41.24, 41.24)).toBe(false);
    expect(amountDiffers(14.24, 41.24)).toBe(true);
  });
});
