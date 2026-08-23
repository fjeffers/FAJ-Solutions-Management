// @vitest-environment jsdom
//
// Tests against the real Site Sheet grid, not just the grouping maths.
//
// The board rewrite added group headings, collapsing, sorting and colour
// pills. All four are wiring: they can be individually correct and still not
// reach the screen. These render the component, click it, and read back what
// Fred would see.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SiteSheetView from './SiteSheetView';
import type { SiteVisit } from '@/lib/types';

vi.mock('@/lib/toast', () => ({ toastError: () => {}, toastSuccess: () => {}, toastInfo: () => {} }));
vi.mock('@/lib/export', () => ({ copyToClipboard: async () => true }));

const visit = (over: Record<string, unknown>): SiteVisit => ({
  id: String(over.id ?? Math.random()),
  user_id: 'u1',
  program: "Wendy's",
  site_code: '1331',
  site_name: 'Hillside',
  address: '410 Route 221 Hillside, NJ 07205',
  visit_date: '2026-08-21',
  time_in: null, time_out: null, sessions: [],
  hours: 2, rate: '$55/hr', total_project_price: null, visit_type: 'T&M',
  invoice_status: 'not_invoiced', payment_status: 'unpaid',
  miles: 117.4, travel_charge: 58.7,
  materials_description: null, materials_cost: null, other_charges: null,
  additional_details: null, notes: null, client_summary: null,
  work_order_id: null, customer_id: null, contractor_id: null, tech_ids: [],
  created_at: '', updated_at: '',
  ...over,
} as SiteVisit);

function draw(visits: SiteVisit[]) {
  const onSave = vi.fn();
  render(
    <SiteSheetView
      visits={visits}
      picked={new Set()}
      onTogglePicked={() => {}}
      onSave={onSave}
      onDelete={() => {}}
      onAdd={() => {}}
    />,
  );
  return { onSave };
}

const groupBy = () => screen.getByRole('combobox', { name: /group by/i });

afterEach(cleanup);

