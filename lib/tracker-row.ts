// A row of the LDS dispatch tracker (NetView's Smartsheet), pasted, turned
// into a new work order the way the LDS jobs are set up (Fred, 2026-10-24,
// pasting "LDS-1103 5333202 10/26/2026 8:00 AM 10/30/2026 Pending Tech
// Assignment … Legacy 6420 Morganton Road FAYETTEVILLE NC … Dwayne Cudjoe …
// Kendell Newbold … Cabling LDS-1103 - 5333202 - FAYETTEVILLE").
//
// Read by what each cell looks like, not by its column, so a column added or
// moved in the tracker still reads: the ticket (LDS-1103), the site number,
// the dates and the start time, the address, city, state and zip, the Drive
// folder and the Smartsheet form, each tech as name, phone and email, and the
// kind of work. Nothing is saved here; the New order form opens filled in.
import type { WorkOrder } from './types';

const TICKET = /^[A-Z]{2,6}-\d{2,7}$/;
const SITE = /^\d{4,9}$/;
const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;
const TIME = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/;
const PHONE = /^\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;
const STATE = /^[A-Z]{2}$/;
const ZIP = /^\d{5}(-\d{4})?$/;
const STREET = /^\d+[A-Za-z]?\s+\S/;
/** A tracker's own words for the job's state: kept in the notes, not the app's stage. */
const STATUS = /pending|assign|scheduled|complete|cancel|hold|progress|confirmed/i;

const iso = (m: RegExpExecArray) => `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
const time24 = (m: RegExpExecArray) => {
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};
/** FAYETTEVILLE → Fayetteville, WINSTON-SALEM → Winston-Salem. */
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
/** Cabling → Low Voltage; a survey and anything else → Network / IT, like the LDS surveys. */
const serviceType = (kind: string) => (/cabl|low\s*volt|wire|drop/i.test(kind) ? 'Low Voltage' : 'Network / IT');

/** A pasted line that is a tracker row: tabs between the cells, and a ticket like LDS-1103 first. */
export function isTrackerRow(text: string): boolean {
  const first = (text ?? '').trim().split('\n')[0] ?? '';
  return first.includes('\t') && TICKET.test(first.split('\t')[0].trim());
}

/** One pasted tracker row → the new work order's fields, or null when it isn't one. */
export function parseTrackerRow(text: string): Partial<WorkOrder> | null {
  if (!isTrackerRow(text)) return null;
  const cells = text.trim().split('\n')[0].split('\t').map((c) => c.trim());
  const ticket = cells[0];
  const site = cells.find((c, i) => i > 0 && SITE.test(c)) ?? '';
  const dates = cells.map((c) => DATE.exec(c)).filter((m): m is RegExpExecArray => !!m).map(iso);
  const timeM = cells.map((c) => TIME.exec(c)).find((m): m is RegExpExecArray => !!m);
  const urls = cells.filter((c) => URL_RE.test(c));
  const form = urls.find((u) => /smartsheet\.com\/b\/form/i.test(u)) ?? null;

  // The address: the first cell that reads like a street; the city, state and zip follow it.
  const at = cells.findIndex((c) => STREET.test(c) && !URL_RE.test(c) && !DATE.test(c) && !PHONE.test(c) && !SITE.test(c));
  const street = at >= 0 ? cells[at] : '';
  const city = at >= 0 && cells[at + 1] && !STATE.test(cells[at + 1]) ? titleCase(cells[at + 1]) : '';
  const state = cells.slice(at + 1, at + 4).find((c) => STATE.test(c)) ?? '';
  const zip = cells.slice(at + 1, at + 5).find((c) => ZIP.test(c)) ?? null;

  // Each tech: a name, then their phone (and email).
  const techs: { name: string; phone: string; email: string }[] = [];
  cells.forEach((c, i) => {
    if (!PHONE.test(c) || i === 0) return;
    const name = cells[i - 1];
    if (!name || !/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(name) || URL_RE.test(name)) return;
    techs.push({ name, phone: c, email: EMAIL.test(cells[i + 1] ?? '') ? cells[i + 1] : '' });
  });

  // The kind of work: the word cell just before the tracker's own title (the last cell).
  const last = cells.filter(Boolean).at(-1) ?? '';
  const titled = last.includes(ticket) && last !== ticket;
  const before = cells.filter(Boolean).at(titled ? -2 : -1) ?? '';
  const kind = /^[A-Za-z][A-Za-z /&-]{2,30}$/.test(before) && !STATUS.test(before) && !techs.some((t) => t.name === before) ? before : 'Survey';
  const status = cells.find((c) => STATUS.test(c) && /[a-z]/.test(c) && !URL_RE.test(c) && !EMAIL.test(c)) ?? '';
  const program = cells.find((c, i) => i > 2 && i < at && /^[A-Za-z][A-Za-z ]{2,20}$/.test(c) && !STATUS.test(c) && c !== kind) ?? '';
  const where = [city, state].filter(Boolean).join(', ');
  const company = ticket.split('-')[0];

  return {
    title: `${company} ${kind} Site ${site} — ${where}`.replace(/\s+—\s*$/, ''),
    external_wo_id: ticket,
    client_reference: site || null,
    customer_name: company,
    project_name: `${company} ${state ? `${state} ` : ''}${kind}`.trim(),
    is_project: true,
    buyer_company: 'NetView',
    source_platform: 'NetView',
    assignment_type: 'Subcontract',
    service_type: serviceType(kind),
    wo_status: 'Open',
    start_date: dates[0] ?? null,
    start_time: timeM ? time24(timeM) : null,
    end_date: dates[1] ?? dates[0] ?? null,
    site_name: `${company} Site ${site}`,
    site_address: street || null,
    site_city: city || null,
    site_state: state || null,
    site_zip: zip,
    contractor_name: techs[0]?.name ?? '',
    contractor_names: techs.length ? techs.map((t) => t.name) : null,
    client_links: [...(form ? [form] : []), ...urls.filter((u) => u !== form)],
    checkout_link: form,
    client_status: status || null,
    client_program: program || null,
    description: [
      `${company} ${kind.toLowerCase()} at site ${site}${where ? `, ${where}` : ''}.`,
      last && titled && `Tracker: ${last}.`,
    ].filter(Boolean).join(' '),
  };
}
