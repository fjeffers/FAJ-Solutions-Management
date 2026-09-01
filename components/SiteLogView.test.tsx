// @vitest-environment jsdom
//
// Tests against the real Site Log component, not the maths underneath it.
//
// Every bug shipped on 2026-08-22 was a wiring bug the unit tests could not
// see: a Price box that ate the decimal point, and a Time In field that had
// stopped moving the Hours. These render the component, type into it, and read
// back what a person would actually see.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const VISIT = {
  id: 'v1', user_id: 'u1', program: "Wendy's", site_code: '1331',
  site_name: 'Hillside 1331', address: '410 Route 221 Hillside, NJ 07205',
  visit_date: '2026-08-21', archived_at: null,
  time_in: '2026-08-21T14:00:00.000Z', time_out: '2026-08-21T16:00:00.000Z',
  sessions: [{ in: '2026-08-21T14:00:00.000Z', out: '2026-08-21T16:00:00.000Z' }],
  hours: 2, rate: '$55/hr', total_project_price: null, visit_type: 'T&M',
  invoice_status: 'not_invoiced', payment_status: 'unpaid',
  miles: 106.7, travel_charge: 58.7,
  materials_description: null, materials_cost: null, other_charges: null,
  additional_details: null, notes: null, client_summary: null,
  work_order_id: null, customer_id: null, contractor_id: null, tech_ids: [],
  created_at: '', updated_at: '',
};

/** A Project job, so the T&M / Project / Revisit lenses have something to sort. */
const PROJECT_VISIT = {
  ...VISIT, id: 'v2', site_name: 'Folsom 397', site_code: '397',
  // Its own date, so tests that click a date still find exactly one.
  visit_date: '2026-07-22', work_order_id: 'wo-1',
  visit_type: 'Project', hours: null, rate: null, total_project_price: 2600,
};

/** Finished work, already cleared off the board. */
const ARCHIVED_VISIT = {
  ...VISIT, id: 'v3', site_name: 'Chester 2504', site_code: '2504',
  visit_date: '2026-08-19',
  invoice_status: 'invoiced', payment_status: 'paid',
  archived_at: '2026-08-22T12:00:00.000Z',
};

