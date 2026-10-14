import { describe, it, expect } from 'vitest';
import { buildSheet, pageRows, sheetCsv, sheetEmailHtml, siteLabel, type SheetInput } from './project-sheet';
import { placeFromNominatim, townOf, needsPlace } from './places';

// Tue 2026-10-14 in New York (EDT, UTC-4).
const at = (hhmm: string, day = '2026-10-14') => new Date(`${day}T${hhmm}:00-04:00`).toISOString();
const NOW = new Date(at('18:00'));

const job = {
  id: 'wo-1', wo_number: 'P-100', external_wo_id: 'CL-9', title: 'Network refresh', description: '',
  site_name: '#4454', site_address: '45 Grove St', site_city: 'Orange', site_state: 'NJ', site_zip: '07050',
  closeout_notes: 'Racked the switch.', custom_qa: [{ id: 'q1', label: 'Ceiling height', type: 'text', answer: '12 ft' }],
  closeout: { done: ['Before photos of the work area'], delays: [], signoff: null }, wo_status: 'In Progress',
};

// Fred's example: Mike starts traveling 6:47 from 123 Main St, arrives 7:50
// at 45 Grove St, takes a photo the app labels "Inventory".
const input = (over: Partial<SheetInput> = {}): SheetInput => ({
  project: 'Orange refresh',
  jobs: [job],
  taps: [
    { id: 'e1', wo_id: 'wo-1', contractor_name: 'Mike', kind: 'day_start', at: at('06:40'), place: '9 Elm St, West Orange, NJ' },
    { id: 'e2', wo_id: 'wo-1', contractor_name: 'Mike', kind: 'travel_start', at: at('06:47'), origin: 'hotel', dest: 'site', place: '123 Main St, Orange, NJ' },
    { id: 'e3', wo_id: 'wo-1', contractor_name: 'Mike', kind: 'travel_end', at: at('07:50'), dest: 'site', miles: 4.2 },
    { wo_id: 'wo-1', contractor_name: 'Mike', kind: 'in', at: at('07:50') },
    { wo_id: 'wo-1', contractor_name: 'Mike', kind: 'out', at: at('15:50') },
    { id: 'e4', wo_id: 'wo-1', contractor_name: 'Davis', kind: 'travel_start', at: at('07:00'), origin: 'home', dest: 'site', place: '7 Oak Ave, Easton, PA' },
  ],
  photos: [
    { id: 'p1', wo_id: 'wo-1', contractor_name: 'Mike', url: 'https://x.supabase.co/storage/v1/object/public/a.jpg', taken_at: at('07:58'), label: 'Inventory' },
    { id: 'p2', wo_id: 'wo-1', contractor_name: 'Mike', url: 'https://x.supabase.co/storage/v1/object/public/b.jpg', taken_at: at('08:01'), label: null },
    { id: 'p3', wo_id: 'wo-1', contractor_name: 'Mike', url: 'javascript:alert(1)', taken_at: at('08:02') },
  ],
  expenses: [
    { id: 'x1', wo_id: 'wo-1', contractor_name: 'Mike', category: 'fuel', vendor: 'Sunoco', amount: '42.10', expense_date: '2026-10-14', note: '', receipt_path: 'wo-1/r.jpg', created_at: at('12:10'), paid_by: 'tech' },
  ],
  lists: [],
  ...over,
});

