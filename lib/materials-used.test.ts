import { describe, it, expect } from 'vitest';
import { stockAdjustments, materialsUsedCost } from './materials-used';
import type { MaterialUsed } from './types';

const row = (over: Partial<MaterialUsed>): MaterialUsed =>
  ({ id: 'r1', material_id: null, name: 'item', quantity: 1, unit_cost: null, ...over });

describe('stockAdjustments', () => {
  it('deducts stock for newly added inventory rows', () => {
    const adj = stockAdjustments([], [row({ material_id: 'cat6', quantity: 3 })]);
    expect(adj.get('cat6')).toBe(3);
  });

  it('returns stock when a row is removed', () => {
    const adj = stockAdjustments([row({ material_id: 'cat6', quantity: 3 })], []);
    expect(adj.get('cat6')).toBe(-3);
  });

  it('adjusts by the difference when quantity changes', () => {
    const adj = stockAdjustments(
      [row({ material_id: 'cat6', quantity: 2 })],
      [row({ material_id: 'cat6', quantity: 5 })],
    );
    expect(adj.get('cat6')).toBe(3);
  });

  it('ignores unchanged rows and extra (non-inventory) items', () => {
    const prev = [row({ material_id: 'cat6', quantity: 2 }), row({ id: 'r2', name: 'HomeDepot bracket', quantity: 4 })];
    const next = [row({ material_id: 'cat6', quantity: 2 }), row({ id: 'r2', name: 'HomeDepot bracket', quantity: 9 })];
    expect(stockAdjustments(prev, next).size).toBe(0);
  });

  it('sums multiple rows of the same material', () => {
    const adj = stockAdjustments([], [
      row({ material_id: 'cat6', quantity: 2 }),
      row({ id: 'r2', material_id: 'cat6', quantity: 3 }),
    ]);
    expect(adj.get('cat6')).toBe(5);
  });

  it('handles null/undefined lists', () => {
    expect(stockAdjustments(null, undefined).size).toBe(0);
  });
});

describe('materialsUsedCost', () => {
  it('totals quantity times unit cost, treating missing cost as 0', () => {
    expect(materialsUsedCost([
      row({ quantity: 3, unit_cost: 12.5 }),
      row({ id: 'r2', quantity: 2, unit_cost: null }),
    ])).toBe(37.5);
    expect(materialsUsedCost(null)).toBe(0);
  });
});