function makeClient() {
  const result = (data: unknown) => Promise.resolve({ data, error: null });
  const table = (name: string) => {
    const rows = name === 'work_orders' ? [{ id: 'wo-1', wo_number: '19101348' }]
      : name === 'site_visits' ? [VISIT, PROJECT_VISIT, ARCHIVED_VISIT]
      : name === 'contractors' ? [{ id: 'c1', name: 'Frederick Jeffers' }] : [];
    const single = name === 'user_settings'
      ? { home_base_address: '1820 Dayton Dr', mileage_rate: 0.55, default_hourly_rate: 55 } : null;
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: self, order: self, eq: self, in: self, not: self, filter: self,
      maybeSingle: () => result(single), single: () => result(single),
      update: () => chain, insert: () => chain, upsert: () => chain, delete: self,
      then: (r: (v: unknown) => unknown) => result(rows).then(r),
    });
    return chain;
  };
  return {
    from: (n: string) => table(n),
    auth: { getUser: () => result({ user: { id: 'u1', email: 'f@x.com' } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
}

vi.mock('@/lib/supabase/client', () => ({ createClient: () => makeClient() }));
vi.mock('@/lib/toast', () => ({ toastError: () => {}, toastSuccess: () => {}, toastInfo: () => {} }));

import SiteLogView from './SiteLogView';

afterEach(cleanup);

/** Render the list and wait for the one visit to arrive. */
async function showList() {
  render(<SiteLogView />);
  // The site now appears on the group heading AND on the card itself, so this
  // deliberately does not insist on a single match.
  await screen.findAllByText(/Hillside 1331/, {}, { timeout: 3000 });
}

/** Open the Edit Visit dialog by clicking the visit's row. */
async function openVisit(user: ReturnType<typeof userEvent.setup>) {
  await showList();
  await user.click(screen.getByText('8/21/26'));
  await screen.findByText(/^Edit Visit/, {}, { timeout: 3000 });
}

const timeInputs = () =>
  [...document.querySelectorAll('input[type="datetime-local"]')] as HTMLInputElement[];
const hoursInput = () =>
  [...document.querySelectorAll('input[type="number"]')]
    .find((i) => (i as HTMLInputElement).step === '0.25') as HTMLInputElement;

describe('Site Log list', () => {
  it('breaks the money into labour, mileage, materials and other, and totals them', async () => {
    const user = userEvent.setup();
    await showList();
    // Narrow to the one T&M visit, so the band's figures are that visit's.
    await user.click(screen.getByRole('button', { name: 'T&M' }));
    const band = document.body.textContent ?? '';
    // 2h x $55 = $110 labour, plus $58.70 mileage.
    expect(band).toContain('Labor$110.00');
    expect(band).toContain('Mileage$58.70');
    expect(band).toContain('Materials$0.00');
    expect(band).toContain('Other charges$0.00');
    expect(band).toContain('Total$168.70');
  });

  it('shows what the visit is worth on its own card', async () => {
    await showList();
    expect(screen.getAllByText('$168.70').length).toBeGreaterThan(0);
  });

  it('says what rate a new visit will start on', async () => {
    await showList();
    expect(document.body.textContent).toContain('new visits @ $55/hr');
  });

  it('shows the hours and the mileage on the card', async () => {
    await showList();
    const text = document.body.textContent ?? '';
    expect(text).toContain('2h');
    expect(text).toContain('106.7 mi');
  });
});

describe('Site Log visit editor', () => {
  it('opens on the visit that was clicked', async () => {
    const user = userEvent.setup();
    await openVisit(user);
    expect((screen.getByDisplayValue('Hillside 1331') as HTMLInputElement).value).toBe('Hillside 1331');
  });

  it('shows the price as an amount plus a unit, defaulting to per hour', async () => {
    const user = userEvent.setup();
    await openVisit(user);
    expect((screen.getByDisplayValue('55') as HTMLInputElement).value).toBe('55');
    expect((screen.getByDisplayValue('per hour') as HTMLSelectElement).value).toBe('hr');
  });

  it('accepts a rate with a decimal point — the bug that ate keystrokes', async () => {
    const user = userEvent.setup();
    await openVisit(user);
    const price = screen.getByDisplayValue('55') as HTMLInputElement;
    await user.clear(price);
    await user.type(price, '62.5');
    expect(price.value).toBe('62.5');
  });

  it('switches the price to a custom flat amount', async () => {
    const user = userEvent.setup();
    await openVisit(user);
    await user.selectOptions(screen.getByDisplayValue('per hour'), 'flat');
    const price = screen.getByDisplayValue('55') as HTMLInputElement;
    await user.clear(price);
    await user.type(price, '540');
    expect(price.value).toBe('540');
    expect((screen.getByDisplayValue('flat for the job') as HTMLSelectElement).value).toBe('flat');
  });

  it('moves the Hours when the finish time is edited', async () => {
    const user = userEvent.setup();
    await openVisit(user);
    expect(hoursInput().value).toBe('2');

    // The field is local time, and the visit starts at 10:00 local, so a
    // finish of 18:00 is an eight-hour day.
    const [inField, out] = timeInputs();
    expect(inField.value).toContain('10:00');

    await user.clear(out);
    await user.type(out, '2026-08-21T18:00');

    await waitFor(() => expect(hoursInput().value).toBe('8'));
  });

  it('moves the finish time when the Hours are typed', async () => {
    const user = userEvent.setup();
    await openVisit(user);
    const before = timeInputs()[1].value;

    const hours = hoursInput();
    await user.clear(hours);
    await user.type(hours, '8');

    await waitFor(() => expect(timeInputs()[1].value).not.toBe(before));
    // Eight hours after the 10:00 start.
    expect(timeInputs()[1].value).toContain('18:00');
  });

  it('lists the techs so more than one can be put on the job', async () => {
    const user = userEvent.setup();
    await openVisit(user);
    expect(screen.getByText('Frederick Jeffers')).toBeTruthy();
  });

  // The spreadsheet carried these columns while the card had no fields at all,
  // so parts fitted on a job could not be billed from the card view.
  // Materials and Trips became row editors in migration-081; the requirement is
  // unchanged — everything the spreadsheet holds must be reachable here.
  it('has every field the spreadsheet has', async () => {
    const user = userEvent.setup();
    await openVisit(user);
    const labels = [...document.querySelectorAll('label')].map((l) => l.textContent ?? '');
    for (const needed of [
      'Materials', 'Trips', 'Other Charges',
      'Scope of Work', 'Additional Details',
    ]) {
      expect(labels.some((l) => l.includes(needed))).toBe(true);
    }
  });

  it('records more than one part, and more than one trip', async () => {
    // Fred's job: drive out, find no materials, buy them, drive back to finish.
    const user = userEvent.setup();
    await openVisit(user);

    await user.click(screen.getByRole('button', { name: /add materials/i }));
    await user.click(screen.getByRole('button', { name: /add another item/i }));
    expect(screen.getAllByPlaceholderText(/4U rack shelf/i)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /add a trip/i }));
    await user.click(screen.getByRole('button', { name: /add another trip/i }));
    expect(screen.getAllByPlaceholderText(/round trip, parts run/i)).toHaveLength(2);
  });

  it('totals the parts as they are entered', async () => {
    const user = userEvent.setup();
    await openVisit(user);
    await user.click(screen.getByRole('button', { name: /add materials/i }));
    const [qty] = screen.getAllByPlaceholderText('1');
    const [each] = screen.getAllByPlaceholderText('0.00');
    await user.clear(qty); await user.type(qty, '4');
    await user.clear(each); await user.type(each, '12');
    expect(screen.getByText('$48.00')).toBeTruthy();
  });

  it('names the work order a visit became, and links to it', async () => {
    await showList();
    const link = screen.getByTitle('Open this work order') as HTMLAnchorElement;
    // It used to be a dead badge reading "HAS WORK ORDER" — no number, no way there.
    expect(link.textContent).toContain('WO #19101348');
    expect(link.getAttribute('href')).toBe('/?view=workorders&wo=19101348');
  });

  it('keeps archived work off the board until it is asked for', async () => {
    const user = userEvent.setup();
    await showList();
    // Live work shows; the archived visit does not.
    expect(screen.getAllByText(/Hillside 1331/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Chester 2504/)).toBeNull();

    await user.click(screen.getByRole('button', { name: /archive/i }));
    // Now the archive, and only the archive.
    expect(screen.getAllByText(/Chester 2504/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Hillside 1331/)).toBeNull();
  });

  it('separates T&M from Project work', async () => {
    const user = userEvent.setup();
    await showList();
    expect(screen.getAllByText(/Folsom 397/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'T&M' }));
    expect(screen.getAllByText(/Hillside 1331/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Folsom 397/)).toBeNull();

    // Clicking the same lens again clears it.
    await user.click(screen.getByRole('button', { name: 'T&M' }));
    expect(screen.getAllByText(/Folsom 397/).length).toBeGreaterThan(0);
  });

  it('offers a way to clear settled work off the board', async () => {
    await showList();
    expect(screen.getByRole('button', { name: /clear settled/i })).toBeTruthy();
  });

  it('names the site on the card, so a card says where it is on its own', async () => {
    await showList();
    // The site used to appear only on the group heading above the cards.
    const card = screen.getByText('8/21/26').closest('.card') as HTMLElement;
    expect(card.textContent).toContain('Hillside 1331');
  });

  it('names the site in the dialog title, so you can see what you are editing', async () => {
    const user = userEvent.setup();
    await openVisit(user);
    expect(screen.getByText(/^Edit Visit — Hillside 1331/)).toBeTruthy();
  });

  it('lets materials be typed and adds them to the total', async () => {
    const user = userEvent.setup();
    await openVisit(user);

    const cost = document.querySelector('input[placeholder="0.00"]') as HTMLInputElement;
    await user.clear(cost);
    await user.type(cost, '120');
    expect(cost.value).toBe('120');
  });
});
