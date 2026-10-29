// The timesheet: a job's hours day by day, as a PDF or a spreadsheet to send
// the client or attach to the QuickBooks invoice (Fred, 2026-10-24: "add it as
// a export spread sheet when i pull they hours ti show up as a PDF or doc or
// some thing so i can send it or attached to the quickbooks").
//
// The lines are the Field Sheet's own days (lib/field-sheet.ts rowsFor): the
// techs' taps with the office's changes on Hours, so the timesheet always
// matches the hours on the invoice. Pure, apart from drawing the PDF.
import { clock, dayCalc, type SheetRow } from './field-sheet';
import { safe, wrapLine } from './doc-to-pdf';

export type TimesheetHead = {
  woNumber: string;
  /** The client's own ticket or work order number. */
  clientWo: string | null;
  site: string;
  address: string;
  client: string;
  /** The dates covered, YYYY-MM-DD. */
  from: string; to: string;
};

/** A picture for the PDF, already a small JPEG (lib/timesheet-photos.ts), under its day and tech. */
export type TimesheetPhoto = { day: string; tech: string; caption: string; jpeg: Uint8Array };

export type TimesheetLine = {
  day: string; tech: string; started: string; finished: string; lunch: number | null;
  hours: number; travel: number; total: number;
  /** The day's odometer, its first reading and its last. */
  odoStart: number | null; odoEnd: number | null;
  miles: number; meals: number; note: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One line per tech per day worked: each tech's days together, oldest first, the techs by name
 * (Fred, 2026-10-29: "each tech get their own break down ... once finish with tech one hours then
 * same for tech 2").
 */
export function timesheetLines(rows: SheetRow[]): TimesheetLine[] {
  return rows.filter((r) => !r.hidden && !r.missing)
    .sort((a, b) => a.tech.localeCompare(b.tech) || a.day.localeCompare(b.day))
    .map((r) => {
      const c = dayCalc(r.values, 0);
      return {
        day: r.day, tech: r.tech, started: clock(r.values.arrived), finished: clock(r.values.leftSite), lunch: r.values.lunch,
        hours: c.hours, travel: c.travel, total: c.total, odoStart: r.values.odoStart, odoEnd: r.values.odoEnd,
        miles: c.miles, meals: r.values.meals ?? 0, note: r.values.note.trim(),
      };
    });
}

/** The lines tech by tech, each tech's with their own total. */
export function timesheetByTech(lines: TimesheetLine[]): { tech: string; lines: TimesheetLine[]; total: ReturnType<typeof timesheetTotals> }[] {
  const techs = [...new Set(lines.map((l) => l.tech))];
  return techs.map((tech) => { const mine = lines.filter((l) => l.tech === tech); return { tech, lines: mine, total: timesheetTotals(mine) }; });
}

export function timesheetTotals(lines: TimesheetLine[]) {
  const t = lines.reduce((s, l) => ({ hours: s.hours + l.hours, travel: s.travel + l.travel, total: s.total + l.total, miles: s.miles + l.miles, meals: s.meals + l.meals }),
    { hours: 0, travel: 0, total: 0, miles: 0, meals: 0 });
  return { days: new Set(lines.map((l) => l.day)).size, hours: r2(t.hours), travel: r2(t.travel), total: r2(t.total), miles: Math.round(t.miles * 10) / 10, meals: r2(t.meals) };
}

/** 'Mon, Oct 20, 2026' (dates are calendar days, so read in UTC). */
export const sheetDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const money = (n: number) => `$${n.toFixed(2)}`;

export const TIMESHEET_COLUMNS = ['Date', 'Technician', 'Started', 'Finished', 'Lunch (min)', 'On site (h)', 'Travel (h)', 'Total (h)', 'Odometer', 'Miles', 'Meals', 'Note'];

const odo = (n: number) => n.toLocaleString('en-US');
/** The cells of one line, as the PDF and the spreadsheet show them. */
function cells(l: TimesheetLine): (string | number)[] {
  const odometer = l.odoStart != null && l.odoEnd != null ? `${odo(l.odoStart)} – ${odo(l.odoEnd)}` : '';
  return [sheetDay(l.day), l.tech, l.started, l.finished, l.lunch ?? '', l.hours, l.travel, l.total, odometer, l.miles, l.meals ? money(l.meals) : '', l.note];
}
/** A total row: a tech's, or every tech's. */
function totalCells(label: string, t: ReturnType<typeof timesheetTotals>): (string | number)[] {
  return [label, `${t.days} day${t.days === 1 ? '' : 's'}`, '', '', '', t.hours, t.travel, t.total, '', t.miles, t.meals ? money(t.meals) : '', ''];
}

/** The header lines: who, where, which job, which dates. */
export function headLines(h: TimesheetHead): string[] {
  return [
    `Work order ${h.woNumber}${h.clientWo ? ` · Client # ${h.clientWo}` : ''}`,
    [h.client, h.site].filter(Boolean).join(' · '),
    h.address,
    `${sheetDay(h.from)} to ${sheetDay(h.to)}`,
  ].filter((x) => x.trim());
}

/** The timesheet as rows for a spreadsheet (lib/export.ts downloadXLSXBook). */
export function timesheetTable(h: TimesheetHead, lines: TimesheetLine[]): (string | number)[][] {
  const t = timesheetTotals(lines);
  return [
    ['FAJ Solutions · Timesheet'],
    ...headLines(h).map((x) => [x]),
    [],
    TIMESHEET_COLUMNS,
    ...timesheetByTech(lines).flatMap((g) => [...g.lines.map(cells), totalCells(`${g.tech} total`, g.total)]),
    totalCells('All techs', t),
  ];
}

export const TIMESHEET_WIDTHS = [18, 20, 10, 10, 10, 11, 10, 10, 20, 8, 10, 36];

/** "Timesheet WO 19101401 2026-10-19 to 2026-10-25.pdf" */
export const timesheetFile = (h: TimesheetHead, ext: 'pdf' | 'xlsx') =>
  `Timesheet WO ${h.woNumber.replace(/[^A-Za-z0-9-]+/g, '')} ${h.from}${h.to !== h.from ? ` to ${h.to}` : ''}.${ext}`;

/** The photo groups in the PDF: one per day and tech, oldest first, in the order given within each. */
export function photoGroups(photos: TimesheetPhoto[]): { title: string; list: TimesheetPhoto[] }[] {
  const out = new Map<string, { title: string; list: TimesheetPhoto[] }>();
  for (const p of [...photos].sort((a, b) => a.day.localeCompare(b.day) || a.tech.localeCompare(b.tech))) {
    const k = `${p.day}|${p.tech}`;
    if (!out.has(k)) out.set(k, { title: [sheetDay(p.day), p.tech].filter(Boolean).join(' · '), list: [] });
    out.get(k)!.list.push(p);
  }
  return [...out.values()];
}

/**
 * The timesheet as a letter-size PDF, sideways, ready to send or attach to an
 * invoice: the hours table, then the pictures day by day with their captions
 * (Fred, 2026-10-24: "with the picture's").
 */
export async function timesheetPdf(h: TimesheetHead, lines: TimesheetLine[], photos: TimesheetPhoto[] = []): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(`Timesheet WO ${h.woNumber}`); doc.setProducer('FAJ Solutions'); doc.setCreator('FAJ Solutions');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H, M] = [792, 612, 36];
  const navy = rgb(0.055, 0.106, 0.18), ink = rgb(0.1, 0.1, 0.12), grey = rgb(0.38, 0.4, 0.44), band = rgb(0.965, 0.957, 0.937), gold = rgb(0.79, 0.635, 0.294);
  // Column widths in points, the note taking what's left of the page.
  const fixed = [70, 92, 50, 50, 40, 48, 46, 46, 92, 40, 48];
  const widths = [...fixed, W - 2 * M - fixed.reduce((a, b) => a + b, 0)];
  const size = 8.5, lineH = 11;
  const pages: ReturnType<typeof doc.addPage>[] = [];
  let page = doc.addPage([W, H]);
  pages.push(page);
  let y = H - M;

  const text = (s: string, x: number, yy: number, sz: number, font = regular, color = ink) => page.drawText(safe(s), { x, y: yy, size: sz, font, color });
  const header = () => {
    let x = M;
    page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 16, color: navy });
    for (const [i, c] of TIMESHEET_COLUMNS.entries()) { text(c, x + 3, y - 11.5, 7.5, bold, rgb(1, 1, 1)); x += widths[i]; }
    y -= 16;
  };
  const row = (vals: (string | number)[], opts: { font?: typeof regular; shade?: boolean } = {}) => {
    const font = opts.font ?? regular;
    const wrapped = vals.map((v, i) => wrapLine(safe(String(v)), widths[i] - 6, (s) => font.widthOfTextAtSize(s, size)));
    const h = Math.max(1, ...wrapped.map((w) => w.length)) * lineH + 4;
    if (y - h < M + 18) { page = doc.addPage([W, H]); pages.push(page); y = H - M; header(); }
    if (opts.shade) page.drawRectangle({ x: M, y: y - h, width: W - 2 * M, height: h, color: band });
    let x = M;
    for (const [i, w] of wrapped.entries()) {
      w.forEach((ln, k) => text(ln, x + 3, y - 10 - k * lineH, size, font));
      x += widths[i];
    }
    y -= h;
  };

  text('FAJ Solutions', M, y - 14, 16, bold, navy);
  text('Timesheet', W - M - bold.widthOfTextAtSize('Timesheet', 16), y - 14, 16, bold, navy);
  y -= 22;
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 2, color: gold });
  y -= 6;
  for (const ln of headLines(h)) { y -= 13; text(ln, M, y, 10, ln === headLines(h)[0] ? bold : regular); }
  y -= 12;
  header();
  // Each tech's days, then that tech's total; every tech's together at the end.
  for (const g of timesheetByTech(lines)) {
    g.lines.forEach((l, i) => row(cells(l), { shade: i % 2 === 1 }));
    row(totalCells(`${g.tech} total`, g.total), { font: bold, shade: true });
  }
  const t = timesheetTotals(lines);
  page.drawRectangle({ x: M, y: y - 1, width: W - 2 * M, height: 1, color: navy });
  row(totalCells('All techs', t), { font: bold });
  if (!lines.length) { y -= 16; text('No hours on these dates.', M, y, 10, regular, grey); }

  // The pictures: three across, each fitted in its box with the caption under it.
  if (photos.length) {
    const gap = 12, cols = 3, boxW = (W - 2 * M - gap * (cols - 1)) / cols, boxH = 150, capH = 24;
    const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - M; };
    newPage();
    text('Pictures', M, y - 14, 14, bold, navy);
    y -= 24;
    for (const g of photoGroups(photos)) {
      if (y - 20 - boxH - capH < M + 18) newPage();
      y -= 14; text(g.title, M, y, 10.5, bold); y -= 6;
      for (let i = 0; i < g.list.length; i += cols) {
        if (y - boxH - capH < M + 18) { newPage(); y -= 14; text(`${g.title} (continued)`, M, y, 10.5, bold); y -= 6; }
        for (const [k, p] of g.list.slice(i, i + cols).entries()) {
          const x = M + k * (boxW + gap);
          try {
            const img = await doc.embedJpg(p.jpeg);
            const scale = Math.min(boxW / img.width, boxH / img.height);
            const w = img.width * scale, hh = img.height * scale;
            page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, color: band });
            page.drawImage(img, { x: x + (boxW - w) / 2, y: y - boxH + (boxH - hh) / 2, width: w, height: hh });
          } catch {
            text('(picture could not be read)', x + 4, y - boxH / 2, 8, regular, grey);
          }
          wrapLine(safe(p.caption), boxW, (t) => regular.widthOfTextAtSize(t, 8)).slice(0, 2)
            .forEach((ln, n) => text(ln, x, y - boxH - 10 - n * 9.5, 8, regular, ink));
        }
        y -= boxH + capH + 6;
      }
    }
  }

  pages.forEach((p, i) => {
    p.drawText(safe(`FAJ Solutions · WO ${h.woNumber} · page ${i + 1} of ${pages.length}`), { x: M, y: M - 14, size: 7.5, font: regular, color: grey });
  });
  return doc.save();
}
