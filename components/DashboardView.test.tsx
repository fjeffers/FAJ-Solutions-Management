// @vitest-environment jsdom
//
// Tests against the real Dashboard, not the maths underneath it.
//
// Closing a job used to change nothing here: nothing on this screen looked at
// archived_at, so a closed job stayed in Outstanding Jobs and kept its place
// in the Paid/Partial/Pending counts. Fred closed jobs and reported they were
// "still showing" — this is that bug, held down.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import DashboardView from './DashboardView';
import type { EnrichedWorkOrder } from '@/lib/types';

afterEach(cleanup);

const wo = (over: Partial<EnrichedWorkOrder> = {}): EnrichedWorkOrder => ({
  id: 'w1', wo_number: '19101350', user_id: 'u',
  contractor_name: 'Frederick Jeffers', title: 'Wendy\u2019s \u2014 Somerset',
  total_amount: 1138.25, wo_status: 'Approved',
  assignment_responses: null, archived_at: null,
  paid: 0, remaining: 500, payment_status: 'pending', payout_total: 500,
  ...over,
} as EnrichedWorkOrder);

const stats = {
  total: 0, paid: 0, remaining: 0,
  paidCount: 99, partialCount: 99, pendingCount: 99, jobCount: 99,
};

const show = (workOrders: EnrichedWorkOrder[]) =>
  render(
    <DashboardView stats={stats} workOrders={workOrders} payments={[]} onView={() => {}} />,
  );

describe('closed jobs leave the dashboard', () => {
  it('drops a closed job out of Outstanding Jobs', () => {
    show([
      wo({ id: 'live', wo_number: '19101350' }),
      wo({ id: 'closed', wo_number: '19101338', archived_at: '2026-08-30T00:00:00Z' }),
    ]);
    expect(screen.getByText('WO#19101350')).toBeTruthy();
    expect(screen.queryByText('WO#19101338')).toBeNull();
  });

  it('says all jobs are paid once the only unpaid one is closed', () => {
    show([wo({ archived_at: '2026-08-30T00:00:00Z' })]);
    expect(screen.getByText('All jobs paid!')).toBeTruthy();
  });

  it('counts only live jobs, ignoring the stats it was handed', () => {
    // stats says 99 of each. The screen must show what is actually live: one
    // pending job, nothing paid or partial.
    show([
      wo({ id: 'a', payment_status: 'pending' }),
      wo({ id: 'b', payment_status: 'paid', archived_at: '2026-08-30T00:00:00Z' }),
      wo({ id: 'c', payment_status: 'partial', archived_at: '2026-08-30T00:00:00Z' }),
    ]);
    expect(screen.queryByText('99')).toBeNull();
    const counts = ['Paid Jobs', 'Partial', 'Pending'].map((label) => {
      const el = screen.getByText(label);
      return el.parentElement?.querySelector('div')?.textContent;
    });
    expect(counts).toEqual(['0', '0', '1']);
  });

  it('still shows a live unpaid job', () => {
    show([wo()]);
    expect(screen.getByText('WO#19101350')).toBeTruthy();
    expect(screen.queryByText('All jobs paid!')).toBeNull();
  });
});
