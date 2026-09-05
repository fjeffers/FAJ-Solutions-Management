import type { Material, MaterialKitItem, MaterialUsed, QuoteLineItem } from './types';

// A saved "recipe" of materials — see supabase-migration-084-material-kits.sql.
//
// Everything here is a pure copy: a kit is a template, so adding one produces
// NEW rows with new ids and never mutates the kit or touches inventory. Stock
// still only moves when the work order itself is saved.

let seq = 0;
function rowId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

/** What the kit costs at today's prices. */
export function kitCost(items: MaterialKitItem[] | null | undefined): number {
  return (items ?? []).reduce(
    (s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_cost) || 0),
    0,
  );
}

/**
 * Kit → rows for a work order's "Materials used" list.
 *
 * Stock items are re-read from live inventory, so a kit built in March uses
 * September's name and cost rather than a stale copy. An item that has since
 * been deleted from inventory still comes across, as an EXTRA row keeping the
 * name it was saved under — losing the line entirely would quietly drop a real
 * cost off the job.
 *
 * Money flags follow the same rule a hand-added row does: something bought for
 * the job is owed back, stock off the van is not, and nothing is billed to the
 * client until it's ticked on the Pay panel.
 */
export function kitToMaterialsUsed(
  items: MaterialKitItem[] | null | undefined,
  materials: Material[] | null | undefined,
): MaterialUsed[] {
  return (items ?? []).map((i) => {
    const inv = i.material_id ? (materials ?? []).find((m) => m.id === i.material_id) : null;
    const stocked = !!inv;
    return {
      id: rowId('mu'),
      material_id: stocked ? i.material_id : null,
      name: inv?.name ?? i.name,
      quantity: Number(i.quantity) || 0,
      unit_cost: stocked ? (inv?.unit_cost ?? i.unit_cost ?? null) : (i.unit_cost ?? null),
      reimburse: !stocked,
      client_pays: false,
    };
  });
}

/**
 * Kit → quote lines, itemised.
 *
 * Rates come across at cost. Nothing is marked up automatically: a guessed
 * margin printed on a client-facing quote is worse than a number Fred sets
 * himself.
 */
export function kitToQuoteLines(
  items: MaterialKitItem[] | null | undefined,
  materials: Material[] | null | undefined,
): QuoteLineItem[] {
  return (items ?? []).map((i) => {
    const inv = i.material_id ? (materials ?? []).find((m) => m.id === i.material_id) : null;
    return {
      id: rowId('li'),
      description: inv?.name ?? i.name,
      quantity: Number(i.quantity) || 0,
      rate: Number(inv?.unit_cost ?? i.unit_cost ?? 0) || 0,
    };
  });
}

/**
 * Kit → ONE quote line, the whole kit rolled up.
 *
 * The default, because a quote is a client-facing document and an itemised
 * parts list publishes what FAJ pays for every part on it.
 */
export function kitToQuoteLine(
  kitName: string,
  items: MaterialKitItem[] | null | undefined,
  materials: Material[] | null | undefined,
): QuoteLineItem {
  const lines = kitToQuoteLines(items, materials);
  return {
    id: rowId('li'),
    description: `Materials — ${kitName}`,
    quantity: 1,
    rate: Math.round(lines.reduce((s, l) => s + l.quantity * l.rate, 0) * 100) / 100,
  };
}

/**
 * A job's materials list → kit items, for "save these as a kit".
 *
 * Unnamed rows are dropped, and so are the per-job money flags: whether THIS
 * client paid for a part says nothing about the next job.
 */
export function materialsUsedToKitItems(
  rows: MaterialUsed[] | null | undefined,
): MaterialKitItem[] {
  return (rows ?? [])
    .filter((r) => (r.name ?? '').trim() !== '')
    .map((r) => ({
      id: rowId('ki'),
      material_id: r.material_id ?? null,
      name: r.name.trim(),
      quantity: Number(r.quantity) || 0,
      unit_cost: r.unit_cost ?? null,
    }));
}

/** A blank row for the kit builder. */
export function newKitItem(material: Material | null): MaterialKitItem {
  return {
    id: rowId('ki'),
    material_id: material?.id ?? null,
    name: material?.name ?? '',
    quantity: 1,
    unit_cost: material?.unit_cost ?? null,
  };
}