describe('Site Sheet board', () => {
  it('shows a flat list with no group headings until grouping is chosen', () => {
    draw([visit({ id: 'a' }), visit({ id: 'b', program: 'State Farm' })]);
    expect(screen.queryByText('State Farm')).toBeNull();
    expect(screen.getByText(/2 sites/)).toBeTruthy();
  });

  it('groups by customer and shows each section with its own total', async () => {
    const user = userEvent.setup();
    draw([
      visit({ id: 'a', program: "Wendy's", hours: 2, travel_charge: 58.7 }),
      visit({ id: 'b', program: 'State Farm', hours: 4, travel_charge: 0 }),
    ]);
    await user.selectOptions(groupBy(), 'program');

    expect(screen.getByText('State Farm')).toBeTruthy();
    expect(screen.getByText("Wendy's")).toBeTruthy();
    // 4h x $55 = $220 for State Farm; 2h x $55 + $58.70 = $168.70 for Wendy's.
    // Each shows twice — once on the group heading, once on the row itself.
    expect(screen.getAllByText('$220.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$168.70').length).toBeGreaterThan(0);
  });

  it('collapses a group when its heading is clicked, and brings it back', async () => {
    const user = userEvent.setup();
    draw([
      visit({ id: 'a', program: "Wendy's", site_name: 'Hillside' }),
      visit({ id: 'b', program: 'State Farm', site_name: 'Kunkletown' }),
    ]);
    await user.selectOptions(groupBy(), 'program');
    expect(screen.getByDisplayValue('Kunkletown')).toBeTruthy();

    await user.click(screen.getByText('State Farm'));
    expect(screen.queryByDisplayValue('Kunkletown')).toBeNull();
    // The other group is untouched.
    expect(screen.getByDisplayValue('Hillside')).toBeTruthy();

    await user.click(screen.getByText('State Farm'));
    expect(screen.getByDisplayValue('Kunkletown')).toBeTruthy();
  });

  it('orders month groups by the calendar, not the alphabet', async () => {
    const user = userEvent.setup();
    draw([
      visit({ id: 'a', visit_date: '2026-08-04' }),
      visit({ id: 'b', visit_date: '2026-06-20' }),
      visit({ id: 'c', visit_date: '2026-07-31' }),
    ]);
    await user.selectOptions(groupBy(), 'month');
    const headings = screen.getAllByText(/^(June|July|August) 2026$/).map((el) => el.textContent);
    expect(headings).toEqual(['June 2026', 'July 2026', 'August 2026']);
  });

  it('sorts by a column when its heading is clicked, and reverses on a second click', async () => {
    const user = userEvent.setup();
    draw([
      visit({ id: 'a', site_name: 'Zebra', hours: 9 }),
      visit({ id: 'b', site_name: 'Apple', hours: 2 }),
    ]);
    const namesInOrder = () =>
      screen.getAllByDisplayValue(/^(Zebra|Apple)$/).map((el) => (el as HTMLInputElement).value);

    await user.click(screen.getByText('Site Name'));
    expect(namesInOrder()).toEqual(['Apple', 'Zebra']);

    await user.click(screen.getByText('Site Name'));
    expect(namesInOrder()).toEqual(['Zebra', 'Apple']);
  });

  it('offers to clear the sort only once something is sorted', async () => {
    const user = userEvent.setup();
    draw([visit({ id: 'a' })]);
    expect(screen.queryByRole('button', { name: /clear sort/i })).toBeNull();
    await user.click(screen.getByText('Site Name'));
    expect(screen.getByRole('button', { name: /clear sort/i })).toBeTruthy();
  });

  it('still edits a cell and saves it while grouped', async () => {
    const user = userEvent.setup();
    const { onSave } = draw([visit({ id: 'a', site_name: 'Hillside' })]);
    await user.selectOptions(groupBy(), 'program');

    const cell = screen.getByDisplayValue('Hillside');
    await user.clear(cell);
    await user.type(cell, 'Hillside 1331');
    await user.tab();

    expect(onSave).toHaveBeenCalledWith('a', { site_name: 'Hillside 1331' });
  });

  it('changing a status pill saves the new status', async () => {
    const user = userEvent.setup();
    const { onSave } = draw([visit({ id: 'a', invoice_status: 'not_invoiced' })]);
    const pill = screen.getByDisplayValue('Not Invoiced');
    await user.selectOptions(pill, 'invoiced');
    expect(onSave).toHaveBeenCalledWith('a', { invoice_status: 'invoiced' });
  });

  it('the grand total still reflects every row, grouped or not', async () => {
    const user = userEvent.setup();
    draw([
      visit({ id: 'a', hours: 2, travel_charge: 58.7 }),   // 168.70
      visit({ id: 'b', hours: 9, travel_charge: 56.65 }),  // 551.65
    ]);
    // Ungrouped there is one $720.35, in the footer.
    expect(screen.getAllByText('$720.35').length).toBe(1);

    // Grouped, the same figure also heads the single month group — the footer
    // still totals everything rather than only what is expanded.
    await user.selectOptions(groupBy(), 'month');
    expect(screen.getAllByText('$720.35').length).toBe(2);
  });

  it('keeps every row on screen when grouping is switched', async () => {
    const user = userEvent.setup();
    draw([
      visit({ id: 'a', site_name: 'Hillside' }),
      visit({ id: 'b', site_name: 'Chester', program: 'State Farm', visit_date: null }),
    ]);
    for (const by of ['program', 'month', 'visit_type', 'invoice_status', 'site', 'none']) {
      await user.selectOptions(groupBy(), by);
      expect(screen.getByDisplayValue('Hillside'), `grouping by ${by}`).toBeTruthy();
      expect(screen.getByDisplayValue('Chester'), `grouping by ${by}`).toBeTruthy();
    }
  });

  it('names the group rather than showing a blank heading when a field is empty', async () => {
    const user = userEvent.setup();
    draw([visit({ id: 'a', program: null })]);
    await user.selectOptions(groupBy(), 'program');
    expect(screen.getByText('No customer')).toBeTruthy();
  });

  it('counts the visits in each group heading', async () => {
    const user = userEvent.setup();
    draw([
      visit({ id: 'a', program: "Wendy's" }),
      visit({ id: 'b', program: "Wendy's" }),
      visit({ id: 'c', program: 'State Farm' }),
    ]);
    await user.selectOptions(groupBy(), 'program');
    expect(screen.getByText('2 visits')).toBeTruthy();
    expect(screen.getByText('1 visit')).toBeTruthy();
  });
});
