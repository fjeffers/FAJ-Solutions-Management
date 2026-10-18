import { describe, it, expect } from 'vitest';
import { buildDayLogs, type DayEvent } from './project-day';
import { matchOdometer, siteBill, siteSheetRows, totalsSheetRows, sheetName, summaryFacts, summaryPrompt, type OdoRow, type BillReceipt } from './weekly-bill';

const TZ = 'America/New_York';
// Monday Oct 12, 2026 (New York is UTC-4): Dana leaves the hotel at 6:50,
// on site 7:30 to 4:00 with lunch, back at the hotel 4:35.
const ev = (kind: DayEvent['kind'], hhmm: string, extra: Partial<DayEvent> = {}, day = '2026-10-12'): DayEvent =>
  ({ kind, at: new Date(`${day}T${hhmm}:00-04:00`).toISOString(), tech: 'Dana', ...extra });
const monday: DayEvent[] = [
  ev('day_start', '06:45'),
  ev('travel_start', '06:50', { origin: 'hotel', dest: 'site' }),
  ev('travel_end', '07:28', { miles: 21.4 }),
  ev('in', '07:30'),
  ev('lunch_start', '12:00'), ev('lunch_end', '12:30'),
  ev('out', '16:00'),
  ev('travel_start', '16:02', { origin: 'site', dest: 'hotel' }),
  ev('travel_end', '16:35', { miles: 21.0 }),
];
const odo = (hhmm: string, reading: number, ai: number | null = reading, photo: string | null = 'wo-1/odo_1.jpg'): OdoRow =>
  ({ wo_id: 'wo-1', contractor_name: 'Dana', at: new Date(`2026-10-12T${hhmm}:00-04:00`).toISOString(), reading, ai_reading: ai, photo_path: photo });
const readings = [odo('06:51', 48200), odo('07:29', 48222), odo('16:03', 48222), odo('16:37', 48243.5)];
const receipt = (o: Partial<BillReceipt>): BillReceipt => ({
  id: 'r1', wo_id: 'wo-1', category: 'fuel', vendor: 'Shell', amount: 41.24, expense_date: '2026-10-12', note: null, receipt_path: 'wo-1/r.jpg', gallons: 11.2, ai: { amount: 41.24 }, ...o,
});
const logs = buildDayLogs(monday, new Date('2026-10-13T12:00:00Z'), TZ);
const portal = ['travel', 'odometer', 'receipts'] as const;

