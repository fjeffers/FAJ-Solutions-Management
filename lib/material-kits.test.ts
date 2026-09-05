import { describe, it, expect } from 'vitest';
import {
  kitCost, kitToMaterialsUsed, kitToQuoteLines, kitToQuoteLine, materialsUsedToKitItems,
} from './material-kits';
import type { Material, MaterialKitItem, MaterialUsed } from './types';

const mat = (over: Partial<Material>): Material => ({
  id: 'm1', user_id: null, name: 'Cat6 box', description: null, category: null, unit: 'box',
  stock_quantity: 10, low_stock_threshold: null, unit_cost: 120, supplier: null, sku: null,
  location: null, notes: null, created_at: '', updated_at: '', ...over,
});

const kitItem = (over: Partial<MaterialKitItem>): MaterialKitItem =>
  ({ id: 'k1', material_id: null, name: 'item', quantity: 1, unit_cost: null, ...over });

describe('kitCost', () => {
  it('multiplies quantity by unit cost across the kit', () => {
    expect(kitCost([
      kitItem({ quantity: 2, unit_cost: 120 }),
      kitItem({ quantity: 4, unit_cost: 3.5 }),
    ])).toBe(254);
  });

  it('treats a missing cost as zero rather than NaN', () => {
    expect(kitCost([kitItem({ quantity: 3, unit_cost: null })])).toBe(0);
  });
});

describe('kitToMaterialsUsed', () => {
  it('re-reads name and cost from live inventory, not the saved copy', () => {
    const rows = kitToMaterialsUsed(
      [kitItem({ material_id: 'm1', name: 'Cat6 box (old name)', quantity: 2, unit_cost: 99 })],
      [mat({ id: 'm1', name: 'Cat6 box 550MHz', unit_cost: 132 })],
    );
    expect(rows[0].name).toBe('Cat6 box 550MHz');
    expect(rows[0].unit_cost).toBe(132);
    expect(rows[0].material_id).toBe('m1');
  });

  it('keeps a deleted inventory item as an extra row instead of dropping the cost', () => {
    const rows = kitToMaterialsUsed(
      [kitItem({ material_id: 'gone', name: 'Keystone jack', quantity: 4, unit_cost: 2.5 })],
      [mat({ id: 'm1' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].material_id).toBeNull();
    expect(rows[0].name).toBe('Keystone jack');
    expect(rows[0].unit_cost).toBe(2.5);
  });

  it('owes back bought items and not stock, and bills neither by default', () => {
    const rows = kitToMaterialsUsed(
      [
        kitItem({ material_id: 'm1', quantity: 1 }),
        kitItem({ material_id: null, name: 'Anchors', quantity: 1, unit_cost: 8 }),
      ],
      [mat({ id: 'm1' })],
    );
    expect(rows[0].reimburse).toBe(false);
    expect(rows[1].reimburse).toBe(true);
    expect(rows.every((r) => r.client_pays === false)).toBe(true);
  });

  it('gives every row its own id so two adds of the same kit do not collide', () => {
    const items = [kitItem({ material_id: 'm1' }), kitItem({ material_id: 'm1' })];
    const ids = [...kitToMaterialsUsed(items, [mat({})]), ...kitToMaterialsUsed(items, [mat({})])]
      .map((r) => r.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('kitToQuoteLines', () => {
  it('itemises at cost, with no invented markup', () => {
    const lines = kitToQuoteLines(
      [kitItem({ material_id: 'm1', quantity: 2 }), kitItem({ name: 'Anchors', quantity: 10, unit_cost: 0.8 })],
      [mat({ id: 'm1', unit_cost: 120 })],
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ description: 'Cat6 box', quantity: 2, rate: 120 });
    expect(lines[1]).toMatchObject({ description: 'Anchors', quantity: 10, rate: 0.8 });
  });
});

describe('kitToQuoteLine', () => {
  it('rolls the whole kit into one line at the kit total', () => {
    const line = kitToQuoteLine(
      'Camera drop',
      [kitItem({ material_id: 'm1', quantity: 2 }), kitItem({ name: 'Anchors', quantity: 10, unit_cost: 0.8 })],
      [mat({ id: 'm1', unit_cost: 120 })],
    );
    expect(line.description).toBe('Materials — Camera drop');
    expect(line.quantity).toBe(1);
    expect(line.rate).toBe(248);
  });

  it('rounds the rolled-up rate to whole cents', () => {
    const line = kitToQuoteLine('Odds', [kitItem({ quantity: 3, unit_cost: 0.335 })], []);
    expect(line.rate).toBe(1.01);
  });
});

describe('materialsUsedToKitItems', () => {
  const used = (over: Partial<MaterialUsed>): MaterialUsed =>
    ({ id: 'u1', material_id: null, name: 'x', quantity: 1, unit_cost: null, ...over });

  it('drops unnamed rows and this-job-only money flags', () => {
    const items = materialsUsedToKitItems([
      used({ material_id: 'm1', name: 'Cat6 box', quantity: 2, unit_cost: 120, client_pays: true, reimburse: true }),
      used({ name: '   ', quantity: 5 }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ material_id: 'm1', name: 'Cat6 box', quantity: 2, unit_cost: 120 });
    expect(items[0]).not.toHaveProperty('client_pays');
    expect(items[0]).not.toHaveProperty('reimburse');
  });
});
