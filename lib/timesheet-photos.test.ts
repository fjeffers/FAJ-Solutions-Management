// The timesheet's pictures on the Gaffney job (WO 19101401): the odometer and
// the approved receipts in the dates go in; the site photos only when asked,
// and a declined receipt or one dated before the job never does.
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { photoSources } from './timesheet-photos';

const at = (day: string, hhmm: string) => new Date(`2026-10-${day}T${hhmm}:00-04:00`).toISOString();
const tables: Record<string, Record<string, unknown>[]> = {
  job_odometer: [
    { contractor_name: 'Paul Gibbs', at: at('19', '07:10'), moment: 'start', reading: 41200, photo_path: 'odo/start.jpg' },
    { contractor_name: 'Paul Gibbs', at: at('19', '07:36'), moment: 'end', reading: 41218, photo_path: 'odo/end.jpg' },
  ],
  job_expenses: [
    { contractor_name: 'Paul Gibbs', category: 'fuel', vendor: 'Circle K', amount: 76.75, expense_date: '2026-10-20', status: 'approved', receipt_path: 'r/fuel.jpg' },
    { contractor_name: 'Paul Gibbs', category: 'fuel', vendor: 'Circle K', amount: 76.75, expense_date: '2026-10-20', status: 'declined', receipt_path: 'r/fuel-again.jpg' },
    { contractor_name: 'Paul Gibbs', category: 'materials', vendor: "Lowe's", amount: 104.17, expense_date: '2026-10-21', status: 'approved', receipt_path: 'r/lowes.jpg' },
    { contractor_name: 'Paul Gibbs', category: 'hotel', vendor: 'Quality Inn', amount: 350.74, expense_date: '2026-10-18', status: 'approved', receipt_path: 'r/hotel.jpg' },
  ],
  wo_photos: [
    { url: 'https://example.test/site1.jpg', taken_at: at('21', '08:28'), contractor_name: 'Paul Gibbs' },
    { url: 'https://example.test/site2.jpg', taken_at: at('21', '16:36'), contractor_name: 'Paul Gibbs' },
  ],
};

const asked: string[] = [];
function query(table: string) {
  asked.push(table);
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) chain[m] = () => chain;
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok);
  return chain;
}
const db = {
  from: query,
  storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })) }) }) },
} as unknown as SupabaseClient;

describe('photoSources', () => {
  it('leaves the site photos out when not asked, and never looks them up', async () => {
    asked.length = 0;
    const out = await photoSources(db, 'wo', '2026-10-19', '2026-10-23', { site: false });
    expect(out.map((p) => p.caption)).toEqual([
      'Odometer start of drive: 41,200 · 7:10 AM',
      'Odometer end of drive: 41,218 · 7:36 AM',
      'Receipt · Fuel, Circle K: $76.75',
      "Receipt · Materials, Lowe's: $104.17",
    ]);
    expect(asked).not.toContain('wo_photos');
  });

  it('adds the site photos when asked, after that day\'s receipts', async () => {
    const out = await photoSources(db, 'wo', '2026-10-19', '2026-10-23', { site: true });
    expect(out.filter((p) => p.day === '2026-10-21').map((p) => p.caption)).toEqual([
      "Receipt · Materials, Lowe's: $104.17", 'Site photo · 8:28 AM', 'Site photo · 4:36 PM',
    ]);
  });
});