describe('buildSheet', () => {
  const s = buildSheet(input(), NOW);
  const mike = pageRows(s, 'wo-1', 'Mike');

  it('reads line by line, oldest first, new lines at the bottom', () => {
    expect(mike.map((r) => r.activity)).toEqual([
      'Clocked in', 'Started traveling', 'Arrived on site · started the job',
      'Took a photo: Inventory', 'Took a photo', 'Added a receipt: Fuel', 'Left the site',
    ]);
    expect(mike.map((r) => r.time)).toEqual(['6:40 AM', '6:47 AM', '7:50 AM', '7:58 AM', '8:01 AM', '12:10 PM', '3:50 PM']);
  });

  it('says where: from the GPS address, at the site address, and the site with its town', () => {
    const drive = mike.find((r) => r.kind === 'drive')!;
    expect(drive.where).toBe('From 123 Main St, Orange, NJ');
    expect(drive.details).toBe('Heading to the site');
    expect(drive.site).toBe('#4454 – Orange, NJ');
    const arrive = mike.find((r) => r.kind === 'start')!;
    expect(arrive.where).toBe('At 45 Grove St, Orange, NJ 07050');
    expect(arrive.miles).toBe(4.2);
    expect(mike.find((r) => r.kind === 'photo')!.photo).toMatch(/^https:/);
  });

  it("keeps a tech's home private: the town only", () => {
    expect(mike[0].where).toBe('In West Orange, NJ');
    const davis = pageRows(s, 'wo-1', 'Davis');
    expect(davis[0].where).toBe('From Home · Easton, PA');
    expect(JSON.stringify(s)).not.toContain('7 Oak Ave');
    expect(JSON.stringify(s)).not.toContain('9 Elm St');
  });

  it('two people on the site share its page: each line in time order with their name', () => {
    expect(s.sites[0].techs).toEqual(['Mike', 'Davis']);
    const page = pageRows(s, 'wo-1', null);
    expect(page.slice(0, 4).map((r) => `${r.tech} ${r.time} ${r.activity}`)).toEqual([
      'Mike 6:40 AM Clocked in', 'Mike 6:47 AM Started traveling', 'Davis 7:00 AM Started traveling', 'Mike 7:50 AM Arrived on site · started the job',
    ]);
    expect(pageRows(s, 'wo-1', 'Davis')).toHaveLength(1);
  });

  it('a photo link that is not https is dropped', () => {
    expect(s.summary.photos).toBe(2);
  });

  it('the site: status, notes, answers, checklist; closed once Work Done', () => {
    const site = s.sites[0];
    expect(site).toMatchObject({ name: '#4454 – Orange, NJ', wo: 'P-100', clientWo: 'CL-9', status: 'In Progress', closed: false, notes: 'Racked the switch.' });
    expect(site.answers).toEqual([{ q: 'Ceiling height', a: '12 ft' }]);
    expect(site.checklist).toMatchObject({ done: 1, total: 5, sign: 'Not signed off yet' });
    expect(buildSheet(input({ jobs: [{ ...job, wo_status: 'Work Done' }] }), NOW).sites[0].closed).toBe(true);
  });

  it('totals: hours on site, miles, receipts', () => {
    expect(s.summary).toMatchObject({ sites: 1, techs: 2, onSiteHours: 8, miles: 4.2, receipts: 1, receiptTotal: 42.1 });
  });

  it('an arrival takes where it was headed from the trip that started it', () => {
    const more = input();
    more.taps.push(
      { id: 'e7', wo_id: 'wo-1', contractor_name: 'Mike', kind: 'travel_start', at: at('16:00'), origin: 'site', dest: 'hotel' },
      { id: 'e8', wo_id: 'wo-1', contractor_name: 'Mike', kind: 'travel_end', at: at('16:20'), dest: null, miles: 6, place: '1 Hotel Way, Orange, NJ' },
    );
    const page = pageRows(buildSheet(more, NOW), 'wo-1', 'Mike');
    expect(page.slice(-2).map((r) => `${r.activity} | ${r.where}`)).toEqual([
      'Started traveling | From 45 Grove St, Orange, NJ 07050',
      'Arrived at the hotel · signed out | At 1 Hotel Way, Orange, NJ',
    ]);
  });

  it('a late flag is a line on the page', () => {
    const s2 = buildSheet(input({ lates: [{ wo_id: 'wo-1', tech: 'Davis', due_at: at('08:30'), start_label: '8:00 AM' }] }), NOW);
    const late = pageRows(s2, 'wo-1', 'Davis').find((r) => r.kind === 'late')!;
    expect(late).toMatchObject({ time: '8:30 AM', activity: 'Not on site yet', details: '30 min past the 8:00 AM start' });
  });

  it('a later visit to the same site lands on the same page', () => {
    const more = input();
    more.taps.push({ id: 'e9', wo_id: 'wo-1', contractor_name: 'Mike', kind: 'travel_end', at: at('07:30', '2026-10-15'), dest: 'site', miles: 3 });
    const next = buildSheet(more, new Date(at('18:00', '2026-10-15')));
    const page = pageRows(next, 'wo-1', 'Mike');
    expect(page[page.length - 1]).toMatchObject({ day: '2026-10-15', activity: 'Arrived on site' });
    expect(next.sites).toHaveLength(1);
  });

  it('never carries a price or tech pay', () => {
    const j = { ...job, total_amount: 9999, contractor_pay: { Mike: 1234 } } as typeof job;
    const out = JSON.stringify(buildSheet(input({ jobs: [j] }), NOW));
    expect(out).not.toContain('9999');
    expect(out).not.toContain('1234');
  });
});