describe('the weekly bill for one site', () => {
  it('pairs each drive with the odometer photos taken at its start and end', () => {
    const legs = matchOdometer(logs.flatMap((d) => d.legs), readings);
    expect(legs.map((l) => [l.odoStart?.reading, l.odoEnd?.reading, l.odoMiles])).toEqual([[48200, 48222, 22], [48222, 48243.5, 21.5]]);
  });

  it('keeps a skipped photo from moving the next drive’s readings', () => {
    // Two short drives; the tech skipped the first drive's start photo.
    const two = buildDayLogs([
      ev('travel_start', '09:00', { origin: 'hotel', dest: 'site' }), ev('travel_end', '09:05', { miles: 3 }),
      ev('travel_start', '09:10', { origin: 'site', dest: 'hotel' }), ev('travel_end', '09:15', { miles: 7 }),
    ], new Date('2026-10-13T12:00:00Z'), TZ);
    const at = (o: OdoRow, moment: 'start' | 'end'): OdoRow => ({ ...o, moment });
    const shots = [at(odo('09:06', 100), 'end'), at(odo('09:11', 100), 'start'), at(odo('09:16', 107), 'end')];
    const legs = matchOdometer(two.flatMap((d) => d.legs), shots);
    expect(legs.map((l) => [l.odoStart?.reading ?? null, l.odoEnd?.reading ?? null, l.odoMiles])).toEqual([[null, 100, null], [100, 107, 7]]);
    const bill = siteBill({ woId: 'wo-1', capture: [...portal], logs: two, readings: shots, receipts: [], today: '2026-10-18' });
    expect(bill.totals.odoMiles).toBe(7);
    expect(bill.flags.filter((f) => f.kind === 'odo_missing').map((f) => f.text)).toEqual(['Dana, Mon, Oct 12, Hotel → Site: no odometer photo at the start.']);
  });

  it('gives each day its times, hours, miles and receipts, with nothing to check when it all adds up', () => {
    const bill = siteBill({ woId: 'wo-1', capture: [...portal], logs, readings, receipts: [receipt({})], today: '2026-10-18' });
    expect(bill.days).toHaveLength(1);
    const d = bill.days[0];
    expect(d.from).toBe('hotel');
    expect([d.left, d.arrived, d.leftSite, d.back].map((x) => x && new Date(x).toISOString().slice(11, 16))).toEqual(['10:50', '11:30', '20:00', '20:35']);
    expect(d.onSiteHours).toBe(8);
    expect(d.gpsMiles).toBe(42.4);
    expect(d.odoMiles).toBe(43.5);
    expect(d.receipts).toBe(41.24);
    expect(bill.totals).toMatchObject({ days: 1, onSiteHours: 8, gpsMiles: 42.4, odoMiles: 43.5, receipts: 41.24, gallons: 11.2 });
    expect(bill.flags).toEqual([]);
  });

  it('flags what to check before it goes to the client', () => {
    const bill = siteBill({
      woId: 'wo-1', capture: [...portal], logs,
      // The evening drive has no photo at the end, and the morning's start was typed wrong.
      readings: [odo('06:51', 48100, 48200), odo('07:29', 48222), odo('16:03', 48222)],
      receipts: [
        receipt({ amount: 14.24, ai: { amount: 41.24 }, gallons: 40 }),
        receipt({ id: 'r2', category: 'meals', vendor: 'Deli', amount: 12, receipt_path: null, gallons: null, ai: null }),
      ],
      today: '2026-10-18',
    });
    const kinds = bill.flags.map((f) => f.kind);
    expect(kinds).toEqual(['odo_gps', 'odo_typed', 'odo_missing', 'receipt_typed', 'receipt_photo', 'fuel']);
    expect(bill.flags[0].text).toBe('Dana, Mon, Oct 12: 122 mi by odometer, 21.4 mi by GPS for the same drives.');
    expect(bill.flags[1].text).toBe('Dana, Mon, Oct 12, Hotel → Site: typed 48,100, the photo reads 48,200.');
    expect(bill.flags[2].text).toBe('Dana, Mon, Oct 12, Site → Hotel: no odometer photo at the end.');
    expect(bill.flags[3].text).toBe('Fuel at Shell, Mon, Oct 12: entered as $14.24, the photo reads $41.24.');
    expect(bill.flags[4].text).toBe('Meals at Deli, Mon, Oct 12, $12.00: no photo of the receipt.');
    expect(bill.flags[5].text).toBe('40 gal of fuel for 122 mi of driving to this site: more than the miles explain.');
  });

  it('flags a day nobody tapped Off site, or a drive with no arrival, and leaves that time out', () => {
    const later = new Date('2026-10-18T12:00:00Z');
    const onSite = siteBill({ woId: 'wo-1', capture: null, logs: buildDayLogs([ev('in', '07:30')], later, TZ), readings: [], receipts: [], today: '2026-10-18' });
    expect(onSite.flags.map((f) => f.text)).toEqual(["Dana, Mon, Oct 12: no Off site tap, so that time on site isn't counted. Check the hours."]);
    expect(onSite.totals.onSiteHours).toBe(0);
    const driving = buildDayLogs([ev('travel_start', '17:00', { origin: 'site', dest: 'hotel' })], later, TZ);
    const road = siteBill({ woId: 'wo-1', capture: null, logs: driving, readings: [], receipts: [], today: '2026-10-18' });
    expect(road.flags.map((f) => f.text)).toEqual(["Dana, Mon, Oct 12, Site → Hotel: no arrival tap, so that drive isn't counted. Check it."]);
    expect(road.totals.travelHours).toBe(0);
    // The download leaves that drive's hours blank too.
    const drive = siteSheetRows({ name: 'Maple St', wo: '101', address: '', bill: road }, '').find((r) => r[2] === 'Site → Hotel');
    expect(drive?.slice(3, 6)).toEqual(['5:00 PM', '', '']);
    // Still today: nothing to flag yet, and the time so far counts.
    const now = buildDayLogs([ev('in', '07:30')], new Date('2026-10-12T15:30:00Z'), TZ);
    const live = siteBill({ woId: 'wo-1', capture: null, logs: now, readings: [], receipts: [], today: '2026-10-12' });
    expect(live.flags).toEqual([]);
    expect(live.totals.onSiteHours).toBe(4);
  });

  it('counts each receipt once, on the line of the tech who sent it', () => {
    const both = buildDayLogs([...monday, ...monday.map((e) => ({ ...e, tech: 'Lee' }))], new Date('2026-10-13T12:00:00Z'), TZ);
    const bill = siteBill({
      woId: 'wo-1', capture: [...portal], logs: both, readings: [], today: '2026-10-18',
      receipts: [receipt({ contractor_name: 'Lee', amount: 40 }), receipt({ id: 'r2', contractor_name: null, amount: 10 })],
    });
    expect(bill.days.map((d) => [d.tech, d.receipts])).toEqual([['Dana', 10], ['Lee', 40]]);
    expect(bill.totals.receipts).toBe(50);
  });

  it('leaves out what the job does not ask for', () => {
    const noDrive = buildDayLogs([ev('in', '07:30'), ev('out', '15:30')], new Date('2026-10-13T12:00:00Z'), TZ);
    const bill = siteBill({ woId: 'wo-1', capture: ['notes'], logs: noDrive, readings: [], receipts: [], today: '2026-10-18' });
    expect(bill.shows).toEqual({ travel: false, odometer: false, receipts: false, lunch: false });
    const rows = siteSheetRows({ name: 'Maple St', wo: '101', address: '1 Maple St', bill }, 'Oct 12 – Oct 18');
    expect(rows[5]).toEqual(['Date', 'Technician', 'Arrived on site', 'Left site', 'Hours on site']);
    expect(rows.some((r) => r[0] === 'Drives' || r[0] === 'Receipts')).toBe(false);
    // A job with no list shows odometer columns only once there are readings.
    expect(siteBill({ woId: 'wo-1', capture: null, logs, readings: [], receipts: [], today: '2026-10-18' }).shows.odometer).toBe(false);
  });
});

