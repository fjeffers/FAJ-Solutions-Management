import { describe, expect, it } from 'vitest';
import {
  accessText, cleanScheduleRows, isCancelled, matchSchedule, newScheduleJob, parseSchedule, planFill,
  scheduleDate, scheduleLink, scheduleTime, siteKey, type ScheduleJob,
} from './client-schedule';

// The client's weekly sheet as Excel hands it over: Site ID as a number, the
// date as Excel's day number, the time as typed, "." for an empty tracking cell.
const HEADER = ['Acme Ticket Number', 'SiteID', 'Dispatch Date', 'Start Time', 'End Date', 'Status', 'Lockbox Code',
  'Lockbox Location', 'Floorplan', 'Address', 'City', 'State', 'Zip_', 'Deliverable Link', 'Tracking In', 'Tracking Out', 'CheckOUT Link'];
const FOLDER = 'https://drive.google.com/drive/folders/abc123';
const FORM = 'https://app.smartsheet.com/b/form/xyz';
const sheet = [
  HEADER,
  ['T-1001', 9000001, 46314, '8:00 am', null, 'Tech Assigned', 1234, 'Rear door', null, '1 Main St', 'SPRINGFIELD', 'NJ', 7801, FOLDER, '.', null, FORM],
  ['T-1002', 9000002, 46314, '1:00 pm', null, 'Tech Assigned', 5678, 'Side gate', 'https://example.com/plan.pdf', '2 Oak Ave', 'SHELBY', 'NC', '28150', '', '.', null, FORM],
  [],
  [null, null, null, null],
];

const job = (over: Partial<ScheduleJob> = {}): ScheduleJob => ({
  id: 'j1', wo_number: '19100001', title: 'Site survey 9000001 — Springfield, NJ', wo_status: 'Assigned',
  customer_name: 'Client Co', source_platform: 'Internal',
  client_reference: '9000001', external_wo_id: null, start_date: '2026-10-19', start_time: '08:00', end_date: '2026-10-19',
  site_address: '1 Main St', site_city: 'Springfield', site_state: 'NJ', site_zip: '07801',
  access_instructions: null, client_links: [FORM], checkin_link: null, checkout_link: FORM,
  ...over,
});

describe('parseSchedule', () => {
  it('reads the weekly sheet by its column names', () => {
    const { rows, error } = parseSchedule(sheet);
    expect(error).toBeUndefined();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      line: 2, siteId: '9000001', ticket: 'T-1001', date: '2026-10-19', time: '08:00', endDate: null,
      status: 'Tech Assigned', lockboxCode: '1234', lockboxLocation: 'Rear door', address: '1 Main St',
      city: 'SPRINGFIELD', state: 'NJ', zip: '07801', deliverables: FOLDER, floorplan: '', checkout: FORM, checkin: '',
    });
    expect(rows[1]).toMatchObject({ line: 3, time: '13:00', floorplan: 'https://example.com/plan.pdf', deliverables: '' });
  });

  it('skips title rows above the header and says when there is no Site ID column', () => {
    expect(parseSchedule([['Week of 10/19'], [], ...sheet]).rows[0].line).toBe(4);
    expect(parseSchedule([['Ticket', 'Date'], ['T-1', '10/19/2026']]).error).toMatch(/Site ID/);
    expect(parseSchedule([HEADER, [], ['T-9', null]]).error).toMatch(/no rows/);
  });

  it("doesn't mistake other columns for the date or time", () => {
    const { rows } = parseSchedule([
      ['Vendor', 'Last Update', 'Site ID', 'Visit Date', 'Tracking Time', 'Arrival Time'],
      ['X', '1/1/2020', '42', '10/20/2026', '9:00 am', '10:30 AM'],
    ]);
    expect(rows[0]).toMatchObject({ siteId: '42', date: '2026-10-20', time: '10:30', endDate: null });
  });
});

