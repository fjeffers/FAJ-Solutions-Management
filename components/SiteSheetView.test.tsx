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
import type { SiteVisit, FormulaColumn } from '@/lib/types';

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
  created_at: '', updated_at: '', archived_at: null,
  ...over,
} as SiteVisit);

function draw(visits: SiteVisit[], formulaColumns: FormulaColumn[] = []) {
  const onSave = vi.fn();
  const onSaveFormula = vi.fn();
  const onDeleteFormula = vi.fn();
  render(
    <SiteSheetView
      visits={visits}
      picked={new Set()}
      onTogglePicked={() => {}}
      onSave={onSave}
      onDelete={() => {}}
      onAdd={() => {}}
      formulaColumns={formulaColumns}
      onSaveFormula={onSaveFormula}
      onDeleteFormula={onDeleteFormula}
    />,
  );
  return { onSave, onSaveFormula, onDeleteFormula };
}

const fc = (over: Partial<FormulaColumn>): FormulaColumn => ({
  id: String(over.id ?? 'f1'), user_id: 'u1', name: 'Margin',
  expression: '{Labor Total} / {Line Total}', format: 'percent',
  position: 0, applies_to: 'site_visits', created_at: '', updated_at: '',
  ...over,
});

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

  // ── Price: the one control the card and the grid must agree on ────────────
  describe('Price matches the card', () => {
    it('shows a flat project price, which the old rate box left blank', () => {
      // Folsom: $2,600 flat. rate is null, the price lives in the numeric column.
      draw([visit({ id: 'a', rate: null, total_project_price: 2600 })]);
      expect((screen.getByLabelText('Price amount') as HTMLInputElement).value).toBe('2600');
      expect((screen.getByLabelText('Price unit') as HTMLSelectElement).value).toBe('flat');
    });

    it('shows an hourly rate as the amount plus per hour', () => {
      draw([visit({ id: 'a', rate: '$55/hr', total_project_price: null })]);
      expect((screen.getByLabelText('Price amount') as HTMLInputElement).value).toBe('55');
      expect((screen.getByLabelText('Price unit') as HTMLSelectElement).value).toBe('hr');
    });

    it('typing an amount keeps the unit it already had', async () => {
      const user = userEvent.setup();
      const { onSave } = draw([visit({ id: 'a', rate: '$55/hr', total_project_price: null })]);
      const amount = screen.getByLabelText('Price amount');
      await user.clear(amount);
      await user.type(amount, '60');
      await user.tab();
      // Still hourly — editing the number must not silently make it a flat $60.
      expect(onSave).toHaveBeenCalledWith('a', { rate: '$60/hr', total_project_price: null });
    });

    it('re-pricing a flat job clears the project price instead of leaving it to win', async () => {
      const user = userEvent.setup();
      const { onSave } = draw([visit({ id: 'a', rate: null, total_project_price: 2600 })]);
      await user.selectOptions(screen.getByLabelText('Price unit'), 'hr');
      // This was the bug: total_project_price outranks rate, so unless it is
      // cleared the visit keeps billing 2600 whatever the rate says.
      expect(onSave).toHaveBeenCalledWith('a', { rate: '$2600/hr', total_project_price: null });
    });

    it('switching to flat moves the amount into the project price', async () => {
      const user = userEvent.setup();
      const { onSave } = draw([visit({ id: 'a', rate: '$55/hr', total_project_price: null })]);
      await user.selectOptions(screen.getByLabelText('Price unit'), 'flat');
      expect(onSave).toHaveBeenCalledWith('a', { rate: null, total_project_price: 55 });
    });

    it('clearing the amount clears both columns, leaving no stale price', async () => {
      const user = userEvent.setup();
      const { onSave } = draw([visit({ id: 'a', rate: '$55/hr', total_project_price: null })]);
      await user.clear(screen.getByLabelText('Price amount'));
      await user.tab();
      expect(onSave).toHaveBeenCalledWith('a', { rate: null, total_project_price: null });
    });

    it('does not save when the amount is left exactly as it was', async () => {
      const user = userEvent.setup();
      const { onSave } = draw([visit({ id: 'a', rate: '$55/hr' })]);
      await user.click(screen.getByLabelText('Price amount'));
      await user.tab();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('a flat-priced visit totals its fee, not fee x hours', () => {
      draw([visit({ id: 'a', hours: 6.73, rate: null, total_project_price: 2600, travel_charge: 80.9 })]);
      expect(screen.getAllByText('$2,680.90').length).toBeGreaterThan(0);
    });
  });

  // ── Formula columns: Smartsheet's and Monday's feature, in Fred's grid ─────
  describe('formula columns', () => {
    it('adds a column of its own and computes it per row', () => {
      // 2h x $55 = 110 labour; total 168.70. Effective rate = 84.35/h.
      draw([visit({ id: 'a' })], [fc({ name: 'Rate/hr', expression: '{Line Total} / {Hours}', format: 'money' })]);
      expect(screen.getByText('Rate/hr')).toBeTruthy();
      // Once on the row, once in the money total at the foot.
      expect(screen.getAllByText('$84.35').length).toBe(2);
    });

    it('totals a money formula column at the foot', () => {
      draw(
        [visit({ id: 'a', hours: 2, travel_charge: 58.7 }), visit({ id: 'b', hours: 9, travel_charge: 56.65 })],
        [fc({ name: 'Labour', expression: '{Labor Total}', format: 'money' })],
      );
      // 110 + 495 = 605
      expect(screen.getAllByText('$605.00').length).toBeGreaterThan(0);
    });

    it('does not total a percentage column, which would be meaningless', () => {
      draw([visit({ id: 'a' }), visit({ id: 'b' })], [fc({ name: 'Margin', format: 'percent' })]);
      // 65% appears on the rows, never summed into 130%
      expect(screen.queryByText('130%')).toBeNull();
    });

    it('marks just the broken cell when a formula cannot be worked out', () => {
      draw([visit({ id: 'a' })], [fc({ name: 'Oops', expression: '{Nonsense} * 2', format: 'number' })]);
      expect(screen.getByText('error')).toBeTruthy();
      // The rest of the row still renders.
      expect(screen.getByDisplayValue('Hillside')).toBeTruthy();
    });

    it('accepts the Smartsheet spelling as readily as the Monday one', () => {
      draw([visit({ id: 'a' })], [fc({ name: 'S', expression: '[Hours]@row * 10', format: 'number' })]);
      expect(screen.getByText('20')).toBeTruthy();
    });

    it('opens the editor from the toolbar and previews the result as you type', async () => {
      const user = userEvent.setup();
      draw([visit({ id: 'a' })]);
      await user.click(screen.getByRole('button', { name: /formula column/i }));
      await user.type(screen.getByPlaceholderText('{Line Total} / {Hours}'), '{{Hours} * 10');
      expect(screen.getByText(/On the first row this reads/)).toBeTruthy();
      expect(screen.getByText('20')).toBeTruthy();
    });

    it('will not save a formula that does not work', async () => {
      const user = userEvent.setup();
      const { onSaveFormula } = draw([visit({ id: 'a' })]);
      await user.click(screen.getByRole('button', { name: /formula column/i }));
      await user.type(screen.getByPlaceholderText('e.g. Margin, Rate per hour, Unbilled'), 'Broken');
      await user.type(screen.getByPlaceholderText('{Line Total} / {Hours}'), '{{Nope} * 2');
      const save = screen.getByRole('button', { name: /add column/i });
      expect((save as HTMLButtonElement).disabled).toBe(true);
      await user.click(save);
      expect(onSaveFormula).not.toHaveBeenCalled();
    });

    it('saves a good one with its heading, formula and format', async () => {
      const user = userEvent.setup();
      const { onSaveFormula } = draw([visit({ id: 'a' })]);
      await user.click(screen.getByRole('button', { name: /formula column/i }));
      await user.type(screen.getByPlaceholderText('e.g. Margin, Rate per hour, Unbilled'), 'Rate per hour');
      await user.type(screen.getByPlaceholderText('{Line Total} / {Hours}'), '{{Line Total} / {{Hours}');
      await user.selectOptions(screen.getByDisplayValue('Number'), 'money');
      await user.click(screen.getByRole('button', { name: /add column/i }));
      expect(onSaveFormula).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Rate per hour', expression: '{Line Total} / {Hours}', format: 'money' }),
      );
    });

    it('shows no formula controls when the parent does not allow editing', () => {
      render(
        <SiteSheetView visits={[visit({ id: 'a' })]} picked={new Set()} onTogglePicked={() => {}}
          onSave={() => {}} onDelete={() => {}} onAdd={() => {}} />,
      );
      expect(screen.queryByRole('button', { name: /formula column/i })).toBeNull();
    });
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
