// The timesheet's pictures on the Gaffney job (WO 19101401): the odometer and
// the approved receipts in the dates, nothing else. The site photos, a declined
// duplicate and the hotel the night before the job stay on the job, out of here.
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { photoSources } from './timesheet-photos';

const at = (day: string, hhmm: string) => new Date(`2026-10-${day}T${hhmm}:00-04:00`).toISOString();
const tables: Record<string, Record<string, unknown>[]> = {
  job_odometer: [
    { id: 'o1', contractor_name: 'Paul Gibbs', at: at('19', '07:10'), moment: 'start', reading: 41200, photo_path: 'odo/start.jpg' },
    { id: 'o2', contractor_name: 'Paul Gibbs', at: at('19', '07:36'), moment: 'end', reading: 41218, photo_path: 'odo/end.jpg' },
  ],
  job_expenses: [
    { id: 'x0', contractor_name: 'Paul Gibbs', category: 'hotel', vendor: 'Quality Inn', amount: 350.74, expense_date: '2026-10-18', status: 'approved', receipt_path: 'r/hotel.jpg' },
    { id: 'x1', contractor_name: 'Paul Gibbs', category: 'materials', vendor: "Lowe's", amount: 47.48, expense_date: '2026-10-20', status: 'approved', receipt_path: 'r/lowes-1.jpg' },
    { id: 'x2', contractor_name: 'Paul Gibbs', category: 'fuel', vendor: null, amount: 76.75, expense_date: '2026-10-21', status: 'approved', receipt_path: 'r/fuel.jpg' },
    { id: 'x3', contractor_name: 'Paul Gibbs', category: 'fuel', vendor: 'Circle K', amount: 76.75, expense_date: '2026-10-21', status: 'declined', receipt_path: 'r/fuel-again.jpg' },
    { id: 'x4', contractor_name: 'Paul Gibbs', category: 'materials', vendor: "Lowe's", amount: 104.17, expense_date: '2026-10-21', status: 'approved', receipt_path: 'r/lowes-2.jpg' },
  ],
  wo_photos: [{ url: 'https://example.test/site.jpg', taken_at: at('21', '08:28'), contractor_name: 'Paul Gibbs' }],
  work_orders: [{ job_log_left_out: [] }],
};

const asked: string[] = [];
// The read of the pictures left out fails.
let woFails = false;
function query(table: string) {
  asked.push(table);
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) chain[m] = () => chain;
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok);
  chain.maybeSingle = async () => (table === 'work_orders' && woFails ? { data: null, error: { message: 'offline' } } : { data: (tables[table] ?? [])[0] ?? null, error: null });
  return chain;
}
const db = {
  from: query,
  storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })) }) }) },
} as unknown as SupabaseClient;

describe('photoSources', () => {
  it('is the odometer and the approved receipts in the dates, and never the site photos', async () => {
    const out = await photoSources(db, 'wo', '2026-10-19', '2026-10-23');
    expect(out.map((p) => p.caption)).toEqual([
      'Odometer start of drive: 41,200 · 7:10 AM',
      'Odometer end of drive: 41,218 · 7:36 AM',
      "Receipt · Materials, Lowe's: $47.48",
      'Receipt · Fuel: $76.75',
      "Receipt · Materials, Lowe's: $104.17",
    ]);
    expect(asked).not.toContain('wo_photos');
  });

  it('leaves out every picture taken out of the job log, as the job log does (Fred: "when i down load it it still there")', async () => {
    tables.work_orders = [{ job_log_left_out: ['receipt:x0', 'odo:o2', 'photo:ph1'] }];
    try {
      const out = await photoSources(db, 'wo', '2026-10-18', '2026-10-23');
      expect(out.map((p) => p.caption)).toEqual([
        'Odometer start of drive: 41,200 · 7:10 AM',
        "Receipt · Materials, Lowe's: $47.48",
        'Receipt · Fuel: $76.75',
        "Receipt · Materials, Lowe's: $104.17",
      ]);
    } finally {
      tables.work_orders = [{ job_log_left_out: [] }];
    }
  });

  it('makes no PDF when the pictures left out can’t be read, rather than one with them in (Greptile on PR #24)', async () => {
    woFails = true;
    try {
      await expect(photoSources(db, 'wo', '2026-10-18', '2026-10-23')).rejects.toThrow(/couldn't read the pictures left out/i);
    } finally {
      woFails = false;
    }
  });

  it('has the hotel when its day is in the dates and it was not taken out', async () => {
    expect((await photoSources(db, 'wo', '2026-10-18', '2026-10-23')).map((p) => p.caption)).toContain('Receipt · Lodging, Quality Inn: $350.74');
  });
});
