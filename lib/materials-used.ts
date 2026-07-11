import type { MaterialUsed } from './types';

// Compares a work order's previous and new materials-used lists and returns
// how much inventory stock to deduct per material_id. Positive = deduct that
// many more units; negative = put units back (row removed or quantity lowered).
// Extra items (material_id null) never touch inventory.
export function stockAdjustments(
  prev: MaterialUsed[] | null | undefined,
  next: MaterialUsed[] | null | undefined,
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const row of next ?? []) {
    if (!row.material_id) continue;
    usage.set(row.material_id, (usage.get(row.material_id) ?? 0) + (Number(row.quantity) || 0));
  }
  for (const row of prev ?? []) {
    if (!row.material_id) continue;
    usage.set(row.material_id, (usage.get(row.material_id) ?? 0) - (Number(row.quantity) || 0));
  }
  for (const [id, delta] of usage) {
    if (delta === 0) usage.delete(id);
  }
  return usage;
}

export function materialsUsedCost(rows: MaterialUsed[] | null | undefined): number {
  return (rows ?? []).reduce(
    (s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0),
    0,
  );
}
