import { describe, it, expect } from 'vitest';
import { sanitizeOdometer, sanitizeReceipt, sanitizeSort, photoSchema, photoPrompt, odometerDiffers, amountDiffers, receiptItems, fitReceiptAi } from './photo-read';

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
      .toEqual({ amount: 41.24, vendor: 'Shell #22', date: '2026-10-17', category: 'fuel', gallons: 11.205, items: [] });
    expect(sanitizeReceipt({ amount: 12, vendor: 'Deli', date: '2026-10-17', category: 'meals', gallons: 3 }, today).gallons).toBeNull();
    // Not a date from the future, years back, an unknown category or a zero total.
    const odd = sanitizeReceipt({ amount: 0, vendor: '', date: '2027-01-01', category: 'snacks', gallons: null }, today);
    expect(odd).toEqual({ amount: null, vendor: null, date: null, category: null, gallons: null, items: [] });
    expect(sanitizeReceipt({ date: '2024-01-01' }, today).date).toBeNull();
  });

  it('asks for every field, so the answer always parses', () => {
    expect(photoSchema('odometer')).toMatchObject({ required: ['reading'], additionalProperties: false });
    expect(photoSchema('receipt')).toMatchObject({ required: ['amount', 'vendor', 'date', 'category', 'gallons', 'items'] });
    expect(photoPrompt('receipt', '2026-10-18')).toMatch(/line item/);
    expect(photoPrompt('odometer', '2026-10-18')).toMatch(/trip meter/);
    expect(photoPrompt('receipt', '2026-10-18')).toMatch(/Today is 2026-10-18/);
  });

  it('a photo from the phone: the odometer and its reading, or not one (Fred, 2026-10-26)', () => {
    expect(sanitizeSort({ what: 'odometer', reading: '48,213.64' })).toEqual({ what: 'odometer', reading: 48213.6 });
    expect(sanitizeSort({ what: 'odometer', reading: null })).toEqual({ what: 'odometer', reading: null });
    // Anything else is a job photo, and never carries a reading.
    expect(sanitizeSort({ what: 'other', reading: 12 })).toEqual({ what: 'other', reading: null });
    expect(sanitizeSort({ what: 'receipt' })).toEqual({ what: 'other', reading: null });
    expect(sanitizeSort(null)).toEqual({ what: 'other', reading: null });
    expect(photoSchema('sort')).toMatchObject({ required: ['what', 'reading'], additionalProperties: false });
    expect(photoPrompt('sort', '2026-10-26')).toMatch(/instrument cluster/);
    expect(photoPrompt('sort', '2026-10-26')).toMatch(/trip meter/);
  });

  it("keeps a receipt's lines, tidied and at most 25", () => {
    const read = sanitizeReceipt({ amount: 52.1, items: [
      { name: '  Cat6   cable 1000ft ', qty: 1, amount: '$38.99' }, { name: '', qty: 2, amount: 1 }, { name: 'RJ45 ends', qty: -3, amount: 8.5 }, 'junk',
    ] }, '2026-10-18');
    expect(read.items).toEqual([{ name: 'Cat6 cable 1000ft', qty: 1, amount: 38.99 }, { name: 'RJ45 ends', qty: null, amount: 8.5 }]);
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `Item ${i}`, qty: 1, amount: 1 }));
    expect(receiptItems({ items: many })).toHaveLength(25);
    // An older receipt has none.
    expect(receiptItems({ amount: 5 })).toEqual([]);
    expect(receiptItems(null)).toEqual([]);
  });

  it('flags a typed number that differs from the photo', () => {
    expect(odometerDiffers(48213.6, 48213.6)).toBe(false);
    expect(odometerDiffers(48231, 48213.6)).toBe(true);
    expect(odometerDiffers(48231, null)).toBe(false);
    expect(amountDiffers(41.24, 41.24)).toBe(false);
    expect(amountDiffers(14.24, 41.24)).toBe(true);
  });
});

describe('a long receipt', () => {
  // Checked against the database (pg_column_size of the jsonb): 25 long ASCII lines → 3,447 bytes,
  // 18 multibyte lines → 3,603, 25 short lines → 2,207; wf_tech_add_expense keeps anything under 4,096.
  const est = (x: Record<string, unknown>) => new TextEncoder().encode(JSON.stringify(x)).length + 40 * ((x.items as unknown[] | undefined)?.length ?? 0) + 100;

  it('keeps as many lines as fit the database, instead of losing them all', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ name: `Ç${'é'.repeat(58)}${i}`, qty: 12.125, amount: 1234.56 }));
    const ai = { amount: 249.75, vendor: 'The Home Depot #1234', date: '2026-10-21', category: 'materials', gallons: null, items };
    const fit = fitReceiptAi(ai)!;
    expect(est(fit)).toBeLessThanOrEqual(4000);
    expect((fit.items as unknown[]).length).toBe(18);
    expect(fit.vendor).toBe('The Home Depot #1234');
    const small = { amount: 4, items: [{ name: 'Tape', qty: 1, amount: 4 }] };
    expect(fitReceiptAi(small)).toEqual(small);
  });

  it('never works through more than a receipt’s worth of lines, and drops a huge request unread', () => {
    const many = { amount: 1, items: Array.from({ length: 20000 }, () => 0) };
    expect(fitReceiptAi(many)).toBeNull(); // over 32 KB as text
    const lots = { amount: 1, items: Array.from({ length: 2000 }, () => ({ name: 'x' })) };
    expect((fitReceiptAi(lots)!.items as unknown[]).length).toBeLessThanOrEqual(25);
  });
});