describe('sheetEmailHtml', () => {
  const s = buildSheet(input(), NOW);
  const html = sheetEmailHtml(s, {
    title: 'Mike started traveling', where: '#4454 · WO P-100 · 6:47 AM', lines: ['From 123 Main St, Orange, NJ'],
    siteId: 'wo-1', sheetLink: 'https://app/sheet/t?site=P-100', appLink: null,
    receiptLink: (id) => `https://app/sheet/t/receipt/${id}`,
  });
  it("shows the site's page (everyone on it) with the photo and the live sheet button, no app link for a PM", () => {
    expect(html).toContain('#4454 – Orange, NJ · WO P-100');
    expect(html).toContain('Davis');
    expect(html).toContain('Took a photo: Inventory');
    expect(html).toContain('https://x.supabase.co/storage/v1/object/public/a.jpg');
    expect(html).toContain('Open the live sheet');
    expect(html).not.toContain('Open the job');
    expect(html).toContain('https://app/sheet/t/receipt/x1');
    expect(html).not.toContain('javascript:');
  });
  it('escapes what techs type', () => {
    const bad = buildSheet(input({ photos: [{ id: 'p9', wo_id: 'wo-1', contractor_name: 'Mike', url: 'https://x/a.jpg', taken_at: at('09:00'), label: '<script>x</script>' }] }), NOW);
    const out = sheetEmailHtml(bad, { title: 't', where: 'w', lines: [], siteId: 'wo-1', sheetLink: null, appLink: null, receiptLink: () => '' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('sheetCsv', () => {
  it('a page as Excel lines, formulas defused', () => {
    const base = input();
    const s = buildSheet(input({ expenses: [{ ...base.expenses[0], vendor: '=HYPERLINK("x")' }] }), NOW);
    const csv = sheetCsv(pageRows(s, 'wo-1', 'Mike'), (id) => `https://app/r/${id}`);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('"Technician","Activity","Location"');
    expect(csv).toContain('"From 123 Main St, Orange, NJ"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).not.toMatch(/,"=HYPERLINK/);
  });
});

describe('siteLabel', () => {
  it('adds the town unless the name already has it', () => {
    expect(siteLabel(job)).toBe('#4454 – Orange, NJ');
    expect(siteLabel({ ...job, site_name: 'Orange store' })).toBe('Orange store');
    expect(siteLabel({ ...job, site_name: '', site_city: '', site_state: '' })).toBe('Network refresh');
  });
});

describe('places', () => {
  it('a Nominatim answer → "123 Main St, Orange, NJ"', () => {
    expect(placeFromNominatim({ address: { house_number: '123', road: 'Main St', city: 'Orange', state: 'New Jersey', 'ISO3166-2-lvl4': 'US-NJ' } }))
      .toBe('123 Main St, Orange, NJ');
    expect(placeFromNominatim({ address: { road: 'Route 22', town: 'Phillipsburg', 'ISO3166-2-lvl4': 'US-NJ' } })).toBe('Route 22, Phillipsburg, NJ');
    expect(placeFromNominatim({ error: 'Unable to geocode' })).toBe('');
    expect(placeFromNominatim(null)).toBe('');
  });
  it('townOf keeps the town and state only', () => {
    expect(townOf('7 Oak Ave, Easton, PA')).toBe('Easton, PA');
    expect(townOf('Easton, PA')).toBe('Easton, PA');
  });
  it('looks up clock in, setting off and signing out; not arriving on site', () => {
    expect(needsPlace({ kind: 'travel_start', lat: 40.7, lng: -74.2, place: null })).toBe(true);
    expect(needsPlace({ kind: 'day_start', lat: 40.7, lng: -74.2, place: null })).toBe(true);
    expect(needsPlace({ kind: 'day_start', lat: 40.7, lng: -74.2, place: '9 Elm St, West Orange, NJ' })).toBe(false);
    expect(needsPlace({ kind: 'travel_end', dest: 'site', lat: 40.7, lng: -74.2, place: null })).toBe(false);
    expect(needsPlace({ kind: 'travel_end', dest: 'hotel', lat: 40.7, lng: -74.2, place: null })).toBe(true);
    expect(needsPlace({ kind: 'travel_start', lat: null, lng: null, place: null })).toBe(false);
    expect(needsPlace({ kind: 'travel_start', lat: 40.7, lng: -74.2, place: '' })).toBe(false);
  });
});

describe('status pills (Smartsheet-style)', () => {
  it('each line and message gets a colored status', async () => {
    const { rowStatus, messageStatus, initials } = await import('./project-sheet');
    expect(rowStatus({ kind: 'drive' })).toEqual({ label: 'Traveling', tone: 'blue' });
    expect(rowStatus({ kind: 'start' })).toEqual({ label: 'On site', tone: 'green' });
    expect(rowStatus({ kind: 'late' })).toEqual({ label: 'Late', tone: 'orange' });
    expect(messageStatus({ kind: 'issue', resolvedAt: '' })).toEqual({ label: 'Stopped', tone: 'red' });
    expect(messageStatus({ kind: 'issue', resolvedAt: '2026-10-14T12:00:00Z' }).label).toBe('Resolved');
    expect(messageStatus({ kind: 'question', resolvedAt: '' }).label).toBe('Question');
    expect(initials('Frederick Jeffers')).toBe('FJ');
    expect(initials('  ')).toBe('?');
  });
});
