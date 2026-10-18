// One site's weekly bill as a JPEG (Fred, 2026-10-18: "upload it back to the
// customers in a JPEG form"), drawn on a canvas in the browser: the header,
// the totals, each day, each drive with its odometer readings, each receipt,
// and where the numbers come from. Uses
// the same lines as the spreadsheet (lib/weekly-bill.ts).
import { expenseCategoryLabel } from './expenses';
import { hoursOf, legLabel } from './project-day';
import { billDay, type BillSite } from './weekly-bill';
import { ACTIVITY_LABEL, activityOf } from './checkin';

const TZ = 'America/New_York';
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—');
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NAVY = '#0E1B2E', GOLD = '#C9A24B', INK = '#1B1C1F', SUBTLE = '#5E6470', LINE = '#E4DFD3', STRIPE = '#F6F4EF';

type Table = { heading: string; columns: string[]; rows: string[][]; total?: string[] };

export function billImageTables(site: BillSite): { tiles: [string, string][]; tables: Table[] } {
  const { bill } = site;
  const s = bill.shows;
  const t = bill.totals;
  const tiles: [string, string][] = [
    ['Days', String(t.days)],
    ['Hours on site', String(t.onSiteHours)],
    ...(s.travel ? [['Travel hours', String(t.travelHours)], ['GPS miles', String(t.gpsMiles)]] as [string, string][] : []),
    ...(s.odometer ? [['Odometer miles', t.odoMiles == null ? '—' : String(t.odoMiles)]] as [string, string][] : []),
    ...(s.receipts ? [['Receipts', money(t.receipts)]] as [string, string][] : []),
  ];
  const tables: Table[] = [{
    heading: 'Each day',
    columns: ['Date', 'Technician', ...(s.travel ? ['Left'] : []), 'On site', 'Off site', ...(s.travel ? ['Back'] : []), 'Hours',
      ...(s.travel ? ['Miles (GPS)'] : []), ...(s.odometer ? ['Odometer mi'] : []), ...(s.receipts ? ['Receipts'] : [])],
    rows: bill.days.map((d) => [
      billDay(d.day), d.tech,
      ...(s.travel ? [d.left ? `${clock(d.left)}${d.from === 'hotel' ? ' (hotel)' : d.from === 'home' ? ' (home)' : ''}` : '—'] : []),
      clock(d.arrived), clock(d.leftSite), ...(s.travel ? [clock(d.back)] : []), String(d.onSiteHours),
      ...(s.travel ? [String(d.gpsMiles)] : []), ...(s.odometer ? [d.odoMiles == null ? '—' : String(d.odoMiles)] : []),
      ...(s.receipts ? [d.receipts ? money(d.receipts) : '—'] : []),
    ]),
  }];
  if (s.travel && bill.legs.length) {
    const odo = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
    tables.push({
      heading: 'Drives',
      columns: ['Date', 'Technician', 'Activity', 'Drive', 'Started', 'Ended', 'Hours', 'GPS mi', ...(s.odometer ? ['Odo start', 'Odo end', 'Odo mi'] : [])],
      rows: bill.legs.map((l) => [
        billDay(l.day), l.tech, ACTIVITY_LABEL[activityOf(l.origin, l.dest)], legLabel(l), clock(l.start), clock(l.end),
        // A drive with no arrival has no hours of its own, as on the sheet.
        l.end ? String(hoursOf(l.ms)) : '—', l.miles == null ? '—' : String(l.miles),
        ...(s.odometer ? [odo(l.odoStart?.reading), odo(l.odoEnd?.reading), l.odoMiles == null ? '—' : String(l.odoMiles)] : []),
      ]),
    });
  }
  if (s.receipts && bill.receipts.length) {
    tables.push({
      heading: 'Receipts',
      columns: ['Date', 'For', 'Store', 'Gallons', 'Amount'],
      rows: bill.receipts.map((r) => [billDay(r.expense_date), expenseCategoryLabel(r.category), r.vendor ?? '—', r.gallons ? String(r.gallons) : '', money(Number(r.amount))]),
      total: ['Total', '', '', t.gallons ? String(t.gallons) : '', money(t.receipts)],
    });
  }
  return { tiles, tables };
}

