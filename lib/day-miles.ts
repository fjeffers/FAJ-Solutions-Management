// Miles typed in by hand, added to a tech's day on top of what's already there
// (Fred, 2026-10-27: "when I click on mileage, it's asking for the amount ...
// for mileage ... it's supposed to basically go to mileage"). Picking Mileage
// on Add an expense (tech app) or Add a receipt (office) asks for miles, not an
// amount and a store, and adds them to the day's Extra miles on Hours
// (field_sheet_days.edits.extraMiles), so Hours, the Field Sheet, the timesheet
// and the invoice all count them. No receipt is made for mileage.
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseEdits } from './field-sheet';

/** "85", "85.4 mi", "1,200 miles" → miles to 0.1; anything else, or out of range, → null. */
export function parseMiles(raw: string): number | null {
  const t = String(raw ?? '').trim().replace(/\s*mi(les?)?\.?$/i, '').replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = Math.round(Number(t) * 10) / 10;
  return n > 0 && n < 5000 ? n : null;
}

/**
 * Adds miles to a tech's day on a job: the day's new Extra miles, or null when
 * it didn't save. A day the office hid stays hidden.
 */
export async function addDayMiles(db: SupabaseClient, d: {
  woId: string; tech: string; day: string; miles: number;
  /** The account the day belongs to; left out, the database takes the signed-in owner's. */
  ownerId?: string;
}): Promise<number | null> {
  // Twice at most: a day someone else saved a moment ago is added to, not replaced.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: row, error } = await db.from('field_sheet_days').select('id, edits')
      .eq('wo_id', d.woId).eq('tech', d.tech).eq('day', d.day).maybeSingle();
    if (error) return null;
    const edits = parseEdits((row as { edits?: unknown } | null)?.edits);
    const extra = Math.round(((edits.extraMiles ?? 0) + d.miles) * 10) / 10;
    const next = { ...edits, extraMiles: extra };
    const now = new Date().toISOString();
    const saved = row
      ? await db.from('field_sheet_days').update({ edits: next, updated_at: now }).eq('id', (row as { id: string }).id)
      : await db.from('field_sheet_days').insert({
        ...(d.ownerId ? { user_id: d.ownerId } : {}), wo_id: d.woId, day: d.day, tech: d.tech, edits: next, added: false, hidden: false, updated_at: now,
      });
    if (!saved.error) return extra;
    if (saved.error.code !== '23505') return null;
  }
  return null;
}
