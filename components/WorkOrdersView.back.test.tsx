// @vitest-environment jsdom
//
// Fred, 2026-11-02: "when i type in that tech name all they work order show up and i edit it then i hit
// back once it showes me only that tech when i hit back again it goes back to home".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: () => Promise.resolve({ data: [] }) }) }));
vi.mock('@/lib/toast', () => ({ toastError: () => {}, toastSuccess: () => {}, toastInfo: () => {} }));
vi.mock('@/components/useJobTemplates', () => ({ useJobTemplates: () => ({ templates: [] }) }));
vi.mock('@/components/WorkFlowView', () => ({
  default: ({ openId, onOpenChange }: { openId: string | null; onOpenChange: (id: string | null) => void }) => (
    <div><span>Job {openId}</span><button onClick={() => onOpenChange(null)}>Back</button></div>
  ),
  OwnerAlerts: () => null,
}));
vi.mock('@/components/wf/PrimioScreens', () => ({
  DispatchBoard: ({ onOpen, query, onQuery }: { onOpen: (j: { id: string }) => void; query: string; onQuery: (q: string) => void }) => (
    <div>
      <input aria-label="Search" value={query} onChange={(e) => onQuery(e.target.value)} />
      <span>Showing {query || 'every job'}</span>
      <button onClick={() => onOpen({ id: 'b' })}>Card b</button>
    </div>
  ),
}));

const { default: WorkOrdersView } = await import('./WorkOrdersView');

window.scrollTo = () => {};
type Props = Parameters<typeof WorkOrdersView>[0];
const all = { workOrders: [], contractors: [], payments: [], siteVisits: [], stats: { remaining: 0 }, onRefresh: () => {} } as unknown as Props;

afterEach(() => cleanup());

describe('Home: back from a job found by a search', () => {
  it('keeps the tech searched for on the first Back, and shows every job on the next', async () => {
    const user = userEvent.setup();
    render(<WorkOrdersView {...all} />);
    await user.type(screen.getByLabelText('Search'), 'Raja');
    await user.click(screen.getByRole('button', { name: 'Card b' }));
    expect(screen.getByText('Job b')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Showing Raja')).toBeTruthy();
    window.history.back();
    await waitFor(() => expect(screen.getByText('Showing every job')).toBeTruthy());
  });

  it("closes the job on the browser's or phone's Back too", async () => {
    const user = userEvent.setup();
    render(<WorkOrdersView {...all} />);
    await user.type(screen.getByLabelText('Search'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Card b' }));
    window.history.back();
    expect(await screen.findByText('Showing Ana')).toBeTruthy();
  });
});
