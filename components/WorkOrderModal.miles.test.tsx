// @vitest-environment jsdom
//
// Fred, 2026-10-25: "but the pay still is popping up" (WO 19101402). He took
// Pay off and saved, and opening the job again worked the mileage out again
// ($664.02) and put Pay back: the form never read the saved miles, so every
// job looked like one whose miles were never worked out.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { WorkOrder } from '@/lib/types';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({ data: { home_base_address: '1 Main St, Raleigh, NC' } }),
        eq: () => ({ order: async () => ({ data: [] }) }),
      }),
    }),
  }),
}));
vi.mock('@/lib/toast', () => ({ toastError: () => {}, toastSuccess: () => {}, toastInfo: () => {} }));
vi.mock('@/components/WOTimeLogs', () => ({ default: () => null }));
vi.mock('@/components/HoursView', () => ({ JobDays: () => null }));
vi.mock('@/components/WorkOrderChatPanel', () => ({ default: () => null }));
const roundTripMiles = vi.fn(async () => 948.6);
vi.mock('@/lib/driving', () => ({ roundTripMiles: () => roundTripMiles() }));

const { default: WorkOrderModal } = await import('./WorkOrderModal');

const goldsboro = (billable_miles: number | null) => ({
  id: 'wo2', wo_number: '19101402', title: 'LDS Site 5006643', contractor_name: '', contractor_names: null, wo_status: 'Work Done',
  total_amount: 0, pay_addons: [], contractor_pay: null, billable_miles, billable_travel: null,
  site_address: '1000 Eleventh Street', site_city: 'Goldsboro', site_state: 'NC', site_zip: '27530', source_platform: 'Internal', archived_at: null,
}) as unknown as WorkOrder;

afterEach(() => { cleanup(); roundTripMiles.mockClear(); });

describe('Edit job: the mileage worked out once', () => {
  it('works the miles out for a job that never had them', async () => {
    render(<WorkOrderModal item={goldsboro(null)} contractors={[]} questionTemplates={[]} onSave={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(roundTripMiles).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /^Pay/ })).toBeTruthy();
  });

  it('leaves Pay off on a job saved with it removed (0 miles)', async () => {
    render(<WorkOrderModal item={goldsboro(0)} contractors={[]} questionTemplates={[]} onSave={() => {}} onClose={() => {}} />);
    await new Promise((ok) => setTimeout(ok, 50));
    expect(roundTripMiles).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull();
  });
});
