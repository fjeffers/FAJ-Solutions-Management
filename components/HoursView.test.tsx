// @vitest-environment jsdom
//
// Hours: pick the job, see a card per day from the techs' taps, change a box, Save.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnrichedWorkOrder } from '@/lib/types';

vi.mock('@/lib/toast', () => ({ toastError: vi.fn(), toastSuccess: vi.fn(), toastInfo: vi.fn() }));

const at = (day: string, hhmm: string) => new Date(`2026-10-${day}T${hhmm}:00-04:00`).toISOString();
const tables: Record<string, Record<string, unknown>[]> = {
  job_day_events: [
    { id: 'e1', wo_id: 'wo', contractor_name: 'Frederick Jeffers', kind: 'travel_start', at: at('23', '09:16'), origin: 'home', dest: 'site', miles: null },
    { id: 'e2', wo_id: 'wo', contractor_name: 'Frederick Jeffers', kind: 'travel_end', at: at('23', '12:49'), origin: null, dest: null, miles: null },
  ],
  job_punches: [{ id: 'p1', wo_id: 'wo', wo_number: '19101413', contractor_name: 'Frederick Jeffers', kind: 'in', at: at('23', '12:49') }],
  job_odometer: [],
  field_sheet_days: [],
};
const upserts: Record<string, unknown>[] = [];
const rpc = vi.fn(async () => ({ data: { ok: true, id: 'p2' }, error: null }));
function query(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) chain[m] = () => chain;
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok);
  chain.upsert = (row: Record<string, unknown>) => { upserts.push(row); return chain; };
  chain.single = async () => ({ data: { id: 's1', ...(upserts.at(-1) ?? {}) }, error: null });
  return chain;
}
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (t: string) => query(t), rpc }) }));

const { default: HoursView } = await import('./HoursView');
const wo = {
  id: 'wo', wo_number: '19101413', site_name: "Wendy's #397", title: "Wendy's #397", contractor_names: ['Frederick Jeffers'],
  contractor_name: 'Frederick Jeffers', start_date: '2026-10-23', end_date: '2026-10-23', archived_at: null,
} as unknown as EnrichedWorkOrder;

afterEach(() => { cleanup(); upserts.length = 0; rpc.mockClear(); });

describe('Hours', () => {
  it('shows each day as a card from the app, and saves the hours, miles and meals typed', async () => {
    const user = userEvent.setup();
    render(<HoursView workOrders={[wo]} />);
    await user.type(screen.getByLabelText('Work order number'), '19101413{Enter}');
    const started = (await screen.findByLabelText('Started Frederick Jeffers 2026-10-23')) as HTMLInputElement;
    expect(started.value).toBe('12:49');
    await user.type(screen.getByLabelText('Finished Frederick Jeffers 2026-10-23'), '15:30');
    await user.type(screen.getByLabelText('Miles Frederick Jeffers 2026-10-23'), '104');
    await user.type(screen.getByLabelText('Meals $ Frederick Jeffers 2026-10-23'), '14.50');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(upserts.at(-1)).toMatchObject({ wo_id: 'wo', day: '2026-10-23', tech: 'Frederick Jeffers', edits: { leftSite: '15:30', miles: 104, meals: 14.5 } });
  });

  it('clocks out a tech still clocked in, at the Finished time', async () => {
    const user = userEvent.setup();
    render(<HoursView workOrders={[wo]} />);
    await user.type(screen.getByLabelText('Work order number'), '19101413{Enter}');
    await user.type(await screen.findByLabelText('Finished Frederick Jeffers 2026-10-23'), '15:30');
    await user.click(screen.getByRole('button', { name: /clock out at/i }));
    expect(rpc).toHaveBeenCalledWith('wf_owner_fix_punch', expect.objectContaining({ p_op: 'add', p_kind: 'out', p_at: '2026-10-23T19:30:00.000Z', p_tech: 'Frederick Jeffers' }));
  });

  it('says when Started and Finished come from the gap between drives', async () => {
    const saved = tables.job_day_events, punches = tables.job_punches;
    tables.job_punches = [];
    // Paul Gibbs, 2026-10-21: two drives picked as Hotel → Hotel, nothing on site.
    tables.job_day_events = [
      { id: 'g1', wo_id: 'wo', contractor_name: 'Frederick Jeffers', kind: 'travel_start', at: at('23', '07:38'), origin: 'hotel', dest: 'hotel', miles: null },
      { id: 'g2', wo_id: 'wo', contractor_name: 'Frederick Jeffers', kind: 'travel_end', at: at('23', '08:26'), origin: null, dest: null, miles: 2.2 },
      { id: 'g3', wo_id: 'wo', contractor_name: 'Frederick Jeffers', kind: 'travel_start', at: at('23', '16:50'), origin: 'hotel', dest: 'hotel', miles: null },
      { id: 'g4', wo_id: 'wo', contractor_name: 'Frederick Jeffers', kind: 'travel_end', at: at('23', '17:46'), origin: null, dest: null, miles: 2.2 },
    ];
    try {
      const user = userEvent.setup();
      render(<HoursView workOrders={[wo]} />);
      await user.type(screen.getByLabelText('Work order number'), '19101413{Enter}');
      expect(((await screen.findByLabelText('Started Frederick Jeffers 2026-10-23')) as HTMLInputElement).value).toBe('08:26');
      expect((screen.getByLabelText('Finished Frederick Jeffers 2026-10-23') as HTMLInputElement).value).toBe('16:50');
      expect(screen.getByText(/worked out from the drives/)).toBeTruthy();
    } finally {
      tables.job_day_events = saved;
      tables.job_punches = punches;
    }
  });

  it('shows the days by week with each week\'s totals, as a short list, and keeps the choice', async () => {
    tables.field_sheet_days = [{ id: 's9', day: '2026-10-27', tech: 'Frederick Jeffers', edits: { arrived: '08:00', leftSite: '12:00' }, added: true, hidden: false }];
    try {
      const user = userEvent.setup();
      const onLook = vi.fn();
      render(<HoursView workOrders={[wo]} onLook={onLook} />);
      await user.type(screen.getByLabelText('Work order number'), '19101413{Enter}');
      await user.click(await screen.findByRole('button', { name: 'By week' }));
      expect(onLook).toHaveBeenLastCalledWith(expect.objectContaining({ group: 'week' }));
      expect(screen.getByText('Week of Mon, Oct 26 – Sun, Nov 1')).toBeTruthy();
      expect(screen.getByText('Week of Mon, Oct 19 – Sun, Oct 25')).toBeTruthy();
      expect(screen.getByText(/^1 day · 4\.00 h on site/)).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'Short list' }));
      expect(onLook).toHaveBeenLastCalledWith({ order: 'new', group: 'week', cards: 'short' });
      expect(screen.queryByLabelText('Started Frederick Jeffers 2026-10-27')).toBeNull();
      await user.click(screen.getByRole('button', { name: /Tuesday, Oct 27/ }));
      expect((screen.getByLabelText('Started Frederick Jeffers 2026-10-27') as HTMLInputElement).value).toBe('08:00');
    } finally {
      tables.field_sheet_days = [];
    }
  });
});
