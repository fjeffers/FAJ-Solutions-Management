// Miles typed in by hand go on top of the day's own, as its Extra miles (Fred,
// 2026-10-27: "for mileage ... it's supposed to basically go to mileage").
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDayMiles, parseMiles } from './day-miles';

type Row = { id: string; wo_id: string; tech: string; day: string; edits: Record<string, unknown>; hidden?: boolean; user_id?: string };

/** field_sheet_days, as much of it as addDayMiles uses. otherFirst: someone saves the same day just before our insert. */
function fakeDb(rows: Row[], o: { otherFirst?: Record<string, unknown>; readFails?: boolean } = {}) {
  const writes: { insert?: Record<string, unknown>; update?: Record<string, unknown> }[] = [];
  const db = {
    from: () => {
      const f: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: string) => { f[k] = v; return q; },
        maybeSingle: async () => (o.readFails ? { data: null, error: { message: 'down' } }
          : { data: rows.find((r) => r.wo_id === f.wo_id && r.tech === f.tech && r.day === f.day) ?? null, error: null }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_k: string, id: string) => { Object.assign(rows.find((r) => r.id === id)!, patch); writes.push({ update: patch }); return { error: null }; },
        }),
        insert: async (row: Row) => {
          if (o.otherFirst) {
            rows.push({ ...row, id: 'theirs', edits: o.otherFirst });
            o.otherFirst = undefined;
            return { error: { code: '23505' } };
          }
          rows.push({ ...row, id: 'new' });
          writes.push({ insert: row });
          return { error: null };
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes, rows };
}

describe('miles typed in by hand', () => {
  it('reads what was typed as miles to 0.1', () => {
    expect(parseMiles('85')).toBe(85);
    expect(parseMiles(' 85.44 mi')).toBe(85.4);
    expect(parseMiles('1,200 miles')).toBe(1200);
    expect(parseMiles('.5')).toBe(0.5);
    for (const bad of ['', 'abc', '0', '-5', '6000', '8 5', '$85']) expect(parseMiles(bad)).toBeNull();
  });

  it("starts the day's Extra miles when the office hasn't saved that day yet", async () => {
    const { db, writes } = fakeDb([]);
    expect(await addDayMiles(db, { woId: 'wo', tech: 'Paul Gibbs', day: '2026-10-19', miles: 85, ownerId: 'owner' })).toBe(85);
    expect(writes).toEqual([{ insert: expect.objectContaining({ user_id: 'owner', wo_id: 'wo', tech: 'Paul Gibbs', day: '2026-10-19', edits: { extraMiles: 85 }, added: false, hidden: false }) }]);
  });

  it("adds to the Extra miles already there and keeps the day's other changes; a hidden day stays hidden", async () => {
    const { db, writes, rows } = fakeDb([{ id: 'd1', wo_id: 'wo', tech: 'Paul Gibbs', day: '2026-10-19', edits: { miles: 100, extraMiles: 10, note: 'Drive home' }, hidden: true }]);
    expect(await addDayMiles(db, { woId: 'wo', tech: 'Paul Gibbs', day: '2026-10-19', miles: 85.3 })).toBe(95.3);
    expect(writes).toEqual([{ update: { edits: { miles: 100, extraMiles: 95.3, note: 'Drive home' }, updated_at: expect.any(String) } }]);
    expect(rows[0].hidden).toBe(true);
  });

  it('adds to a day someone else saved a moment before, rather than failing', async () => {
    const { db, rows } = fakeDb([], { otherFirst: { extraMiles: 10 } });
    expect(await addDayMiles(db, { woId: 'wo', tech: 'Paul Gibbs', day: '2026-10-19', miles: 85 })).toBe(95);
    expect(rows).toHaveLength(1);
    expect(rows[0].edits).toEqual({ extraMiles: 95 });
  });

  it("is null when the day can't be read", async () => {
    const { db, writes } = fakeDb([], { readFails: true });
    expect(await addDayMiles(db, { woId: 'wo', tech: 'Paul Gibbs', day: '2026-10-19', miles: 85 })).toBeNull();
    expect(writes).toEqual([]);
  });
});