/** Draw it and hand back the JPEG. */
export async function billJpeg(site: BillSite, opts: { project: string; client: string; range: string }): Promise<Blob> {
  const { tiles, tables } = billImageTables(site);
  const W = 1240, PAD = 48, ROW = 34;
  const tableH = tables.reduce((h, t) => h + 56 + ROW * (t.rows.length + 1 + (t.total ? 1 : 0)), 0);
  // The band and site lines (230), the totals (110), the tables, the footer (60).
  const H = 230 + 110 + tableH + 60;
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d');
  if (!g) throw new Error("This browser can't draw the image.");
  g.scale(scale, scale);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const font = (size: number, weight = 400) => { g.font = `${weight} ${size}px Inter, "Segoe UI", Arial, sans-serif`; };
  const fit = (text: string, max: number) => {
    if (g.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    return `${t}…`;
  };

  // The band.
  g.fillStyle = NAVY;
  g.fillRect(0, 0, W, 110);
  g.fillStyle = '#E3C987';
  font(15, 700);
  g.fillText('FAJ SOLUTIONS', PAD, 46);
  g.fillStyle = '#fff';
  font(26, 700);
  g.fillText('WEEKLY BILL', PAD, 82);
  g.textAlign = 'right';
  font(15);
  g.fillText(opts.range, W - PAD, 82);
  g.textAlign = 'left';

  // The site.
  let y = 150;
  g.fillStyle = INK;
  font(24, 700);
  g.fillText(fit(site.name, W - 2 * PAD), PAD, y);
  y += 28;
  g.fillStyle = SUBTLE;
  font(15);
  g.fillText(fit([`WO ${site.wo}`, site.clientWo ? `Client # ${site.clientWo}` : '', opts.client ? `Client: ${opts.client}` : '', opts.project].filter(Boolean).join(' · '), W - 2 * PAD), PAD, y);
  y += 22;
  if (site.address) g.fillText(fit(site.address, W - 2 * PAD), PAD, y);
  y += 30;

  // The totals.
  const tw = (W - 2 * PAD - (tiles.length - 1) * 12) / tiles.length;
  tiles.forEach(([label, value], i) => {
    const x = PAD + i * (tw + 12);
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    g.strokeRect(x, y, tw, 74);
    g.fillStyle = SUBTLE;
    font(12, 600);
    g.fillText(label.toUpperCase(), x + 12, y + 26);
    g.fillStyle = INK;
    font(24, 700);
    g.fillText(fit(value, tw - 24), x + 12, y + 58);
  });
  y += 110;

  // The tables.
  for (const t of tables) {
    g.fillStyle = NAVY;
    font(17, 700);
    g.fillText(t.heading, PAD, y);
    g.fillStyle = GOLD;
    g.fillRect(PAD, y + 8, W - 2 * PAD, 2);
    y += 22;
    const cw = (W - 2 * PAD) / t.columns.length;
    const line = (cells: string[], opts2: { head?: boolean; bold?: boolean; stripe?: boolean }) => {
      if (opts2.head || opts2.stripe) { g.fillStyle = STRIPE; g.fillRect(PAD, y, W - 2 * PAD, ROW); }
      g.fillStyle = opts2.head ? SUBTLE : INK;
      font(opts2.head ? 12 : 14, opts2.head || opts2.bold ? 700 : 400);
      cells.forEach((c, i) => g.fillText(fit(opts2.head ? c.toUpperCase() : c, cw - 12), PAD + i * cw + 8, y + 22));
      g.fillStyle = LINE;
      g.fillRect(PAD, y + ROW - 1, W - 2 * PAD, 1);
      y += ROW;
    };
    line(t.columns, { head: true });
    t.rows.forEach((r, i) => line(r, { stripe: i % 2 === 1 }));
    if (t.total) line(t.total, { bold: true });
    y += 34;
  }

  g.fillStyle = SUBTLE;
  font(12.5);
  g.fillText('Times and miles come from the technicians’ phones (GPS at each start and stop) and odometer photos. Hours on site leave out lunch.', PAD, H - 40);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image."))), 'image/jpeg', 0.92));
}
