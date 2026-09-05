import { describe, it, expect } from 'vitest';
import { normalizeName, matchToInventory, planStockIn, stockInCost, findByCode } from './stock-in';
import type { Material } from './types';

const mat = (over: Partial<Material>): Material => ({
  id: 'm1', user_id: null, name: 'Cat6 Box', description: null, category: null, unit: 'box',
  stock_quantity: 4, low_stock_threshold: null, unit_cost: 120, supplier: null, sku: null,
  location: null, notes: null, created_at: '', updated_at: '', ...over,
});

describe('normalizeName', () => {
  it('ignores case, punctuation and repeated spacing', () => {
    expect(normalizeName('CAT6  BOX-550MHZ')).toBe(normalizeName('cat6 box 550mhz'));
  });

  it('does NOT merge parts that differ by more than punctuation', () => {
    // Splitting digits off letters would make "550mhz" and "550 mhz" equal, and
    // with them a pile of genuinely different part numbers. Better to leave two
    // rows Fred can merge than to top up the wrong shelf.
    expect(normalizeName('cat6 box 550mhz')).not.toBe(normalizeName('cat6 box 550 mhz'));
  });
});

describe('matchToInventory', () => {
  it('matches on SKU before anything else', () => {
    const rows = matchToInventory(
      [{ name: 'Totally different label', quantity: 1, unit_cost: 5, sku: 'ABC-123' }],
      [mat({ id: 'm9', name: 'Keystone', sku: 'abc-123' })],
    );
    expect(rows[0].match?.id).toBe('m9');
  });

  it('falls back to a loose name match', () => {
    const rows = matchToInventory(
      [{ name: 'cat6  box', quantity: 2, unit_cost: 118 }],
      [mat({ id: 'm1', name: 'Cat6 Box' })],
    );
    expect(rows[0].match?.id).toBe('m1');
  });

  it('leaves an unrecognised line as a new item rather than guessing', () => {
    const rows = matchToInventory(
      [{ name: 'Wall anchors', quantity: 10, unit_cost: 0.4 }],
      [mat({ name: 'Cat6 Box' })],
    );
    expect(rows[0].match).toBeNull();
  });

  it('includes every line by default', () => {
    const rows = matchToInventory([{ name: 'A', quantity: 1, unit_cost: 1 }], []);
    expect(rows[0].include).toBe(true);
  });
});

describe('planStockIn', () => {
  const row = (over: Partial<ReturnType<typeof matchToInventory>[number]>) => ({
    id: 'r1', name: 'Cat6 Box', quantity: 2, unit_cost: 118, match: null, include: true, ...over,
  });

  it('adds to existing stock and refreshes the unit cost to what was just paid', () => {
    const plan = planStockIn([row({ match: mat({ stock_quantity: 4, unit_cost: 120 }), quantity: 3, unit_cost: 118 })]);
    expect(plan.topUps[0].newQuantity).toBe(7);
    expect(plan.topUps[0].newUnitCost).toBe(118);
    expect(plan.creates).toHaveLength(0);
  });

  it('keeps the old cost when the receipt did not give one', () => {
    const plan = planStockIn([row({ match: mat({ unit_cost: 120 }), unit_cost: 0 })]);
    expect(plan.topUps[0].newUnitCost).toBe(120);
  });

  it('creates unmatched lines as new items', () => {
    const plan = planStockIn([row({ name: 'Wall anchors', match: null, quantity: 10, unit_cost: 0.4 })]);
    expect(plan.creates).toEqual([{ name: 'Wall anchors', quantity: 10, unit_cost: 0.4 }]);
  });

  it('skips unticked lines, blank names and zero quantities', () => {
    const plan = planStockIn([
      row({ include: false }),
      row({ name: '   ' }),
      row({ quantity: 0 }),
    ]);
    expect(plan.topUps).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });

  it('never lowers stock, even given a negative quantity', () => {
    const plan = planStockIn([row({ match: mat({ stock_quantity: 4 }), quantity: -5 })]);
    expect(plan.topUps).toHaveLength(0);
  });
});

describe('stockInCost', () => {
  it('counts only the ticked lines', () => {
    const rows = matchToInventory(
      [{ name: 'A', quantity: 2, unit_cost: 10 }, { name: 'B', quantity: 1, unit_cost: 5 }],
      [],
    );
    rows[1].include = false;
    expect(stockInCost(rows)).toBe(20);
  });
});

describe('findByCode', () => {
  const stock = [
    mat({ id: 'a', name: 'Keystone jack', sku: '0123456789012' }),
    mat({ id: 'b', name: 'Faceplate 2-port PN-8842', sku: null }),
  ];

  it('finds an exact SKU', () => {
    expect(findByCode(stock, '0123456789012')?.id).toBe('a');
  });

  it('finds a code that only appears in the name', () => {
    expect(findByCode(stock, 'pn-8842')?.id).toBe('b');
  });

  it('returns null for an unknown code rather than a wrong item', () => {
    expect(findByCode(stock, '999')).toBeNull();
  });

  it('treats a blank code as no search', () => {
    expect(findByCode(stock, '  ')).toBeNull();
  });
});