describe('cells', () => {
  it('dates: Excel day numbers, typed dates, and nonsense', () => {
    expect(scheduleDate(46314)).toBe('2026-10-19');
    expect(scheduleDate('10/19/2026')).toBe('2026-10-19');
    expect(scheduleDate('10/19/26')).toBe('2026-10-19');
    expect(scheduleDate('2026-10-19')).toBe('2026-10-19');
    expect(scheduleDate('Monday, October 19, 2026')).toBe('2026-10-19');
    expect(scheduleDate('2/30/2026')).toBeNull();
    expect(scheduleDate('TBD')).toBeNull();
    expect(scheduleDate(12)).toBeNull();
  });

  it('times: typed, 24-hour, and Excel fractions of a day', () => {
    expect(scheduleTime('8:00 am')).toBe('08:00');
    expect(scheduleTime('8 AM')).toBe('08:00');
    expect(scheduleTime('12:00 pm')).toBe('12:00');
    expect(scheduleTime('12:30 a.m.')).toBe('00:30');
    expect(scheduleTime('13:00')).toBe('13:00');
    expect(scheduleTime('08:00:00')).toBe('08:00');
    expect(scheduleTime(0.5)).toBe('12:00');
    expect(scheduleTime(46314.375)).toBe('09:00');
    expect(scheduleTime('8')).toBeNull();
    expect(scheduleTime('morning')).toBeNull();
  });

  it('links: the first web address, nothing else', () => {
    expect(scheduleLink(`Folder: ${FOLDER}.`)).toBe(FOLDER);
    expect(scheduleLink('see email')).toBe('');
    expect(scheduleLink('.')).toBe('');
  });

  it('site IDs match however they are typed', () => {
    expect(siteKey('05007927')).toBe(siteKey('5007927'));
    expect(siteKey(' AB-12 ')).toBe('ab-12');
  });
});

describe('cleanScheduleRows', () => {
  it('keeps the shape and drops what the browser should never send', () => {
    const [r] = parseSchedule(sheet).rows;
    expect(cleanScheduleRows([r])).toEqual([r]);
    const bad = cleanScheduleRows([{ ...r, date: 'tomorrow', time: '25:00', checkout: 'javascript:alert(1)', siteId: 'x'.repeat(200) }, { siteId: '' }, null, 'x']);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ date: null, time: null, checkout: '' });
    expect(bad[0].siteId).toHaveLength(80);
    expect(cleanScheduleRows('nope')).toEqual([]);
  });
});

describe('matchSchedule', () => {
  const rows = parseSchedule(sheet).rows;

  it('finds each row its job by Site ID', () => {
    const a = job();
    const b = job({ id: 'j2', client_reference: '9000002', start_date: '2026-10-19' });
    expect(matchSchedule(rows, [b, a]).map((j) => j?.id)).toEqual(['j1', 'j2']);
  });

  it("the row's ticket wins; a different ticket is a different visit", () => {
    const old = job({ id: 'old', external_wo_id: 'T-0999', start_date: '2026-10-18' });
    const mine = job({ id: 'mine', external_wo_id: 'T-1001', start_date: '2026-09-01' });
    expect(matchSchedule(rows.slice(0, 1), [old, mine])[0]?.id).toBe('mine');
    expect(matchSchedule(rows.slice(0, 1), [old])[0]).toBeNull();
    // A row without a ticket still finds the job that has one.
    expect(matchSchedule([{ ...rows[0], ticket: '' }], [old])[0]?.id).toBe('old');
  });

  it('passes over paid jobs and visits more than a month away', () => {
    expect(matchSchedule(rows.slice(0, 1), [job({ wo_status: 'Paid' })])[0]).toBeNull();
    expect(matchSchedule(rows.slice(0, 1), [job({ start_date: '2026-07-01' })])[0]).toBeNull();
    expect(matchSchedule(rows.slice(0, 1), [job({ start_date: null })])[0]?.id).toBe('j1');
  });

  it('two visits to one site take two jobs, nearest date first', () => {
    const twice = [rows[0], { ...rows[0], line: 9, ticket: '', date: '2026-10-22' }];
    const mon = job({ id: 'mon', start_date: '2026-10-19' });
    const thu = job({ id: 'thu', start_date: '2026-10-22' });
    expect(matchSchedule(twice, [thu, mon]).map((j) => j?.id)).toEqual(['mon', 'thu']);
    expect(matchSchedule(twice, [mon]).map((j) => j?.id ?? null)).toEqual(['mon', null]);
  });
});

