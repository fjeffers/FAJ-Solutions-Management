// @vitest-environment jsdom
//
// A job opened from another screen (the Dashboard) goes back there when it
// closes, once. Fred, 2026-10-25: "when i go into dispatched and try to work
// ther it keep pushung me vack to dashboard": every job closed on the board
// sent him to the Dashboard, because the board still thought it was opened
// from there.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: () => Promise.resolve({ data: [] }) }) }));
vi.mock('@/lib/toast', () => ({ toastError: () => {}, toastSuccess: () => {}, toastInfo: () => {} }));
vi.mock('@/components/useJobTemplates', () => ({ useJobTemplates: () => ({ templates: [] }) }));
vi.mock('@/components/WorkFlowView', () => ({
  default: ({ openId, onOpenChange }: { openId: string | null; onOpenChange: (id: string | null) => void }) => (
    <div>
      <span>Job {openId}</span>
      <button onClick={() => onOpenChange('b')}>Open job b</button>
      <button onClick={() => onOpenChange(null)}>Back</button>
    </div>
  ),
  OwnerAlerts: () => null,
}));
vi.mock('@/components/wf/PrimioScreens', () => ({
  DispatchBoard: ({ onOpen }: { onOpen: (j: { id: string }) => void }) => (
    <div><span>The board</span><button onClick={() => onOpen({ id: 'b' })}>Card b</button></div>
  ),
}));

const { default: WorkOrdersView } = await import('./WorkOrdersView');

window.scrollTo = () => {};
type Props = Parameters<typeof WorkOrdersView>[0];
const board = (props: Partial<Props>) => {
  const all = { workOrders: [], contractors: [], payments: [], siteVisits: [], stats: { remaining: 0 }, onRefresh: () => {}, ...props } as unknown as Props;
  return <WorkOrdersView {...all} />;
};

afterEach(() => cleanup());

describe('Dispatch board: back from a job', () => {
  it('goes back to the screen the job was opened from, once', async () => {
    const user = userEvent.setup();
    const onJobClosed = vi.fn();
    render(board({ startOpenId: 'a', onJobClosed }));
    expect(screen.getByText('Job a')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onJobClosed).toHaveBeenCalledTimes(1);
  });

  it('stays on the board once another job is opened and worked', async () => {
    const user = userEvent.setup();
    const onJobClosed = vi.fn();
    render(board({ startOpenId: 'a', onJobClosed }));
    await user.click(screen.getByRole('button', { name: 'Open job b' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onJobClosed).not.toHaveBeenCalled();
    expect(screen.getByText('The board')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Card b' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onJobClosed).not.toHaveBeenCalled();
  });
});
