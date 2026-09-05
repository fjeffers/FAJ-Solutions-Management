import type { Material, ReceiptItemLike } from './types';

// Receipt/scan → inventory. "Stock in" is the other half of materials: the
// Closeout tab records what LEAVES the van on a job, this records what comes
// back from the store and goes onto the shelf.
//
// The judgement call is whether a scanned line is something already tracked
// (top up its stock) or something new (create the item). Nothing here writes:
// it returns a plan for the screen to show, so a wrong guess is corrected
// before it touches inventory rather than after.

/** Loose match key: case, punctuation and spacing differences are not real. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type StockInRow = {
  /** Row id for the review list. */
  id: string;
  name: string;
  quantity: number;
  unit_cost: number;
  /** The inventory item this line looks like, or null for a new item. */
  match: Material | null;
  /** Unticked lines are skipped entirely. */
  include: boolean;
};

/**
 * Pair each scanned line with the inventory item it appears to be.
 *
 * Matching is on SKU first (exact, and the only truly reliable key), then a
 * normalized name. Anything else is left as a new item — inventing a match
 * would silently add stock to the wrong shelf, which is worse than one extra
 * row Fred can merge himself.
 */
export function matchToInventory(
  items: ReceiptItemLike[] | null | undefined,
  materials: Material[] | null | undefined,
): StockInRow[] {
  const bySku = new Map<string, Material>();
  const byName = new Map<string, Material>();
  for (const m of materials ?? []) {
    if (m.sku) bySku.set(m.sku.trim().toLowerCase(), m);
    const key = normalizeName(m.name);
    if (key && !byName.has(key)) byName.set(key, m);
  }

  return (items ?? []).map((it, idx) => {
    const name = (it.name ?? '').trim();
    const code = (it.sku ?? '').trim().toLowerCase();
    const match = (code ? bySku.get(code) : undefined) ?? byName.get(normalizeName(name)) ?? null;
    return {
      id: `si-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      quantity: Number(it.quantity) || 0,
      unit_cost: Number(it.unit_cost) || 0,
      match,
      include: true,
    };
  });
}

export type StockInPlan = {
  /** Existing items whose stock goes up. */
  topUps: { material: Material; addQuantity: number; newQuantity: number; newUnitCost: number }[];
  /** Items that do not exist yet. */
  creates: { name: string; quantity: number; unit_cost: number }[];
};

/**
 * Turn the reviewed rows into exactly what will be written.
 *
 * A top-up adds to stock and refreshes the unit cost to what was just paid —
 * that is the price the next job should be costed at. It never lowers stock:
 * this door only brings things in.
 */
export function planStockIn(rows: StockInRow[] | null | undefined): StockInPlan {
  const plan: StockInPlan = { topUps: [], creates: [] };
  for (const r of rows ?? []) {
    if (!r.include) continue;
    const qty = Number(r.quantity) || 0;
    if (qty <= 0 || !r.name.trim()) continue;
    if (r.match) {
      const current = Number(r.match.stock_quantity) || 0;
      plan.topUps.push({
        material: r.match,
        addQuantity: qty,
        newQuantity: current + qty,
        // A cost of zero means the receipt did not say; keep what we had.
        newUnitCost: r.unit_cost > 0 ? r.unit_cost : (Number(r.match.unit_cost) || 0),
      });
    } else {
      plan.creates.push({ name: r.name.trim(), quantity: qty, unit_cost: r.unit_cost });
    }
  }
  return plan;
}

/** What the whole stock-in run cost. */
export function stockInCost(rows: StockInRow[] | null | undefined): number {
  return (rows ?? []).reduce(
    (s, r) => s + (r.include ? (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0) : 0),
    0,
  );
}

/**
 * Find an inventory item by a scanned barcode or typed code.
 *
 * SKU is checked exactly first, then loosely, then the name — a scanned code
 * is usually a SKU, but Fred types part numbers into whichever field was handy
 * at the time, so a code that only appears in the name still finds its item.
 */
export function findByCode(
  materials: Material[] | null | undefined,
  code: string | null | undefined,
): Material | null {
  const q = (code ?? '').trim().toLowerCase();
  if (!q) return null;
  const list = materials ?? [];
  return (
    list.find((m) => (m.sku ?? '').trim().toLowerCase() === q) ??
    list.find((m) => (m.sku ?? '').toLowerCase().includes(q)) ??
    list.find((m) => m.name.toLowerCase().includes(q)) ??
    null
  );
}