describe('planFill', () => {
  const [r] = parseSchedule(sheet).rows;

  it('fills only what the job is missing', () => {
    const { patch, filled, differs } = planFill(r, job());
    expect(patch).toEqual({
      external_wo_id: 'T-1001',
      access_instructions: 'Lockbox code 1234. Lockbox: Rear door',
      client_links: [FORM, FOLDER],
    });
    expect(filled).toEqual(['ticket', 'lockbox', 'deliverables folder']);
    expect(differs).toEqual([]);
  });

  it('a filled job gets nothing, and the same sheet twice changes nothing', () => {
    const once = planFill(r, job());
    const again = planFill(r, job(once.patch));
    expect(again.patch).toEqual({});
    expect(again.filled).toEqual([]);
  });

  it('a job with nothing yet gets the whole row', () => {
    const empty = job({
      start_date: null, start_time: null, end_date: null, site_address: null, site_city: null, site_state: null, site_zip: null,
      client_links: null, checkout_link: null,
    });
    const { patch, filled } = planFill(r, empty);
    expect(patch).toMatchObject({
      start_date: '2026-10-19', start_time: '08:00', end_date: '2026-10-19', site_address: '1 Main St', site_city: 'SPRINGFIELD',
      site_state: 'NJ', site_zip: '07801', checkout_link: FORM, client_links: [FOLDER],
    });
    expect(filled).toEqual(['ticket', 'date', 'start time', 'address', 'lockbox', 'checkout form', 'deliverables folder']);
  });

  it('says where the sheet and the job disagree, and changes neither', () => {
    const { patch, differs } = planFill({ ...r, date: '2026-10-21', time: '13:00' }, job({ access_instructions: 'Lockbox code 9999.' }));
    expect(patch.start_date).toBeUndefined();
    expect(patch.access_instructions).toBeUndefined();
    expect(differs).toEqual([
      'The sheet says Wed, Oct 21; the job says Mon, Oct 19.',
      'The sheet says 1:00 pm; the job says 8:00 am.',
      "The sheet's lockbox code isn't in the job's Access note.",
    ]);
  });

  it('never goes past the ten-link limit', () => {
    const full = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);
    expect(planFill(r, job({ client_links: full })).patch.client_links).toHaveLength(10);
  });
});

describe('new jobs and the rest', () => {
  const rows = parseSchedule(sheet).rows;

  it("a row with no job is named like the client's other jobs", () => {
    const n = newScheduleJob(rows[1], job());
    expect(n).toMatchObject({
      title: 'Site survey 9000002 — Shelby, NC', customer_name: 'Client Co', source_platform: 'Internal',
      client_reference: '9000002', external_wo_id: 'T-1002', start_date: '2026-10-19', start_time: '13:00', end_date: '2026-10-19',
      site_address: '2 Oak Ave', city: 'Shelby', state: 'NC', zip: '28150',
      access_instructions: 'Lockbox code 5678. Lockbox: Side gate',
      client_links: ['https://example.com/plan.pdf'], checkout_link: FORM, checkin_link: null,
    });
    expect(newScheduleJob(rows[1], null).title).toBe('Site 9000002 — Shelby, NC');
    expect(newScheduleJob(rows[1], job({ title: 'T-0999-9000001-Springfield', external_wo_id: 'T-0999' })).title)
      .toBe('T-1002-9000002 — Shelby, NC');
  });

  it('access text and cancelled visits', () => {
    expect(accessText({ lockboxCode: '', lockboxLocation: 'Front' })).toBe('Lockbox: Front');
    expect(accessText({ lockboxCode: '', lockboxLocation: '' })).toBe('');
    expect(isCancelled({ status: 'Cancelled' })).toBe(true);
    expect(isCancelled({ status: 'Tech Assigned' })).toBe(false);
  });
});