describe('the download', () => {
  const bill = siteBill({ woId: 'wo-1', capture: [...portal], logs, readings, receipts: [receipt({})], today: '2026-10-18' });
  const site = { name: 'Maple St', wo: '101', clientWo: 'C-77', address: '1 Maple St, Springfield', bill };

  it('puts each site on its own sheet: the days, the drives, the receipts', () => {
    const rows = siteSheetRows(site, 'Oct 12 – Oct 18');
    expect(rows[1]).toEqual(['WO 101 · Client # C-77']);
    expect(rows[5]).toEqual(['Date', 'Technician', 'Left from', 'Left at', 'Arrived on site', 'Left site', 'Back at', 'Hours on site', 'Travel hours', 'GPS miles', 'Odometer miles', 'Receipts']);
    expect(rows[6]).toEqual(['2026-10-12', 'Dana', 'Hotel', '6:50 AM', '7:30 AM', '4:00 PM', '4:35 PM', 8, 1.18, 42.4, 43.5, 41.24]);
    expect(rows.find((r) => r[2] === 'Hotel → Site')).toEqual(['2026-10-12', 'Dana', 'Hotel → Site', '6:50 AM', '7:28 AM', 0.63, 21.4, 48200, 48222, 22]);
    expect(rows.at(-1)).toEqual(['', 'Total', '', '', 11.2, 41.24]);
  });

  it('adds a totals sheet with every site on its own line', () => {
    const rows = totalsSheetRows('Spring refresh', 'Acme', 'Oct 12 – Oct 18', [site, { ...site, name: 'Oak Ave', wo: '102' }]);
    expect(rows[4]).toEqual(['Site', 'WO', 'Days', 'Hours on site', 'Travel hours', 'GPS miles', 'Odometer miles', 'Receipts']);
    expect(rows.at(-1)).toEqual(['Total', '', '', 16, 2.36, 84.8, 87, 82.48]);
  });

  it('names sheets the way Excel allows', () => {
    const taken = new Set<string>();
    expect(sheetName('Store #12: back/dock', taken)).toBe('Store #12 back dock');
    expect(sheetName('store #12 back dock', taken)).toBe('store #12 back dock (2)');
    expect(sheetName('', taken)).toBe('Site');
  });

  it('gives the AI summary the numbers and the flags only', () => {
    const facts = summaryFacts('Spring refresh', 'Oct 12 – Oct 18', [site]);
    expect(Object.keys(facts.sites[0])).toEqual(['site', 'wo', 'days', 'totals', 'to_check']);
    expect(JSON.stringify(facts)).not.toMatch(/odo_1\.jpg|r\.jpg/);
    expect(summaryPrompt(facts)).toMatch(/Never mention pay/);
    expect(summaryPrompt(facts)).toContain('"site":"Maple St"');
  });
});
