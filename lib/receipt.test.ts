import { describe, it, expect } from 'vitest';
import { parseReceiptText, receiptTotal } from './receipt';

describe('parseReceiptText', () => {
  it('parses a Home Depot style receipt, skipping totals and payment lines', () => {
    const { items, vendor } = parseReceiptText(`THE HOME DEPOT
STORE 4171 EASTON PA
2X4X8 KD STUD <A> 3.98
ROMEX 14/2 50FT 45.97
SUBTOTAL 49.95
SALES TAX 3.00
TOTAL 52.95
VISA XXXX1234 52.95`);
    expect(vendor).toBe('THE HOME DEPOT');
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ name: '2X4X8 KD STUD', quantity: 1, unit_cost: 3.98 });
    expect(items[1]).toEqual({ name: 'ROMEX 14/2 50FT', quantity: 1, unit_cost: 45.97 });
    expect(receiptTotal(items)).toBe(49.95);
  });

  it('handles quantity @ price lines with the name on the previous line', () => {
    const { items } = parseReceiptText(`WALL ANCHORS 50PK
4 @ 2.99 11.96`);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ name: 'WALL ANCHORS 50PK', quantity: 4, unit_cost: 2.99 });
  });

  it('handles QTY-prefix lines by dividing the total', () => {
    const { items } = parseReceiptText('QTY 2 EMT STRAP 1.58');
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ name: 'EMT STRAP', quantity: 2, unit_cost: 0.79 });
  });

  it('strips SKU digit runs from names', () => {
    const { items } = parseReceiptText('123456789012 CAT6 CABLE 1000FT 189.00');
    expect(items[0].name).toBe('CAT6 CABLE 1000FT');
    expect(items[0].unit_cost).toBe(189);
  });

  it('returns nothing for empty or unpriced text', () => {
    expect(parseReceiptText('').items).toHaveLength(0);
    expect(parseReceiptText('just some notes with no prices').items).toHaveLength(0);
  });
});
