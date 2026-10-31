'use client';
// The job log (Fred, 2026-10-02: "can try job log"; idea from SimplySub's
// daily log). One clean page per job: each visit with times and GPS, the
// checklist, the answers to the job's questions, the tech's notes and the
// stamped photos — printed, or saved as a PDF from the print window, to send a
// client or marketplace as proof of work. No pay anywhere on it; the only
// amounts are on the receipts the client pays back. The scope of work starts
// switched off, because Fred sometimes notes pay in it.
//
// Fred, 2026-10-18: on a finished job, anything the tech didn't fill in is
// listed under "Not completed" (lib/job-gaps.ts), and empty parts are left out.
//
// Fred, 2026-10-25: the receipts and odometer photos are in it too ("unable to
// add photes needed"), and every picture has a check mark: tap it and the
// picture is left out of the log, tap again and it's back ("put a x or check
// mark to add and remove photos"). Nothing is deleted; the job remembers which
// pictures are left out (work_orders.job_log_left_out, migration 141). A site
// photo can be labeled a receipt, and then sits with the receipts ("i can label
// then as recipe or none recipes"; work_orders.job_log_receipt_photos). A
// declined receipt stays on screen, marked declined, and is never printed ("if
// decline it stay on the app but it does a photo that was decline item").
//
// Fred, 2026-10-26 ("still unable to download photo or add them"): Add photos
// puts pictures from the office's device on the job, and each picture has
// Download, which saves it to the device (lib/job-photos.ts).
//
// Fred, 2026-10-26 ("remove on every photo and receipt"): a declined receipt
// has its ✗ too, so every picture can come off the screen.
//
// Fred, 2026-10-26 ("why am still see the one i removed"): a picture taken
// out is off the log on screen too, so the screen is what the client gets;
// "Pictures left out" shows them again to put one back.
//
// Fred, 2026-10-26: the mark on a picture is what a tap does ("when i click on
// the x i dont want the client to see it ... but it stay on the app"): ✗ takes
// it out of the log, and a picture left out shows ✓ to put it back.
//
// Fred, 2026-10-26: the PDF it saves is named for the site and its dates ("can
// it be the site number and city"): "LDS-1110 Site 5011876 — Gaffney, SC ·
// 10-18-2026 – 10-23-2026".
//
// Fred, 2026-10-30 ("I need to edit all of it hours time milages materials etc all of it", with his workbook
// job-log-timesheet.xlsx): Edit time sheet opens every row of the five tables to change, add or take out; saved,
// the job keeps its own sheet (lib/job-log-sheet.ts) and the log, the print and Excel show that. Excel saves
// his workbook's layout with the log's rows, the numbers as formulas (lib/job-log-xlsx.ts). No billable
// total ("No, keep it off"). The names, Fred, 2026-10-30: "Keep the Name Job Log with the pictures of the
// receipts, odometer the one i edit is the time sheet that reflect on the job log".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, FileSpreadsheet, FileText, Pencil, Plus, Printer, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { expenseCategoryLabel } from '@/lib/expenses';
import { fmtMoney } from '@/lib/utils';
import { dayCalc, leadFirst, parseEdits, rowsFor, type SavedDay, type SheetRow } from '@/lib/field-sheet';
import type { OdoRow as Reading } from '@/lib/weekly-bill';
import { loadEvents } from '@/components/wf/ProjectOffice';
import { toastError, toastSuccess } from '@/lib/toast';
import { buildVisits, byTechGroups, inRange, dayOf, jobLogName, siteNumber, type Punch } from '@/lib/job-log';
import {
  hoursScreenDays, hoursTotal, isHotel, milesTotal, minutesOf, moneyTotal, parseSheet, rowHours, sheetByTech, sheetFromApp, sheetInDates, sheetProblems, sheetSorted, sheetToSave,
  type JobSheet, type MoneyRow,
} from '@/lib/job-log-sheet';
import { downloadJobLogXlsx } from '@/lib/job-log-xlsx';
import {
  chargesByTech, chargesTotal, fromCents, lineAmount, notCharged, parseRate, parseRates, rateRows, ratesFromRows, ratesToSave, sameRates, sheetTechs, toCents,
  withAllHoursRate,
  type JobRates, type RateRow,
} from '@/lib/job-log-rates';
import JobSheetEditor, { NumBox } from '@/components/JobSheetEditor';
import JobLogInvoice, { type InvoiceEditor } from '@/components/JobLogInvoice';
import { addLine, buildInvoice, downloadInvoiceXlsx, editLine, parseInvoiceMeta, removeLine, type InvoiceHead, type InvoiceMeta } from '@/lib/job-log-invoice';
import { jobGaps } from '@/lib/job-gaps';
import { isFinished, wfJobFromOwner } from '@/lib/wf';
import { asks, parseCapture } from '@/lib/capture';
import { downloadHref, fileExt, photoDay, photoFileName } from '@/lib/job-photos';
import AddJobPhotos from '@/components/AddJobPhotos';
import type { EnrichedWorkOrder, TimeLog } from '@/lib/types';

type PhotoRow = { id: string; url: string; taken_at: string; lat: number | null; lng: number | null; contractor_name: string | null };
type ReceiptRow = { id: string; contractor_name: string | null; category: string; vendor: string | null; amount: number; expense_date: string; note?: string | null; status: string; decline_reason: string | null; receipt_path: string | null };
type OdoRow = { id: string; contractor_name: string | null; at: string; moment: string; reading: number; photo_path: string | null };
/** A picture on the log. `key` is how the job remembers it's left out: 'photo:<id>', 'receipt:<id>' or 'odo:<id>'. */
type Pic = {
  key: string; src: string; day: string; stamp: string; tech: string | null; caption?: string;
  /** A site photo (it can be labeled a receipt or not). */
  photoId?: string;
  /** A declined receipt: on screen only, never printed. */
  declined?: boolean;
  /** A receipt kept as a PDF (the office can add one): a link, not a picture. */
  pdf?: boolean;
};
type Choices = { leftOut: Set<string>; receiptPhotos: Set<string> };
type Include = { gaps: boolean; time: boolean; mileage: boolean; meals: boolean; materials: boolean; otherReceipts: boolean; checklist: boolean; answers: boolean; notes: boolean; photos: boolean; receipts: boolean; odometer: boolean; scope: boolean; leftOut: boolean };

const TZ = 'America/New_York';
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
/** "17:37" → "5:37 PM". */
const clock12 = (hhmm: string) => {
  const m = minutesOf(hhmm);
  if (m == null) return hhmm || '—';
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const fmtStamp = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });

/**
 * Each job's saves still going. Kept outside the log, so a log closed and
 * opened again straight away waits for them before it reads the job.
 */
const savesFor = new Map<string, Promise<void>>();
const afterSaves = (woId: string) => savesFor.get(woId) ?? Promise.resolve();
/** A save of the job's sheet, after the saves before it and before the log next reads the job (Greptile on PR #39). */
function queueSave<T>(woId: string, write: () => PromiseLike<T>): Promise<T> {
  const done = afterSaves(woId).then(write);
  savesFor.set(woId, done.then(() => undefined, () => undefined));
  return done;
}

/**
 * The pictures left out of the log and the photos labeled receipts, saved on
 * the job. Saves go one at a time, each sending the choices as they are by
 * then, so a quick run of taps never lands out of order.
 */
function useLogChoices(woId: string, left: string[] | null | undefined, receiptIds: string[] | null | undefined) {
  const [first] = useState<Choices>(() => ({ leftOut: new Set(left ?? []), receiptPhotos: new Set(receiptIds ?? []) }));
  const [now, setNow] = useState<Choices>(first);
  const tapped = useRef<Choices>(first);
  const kept = useRef<Choices>(first);
  const show = useCallback((c: Choices) => { tapped.current = c; setNow(c); }, []);
  /** What the job has saved, read when the log opens. */
  const loaded = useCallback((c: Choices) => { kept.current = c; show(c); }, [show]);
  /** Shows the choice and saves it; true once saved. */
  const choose = (next: Choices): Promise<boolean> => {
    show(next);
    const saved = afterSaves(woId).then(async () => {
      const c = tapped.current;
      if (c === kept.current) return true;
      const { error } = await createClient().from('work_orders')
        .update({ job_log_left_out: [...c.leftOut], job_log_receipt_photos: [...c.receiptPhotos] }).eq('id', woId);
      if (!error) { kept.current = c; return true; }
      // Back to what's saved, unless there was a tap since: the next save tries again with it.
      if (tapped.current === c) show(kept.current);
      toastError("That didn't save. Check your connection and try again.");
      return false;
    });
    savesFor.set(woId, saved.then(() => undefined));
    return saved;
  };
  /** Leave a picture out of the log, or put it back; true once saved. */
  const flip = (key: string) => {
    const l = new Set(tapped.current.leftOut);
    if (l.has(key)) l.delete(key); else l.add(key);
    return choose({ ...tapped.current, leftOut: l });
  };
  /** The job has it saved as left out. */
  const savedOut = (key: string) => kept.current.leftOut.has(key);
  /** Label a site photo a receipt, or not one. */
  const label = (photoId: string, receipt: boolean) => {
    const r = new Set(tapped.current.receiptPhotos);
    if (receipt) r.add(photoId); else r.delete(photoId);
    void choose({ ...tapped.current, receiptPhotos: r });
  };
  return { ...now, loaded, flip, label, savedOut };
}

/** A section heading on the printed page. */
const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="jl-h" style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 15, fontWeight: 700, color: '#0E1B2E', margin: '22px 0 8px', paddingBottom: 6, borderBottom: '2px solid #C9A24B' }}>{children}</h3>
);

export default function JobLogReport({ w, deliverables, onClose }: {
  w: EnrichedWorkOrder;
  /** The job's closeout deliverables (listFor), so a finished job can say which weren't done. */
  deliverables: string[];
  onClose: () => void;
}) {
  const [punches, setPunches] = useState<Punch[] | null>(null);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [receipts, setReceipts] = useState<Pic[]>([]);
  const [odometer, setOdometer] = useState<Pic[]>([]);
  // The approved receipts, for the meals, materials and other receipts tables.
  const [spent, setSpent] = useState<ReceiptRow[]>([]);
  // The job log as the office edited it (work_orders.job_log_sheet), and the edit going on: Fred, 2026-10-30:
  // "I need to edit all of it hours time milages materials etc all of it".
  const [savedSheet, setSavedSheet] = useState<JobSheet | null>(null);
  const [draft, setDraft] = useState<JobSheet | null>(null);
  const [saving, setSaving] = useState(false);
  // The client's copy has each tech's rates and the dollars; the tech's copy has none (Fred, 2026-10-30: "i need a
  // copy i can entered how much per an hour the milage for each tech ... then i need a copy with out it for the
  // tech"). The rates are kept per job in job_log_rates, which only the office can read (migration 147).
  // And the invoice, laid out as the client's (Fred, 2026-10-30: "this how the client want the layout to look").
  const [copy, setCopy] = useState<'tech' | 'client' | 'invoice'>('tech');
  // The rates table as the office is changing it (null: as saved).
  const [rateEdit, setRateEdit] = useState<RateRow[] | null>(null);
  const [savedRates, setSavedRates] = useState<JobRates>({});
  // One $ per hour for all the techs' hours, in place of each tech's (Fred, 2026-10-30: "the rate is changing 100, 90,
  // 60", "not a flat rate hourly"): as the office is changing it (null: as saved), and as saved (null: each tech's own).
  const [allEdit, setAllEdit] = useState<{ on: boolean; hour: number | null } | null>(null);
  const [savedAll, setSavedAll] = useState<number | null>(null);
  // The invoice's number, date, terms, labor and meal allowance, as saved with the rates.
  const todayDay = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const [savedMeta, setSavedMeta] = useState<InvoiceMeta>(() => parseInvoiceMeta(null, todayDay));
  // The invoice as it's edited on the invoice itself (Fred, 2026-10-30: "the invoice need to be one ... so we edit job
  // log it shows as an invoice"): the time sheet under it, the rates and the invoice's own boxes, saved together.
  const [invDraft, setInvDraft] = useState<{ sheet: JobSheet; rates: JobRates; together: { on: boolean; hour: number | null }; meta: InvoiceMeta } | null>(null);
  // The invoice on a phone (Fred, 2026-10-31: "This my phone view", "Both"): shrunk to the screen's width like the PDF,
  // or full size to swipe sideways. Full size while it's edited, so its boxes are big enough to type in.
  const invoiceBox = useRef<HTMLDivElement | null>(null);
  const [screenZoom, setScreenZoom] = useState(1);
  const [fullSize, setFullSize] = useState(false);
  // The saved rates didn't load: nothing to save over them, and no client copy, until they do (Greptile, CodeRabbit on PR #40).
  const [ratesFailed, setRatesFailed] = useState(false);
  const { leftOut, receiptPhotos, loaded: loadedChoices, flip, label, savedOut } = useLogChoices(w.id, w.job_log_left_out, w.job_log_receipt_photos);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Each tech's days as the Hours screen and the Field Sheet have them, for the miles and the days the office retimed
  // (Fred, 2026-10-25: "i don't see the mileages on the job logs along with the pictures").
  const [days, setDays] = useState<SheetRow[]>([]);
  // Pictures added from the office: the log reads the job's photos again, and the
  // new ones are marked New and scrolled to, as they sit under their own day
  // among the others (Fred, 2026-10-26: "when i add a photo it not saving on the job log").
  const [added, setAdded] = useState(0);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [inc, setInc] = useState<Include>({ gaps: true, time: true, mileage: true, meals: true, materials: true, otherReceipts: true, checklist: true, answers: true, notes: true, photos: true, receipts: true, odometer: true, scope: false, leftOut: false });

  useEffect(() => {
    const db = createClient();
    void Promise.all([
      db.from('job_punches').select('contractor_name, kind, at, lat, lng, accuracy').eq('wo_id', w.id).order('at'),
      db.from('wo_photos').select('id, url, taken_at, lat, lng, contractor_name').eq('wo_id', w.id).order('taken_at'),
      fetch(`/api/wo-time-logs?wo_id=${w.id}`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      db.from('job_expenses').select('id, contractor_name, category, vendor, amount, expense_date, note, status, decline_reason, receipt_path').eq('wo_id', w.id).order('expense_date'),
      db.from('job_odometer').select('id, wo_id, contractor_name, at, moment, reading, ai_reading, photo_path').eq('wo_id', w.id).order('at'),
      // What's left out and labeled now: the job on screen may be older than the last change,
      // and a save from the log just closed may still be going.
      afterSaves(w.id).then(() => db.from('work_orders').select('job_log_left_out, job_log_receipt_photos, job_log_sheet').eq('id', w.id).maybeSingle()),
      loadEvents([w.id]),
      db.from('field_sheet_days').select('id, day, tech, edits, added, hidden').eq('wo_id', w.id),
      afterSaves(w.id).then(() => db.from('job_log_rates').select('rates, all_hours_rate, invoice').eq('wo_id', w.id).maybeSingle()),
    ]).then(async ([p, ph, l, ex, od, wo, ev, fs, jr]) => {
      if (jr.error) setRatesFailed(true);
      else {
        const kept = jr.data as { rates?: unknown; all_hours_rate?: unknown; invoice?: unknown } | null;
        setSavedRates(parseRates(kept?.rates));
        setSavedAll(parseRate(kept?.all_hours_rate));
        setSavedMeta(parseInvoiceMeta(kept?.invoice, new Date().toLocaleDateString('en-CA', { timeZone: TZ })));
      }
      setPunches(((p.data as Punch[] | null) ?? []));
      setPhotos(((ph.data as PhotoRow[] | null) ?? []));
      setLogs(Array.isArray(l) ? (l as TimeLog[]) : []);
      const kept = wo.data as { job_log_left_out?: string[] | null; job_log_receipt_photos?: string[] | null; job_log_sheet?: unknown } | null;
      if (kept) loadedChoices({ leftOut: new Set(kept.job_log_left_out ?? []), receiptPhotos: new Set(kept.job_log_receipt_photos ?? []) });
      setSavedSheet(parseSheet(kept?.job_log_sheet));
      // Approved and declined; one still waiting on Fred isn't either yet.
      const rec = ((ex.data as ReceiptRow[] | null) ?? []).filter((e) => (e.status === 'approved' || e.status === 'declined') && e.receipt_path);
      setSpent(((ex.data as ReceiptRow[] | null) ?? []).filter((e) => e.status === 'approved'));
      const readings = ((od.data as Reading[] | null) ?? []).map((o) => ({ ...o, reading: Number(o.reading), ai_reading: o.ai_reading == null ? null : Number(o.ai_reading) }));
      const saved = ((fs.data as (Omit<SavedDay, 'edits'> & { edits: unknown })[] | null) ?? []).map((d) => ({ ...d, edits: parseEdits(d.edits) }));
      const crew = (w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter((t): t is string => !!t);
      // Hidden days too: a day hidden on the Hours screen is off the log's hours as well.
      setDays(rowsFor({ events: ev, readings, saved, techs: crew, start: w.start_date, end: w.end_date, timeZone: TZ }));
      const odo = ((od.data as OdoRow[] | null) ?? []).filter((o) => o.photo_path);
      const paths = [...rec.map((e) => e.receipt_path!), ...odo.map((o) => o.photo_path!)];
      if (!paths.length) return;
      // Receipts and odometer photos are private files: signed links.
      const { data: signed } = await db.storage.from('job-receipts').createSignedUrls(paths, 60 * 60);
      const url = new Map((signed ?? []).filter((x) => x.path && x.signedUrl).map((x) => [x.path!, x.signedUrl as string]));
      setReceipts(rec.filter((e) => url.has(e.receipt_path!)).map((e) => ({
        key: `receipt:${e.id}`, src: url.get(e.receipt_path!)!, day: e.expense_date, stamp: fmtDay(e.expense_date), tech: e.contractor_name,
        caption: `${e.status === 'declined' ? 'Declined: ' : ''}${expenseCategoryLabel(e.category)}${e.vendor ? `, ${e.vendor}` : ''}: $${Number(e.amount).toFixed(2)}`
          + (e.status === 'declined' && e.decline_reason ? ` (${e.decline_reason})` : ''),
        declined: e.status === 'declined',
        pdf: /\.pdf$/i.test(e.receipt_path!),
      })));
      setOdometer(odo.filter((o) => url.has(o.photo_path!)).map((o) => ({
        key: `odo:${o.id}`, src: url.get(o.photo_path!)!, day: dayOf(o.at, TZ), stamp: fmtStamp(o.at), tech: o.contractor_name,
        caption: `Odometer ${o.moment === 'end' ? 'end' : 'start'}: ${Number(o.reading).toLocaleString('en-US')}`,
      })));
    });
  }, [w.id, loadedChoices]);

  // Only the photos, after the office adds some: the pictures left out and the
  // ones labeled receipts aren't read again, so a tap made meanwhile is never
  // undone (Greptile on PR #23).
  useEffect(() => {
    if (!added) return;
    void createClient().from('wo_photos').select('id, url, taken_at, lat, lng, contractor_name').eq('wo_id', w.id).order('taken_at')
      .then(({ data }) => { if (data) setPhotos(data as PhotoRow[]); });
  }, [w.id, added]);
  useEffect(() => {
    if (fresh.size) document.querySelector('#job-log-root [data-fresh]')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [fresh, photos]);

  // Printing shows only this report (app/wf.css, body.job-log-open).
  useEffect(() => {
    document.body.classList.add('job-log-open');
    return () => document.body.classList.remove('job-log-open');
  }, []);

  const sitePics: Pic[] = photos.filter((p) => inRange(dayOf(p.taken_at, TZ), from, to)).map((p) => ({
    key: `photo:${p.id}`, src: p.url, day: dayOf(p.taken_at, TZ), stamp: fmtStamp(p.taken_at), tech: p.contractor_name, photoId: p.id,
    caption: receiptPhotos.has(p.id) ? 'Receipt photo' : undefined,
  }));
  const shownPhotos = sitePics.filter((p) => !receiptPhotos.has(p.photoId!));
  // The receipts, then the site photos labeled receipts, by day.
  const shownReceipts = [...receipts.filter((p) => inRange(p.day, from, to)), ...sitePics.filter((p) => receiptPhotos.has(p.photoId!))]
    .sort((a, b) => a.day.localeCompare(b.day));
  const shownOdometer = odometer.filter((p) => inRange(p.day, from, to));
  const printed = (p: Pic) => !p.declined && !leftOut.has(p.key);
  // The pictures taken out of the log: off the screen too, until "Pictures left out" is ticked.
  const leftCount = [...shownReceipts, ...shownOdometer, ...shownPhotos].filter((p) => leftOut.has(p.key)).length;
  const pictureCount = [...(inc.receipts ? shownReceipts : []), ...(inc.odometer ? shownOdometer : []), ...(inc.photos ? shownPhotos : [])]
    .filter(printed).length;
  // The tables, from one sheet: what the app has (the clock-ins, the Field Sheet's miles, the approved
  // receipts), or the job's own sheet once the office has edited it (lib/job-log-sheet.ts).
  const appSheet = useMemo(() => sheetFromApp({
    visits: buildVisits(punches ?? [], logs, new Date(), TZ),
    // A day's miles: the miles typed on the Hours screen, else the odometer, else the GPS.
    mileage: days.filter((r) => !r.hidden)
      .map((r) => ({ tech: r.tech, day: r.day, start: r.values.odoStart ?? null, end: r.values.odoEnd ?? null, miles: dayCalc(r.values, 0).miles }))
      .filter((m) => m.miles > 0 || m.start != null || m.end != null),
    receipts: spent,
    // A day's time on site as the office set it on the Hours screen, in place of that day's clock-ins
    // (Fred, 2026-10-30: "I want to make sure I can edit the time sheet and it shows on the job logs").
    hoursScreen: hoursScreenDays(days),
    timeZone: TZ,
  }), [punches, logs, days, spent]);
  const sheet = savedSheet ?? appSheet;
  const shown = sheetSorted(sheetInDates(sheet, from, to));
  // Each tech's own days and total, then the next tech (Fred, 2026-10-29: "Paul and Kendall separated grouping"),
  // the lead tech first and then the helpers ("Lead tech first and then helper tech").
  const crew = leadFirst(w);
  const timeGroups = byTechGroups(shown.time, (r) => r.tech, crew);
  const mileGroups = byTechGroups(shown.miles, (r) => r.tech, crew);
  const dayCount = (days: string[]) => { const n = new Set(days).size; return `${n} day${n === 1 ? '' : 's'}`; };
  // The hours on site as a number, no money (Fred, 2026-10-29: "Paul 10/23 8am to 5pm total 9 ... Final
  // Hours 19 hours ... Overall total worked 36"; "Don't show the money all we want to see is how much was on site").
  const hrs = (h: number) => h.toLocaleString('en-US', { maximumFractionDigits: 2 });
  // Month/day/year (Fred, 2026-10-30: "Date and year").
  const dateText = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(0, 4)}`;
  // Totals add the hours as each row shows them, so the column adds up the way the client reads it
  // (as the Field Sheet does), and the summary shows that same total (Greptile on PR #37).
  const siteHours = hoursTotal(shown.time);
  const totalMiles = milesTotal(shown.miles);
  const daysOnSite = new Set(shown.time.map((r) => r.day)).size;
  // Meals, materials and the other receipts, as each tech said what the receipt was for when
  // uploading it (Fred, 2026-10-30: "meals get entered by receipt so does materials").
  const mealReceipts = shown.meals;
  const materialReceipts = shown.materials;
  const otherReceipts = shown.other;
  const receiptCount = (n: number) => `${n} receipt${n === 1 ? '' : 's'}`;
  // A tech on the job with nothing in a table gets a line under it, so the client sees why.
  const without = (groups: { tech: string }[]) => crew.filter((t) => !groups.some((g) => g.tech === t));
  // Only a finished job has a "Not completed": on a job still going, it's just work still to do.
  const job = useMemo(() => wfJobFromOwner(w), [w]);
  // Waits for the photos to load, so it never says "No photos" too soon.
  const loaded = punches !== null;
  const gaps = useMemo(() => (loaded && isFinished(job) ? jobGaps(job, deliverables, photos.length) : []), [loaded, job, deliverables, photos.length]);
  // The checklist only when the job asks for one (askedOnly, as on the job page).
  const tasks = asks(parseCapture(w.capture), 'checklist') ? w.wo_tasks ?? [] : [];
  const qa = w.custom_qa ?? [];
  const techs = (w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter(Boolean);
  const where = [w.site_address, [w.site_city, [w.site_state, w.site_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const isUrl = (v: string) => /^https?:\/\//.test(v);
  const siteNo = siteNumber(w);
  // The job's days, first to last: "Mon, Oct 19 – Fri, Oct 23, 2026", or the one day.
  const schedule = (() => {
    const first = (w.start_date || w.scheduled_date)?.slice(0, 10), last = w.end_date?.slice(0, 10);
    if (!first) return '';
    if (!last || last <= first) return fmtDay(first);
    const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${first.slice(0, 4) === last.slice(0, 4) ? short(first) : fmtDay(first)} – ${fmtDay(last)}`;
  })();
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ });
  const range = from || to ? `${from ? fmtDay(from) : 'Start'} – ${to ? fmtDay(to) : 'today'}` : 'Whole job';
  // The saved PDF's name: the print window names it after the page (lib/job-log.ts
  // jobLogName). The days picked, else the job's first and last day on the Field Sheet.
  const worked = [...shown.time.map((r) => r.day), ...shown.miles.map((r) => r.day), ...days.filter((r) => !r.hidden && inRange(r.day, from, to)).map((r) => r.day)].sort();
  const logName = jobLogName(w, from || worked[0] || '', to || worked.at(-1) || '');
  // The client's copy is named so, so the two PDFs don't get mixed up.
  const pdfName = copy === 'client' ? `${logName} · Client copy` : copy === 'invoice' ? `${logName} · Invoice${savedMeta.number ? ` ${savedMeta.number}` : ''}` : logName;
  useEffect(() => {
    const was = document.title;
    document.title = pdfName;
    return () => { document.title = was; };
  }, [pdfName]);
  // How much the invoice shrinks to fit the screen: its printed width (856px) into the width there is.
  useEffect(() => {
    const el = invoiceBox.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setScreenZoom(el.clientWidth > 0 ? Math.min(1, el.clientWidth / 856) : 1);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, [copy]);

  // The rates table (Fred, 2026-10-30: "on the job log give me a table to add or remove rates"): as being changed,
  // else as saved, else a row to fill in for each tech on the sheet. Each tech's hours and miles shown, × the rates
  // set, are the client's charges; a tech taken off the table, or a box left empty, isn't charged.
  const techsOnSheet = sheetTechs(shown, crew);
  const rateTable = rateEdit ?? (Object.keys(savedRates).length ? rateRows(savedRates, crew) : techsOnSheet.map((tech) => ({ tech, hour: null, mile: null })));
  const rates = ratesFromRows(rateTable);
  // One rate for all the hours: on, with the rate typed, every tech's hours are at it (a box left empty: each tech's own).
  const all = allEdit ?? { on: savedAll != null, hour: savedAll };
  const typedAll = all.on ? all.hour : null;
  // The rates each row is charged at: each tech's, or the one for all hours. As typed, and as saved.
  const typedRates = withAllHoursRate(shown, rates, typedAll);
  const billRates = withAllHoursRate(shown, savedRates, savedAll);
  // The invoice: each tech's hours, meals, mileage and hotel at their rates, as saved or as it's being edited.
  const invSheet = invDraft ? sheetSorted(sheetInDates(invDraft.sheet, from, to)) : shown;
  const invRates = invDraft ? withAllHoursRate(invSheet, invDraft.rates, invDraft.together.on ? invDraft.together.hour : null) : billRates;
  const invMeta = invDraft ? parseInvoiceMeta(invDraft.meta, todayDay) : savedMeta;
  // Billed to as typed on the invoice (Fred's sample: TeamNetView), else the work order's customer.
  const invoiceHead: InvoiceHead = { billTo: invMeta.billTo || (w.customer_name ?? ''), shipTo: [w.title ?? '', where].filter(Boolean), meta: invMeta };
  const invoice = copy === 'invoice' ? buildInvoice(invSheet, invRates, crew, invMeta, [w.site_city, w.site_state].filter(Boolean).join(' ')) : null;
  // The total under the table as the rates are typed; the page, the print and Excel with the rates saved, so a
  // print (the button, or the browser's own) is never of rates that aren't kept (CodeRabbit on PR #40).
  const typedCharges = chargesByTech(shown, typedRates, crew);
  const charges = chargesByTech(shown, billRates, crew);
  const unbilled = notCharged(shown, typedRates, crew);
  const ratesChanged = !sameRates(rates, savedRates) || typedAll !== savedAll;
  // The client's copy prints and downloads only with its rates saved and loaded: never an empty "$0.00" copy, or
  // rates that aren't kept (CodeRabbit on PR #40).
  const noSavedRates = Object.keys(savedRates).length === 0 && savedAll == null;
  // The invoice prints with its rates saved, and not while it's being edited.
  const clientBlocked = copy === 'client' ? ratesChanged || ratesFailed || noSavedRates : copy === 'invoice' ? ratesFailed || noSavedRates || !!invDraft : false;
  const rateNames = [...new Set([...crew, ...techsOnSheet])];
  const editRates = (change: (rows: RateRow[]) => RateRow[]) => setRateEdit(change(rateTable));
  // The client's copy: each row of the hours and of the miles with its rate and dollars, each tech's and the overall
  // dollars on the totals (Fred, 2026-10-30: "in the hours should get the rate and the same for the milage gets the
  // milages rate"). The tech's copy has none of it.
  const withRates = copy === 'client' && charges.length > 0;
  const chargeOf = (tech: string) => charges.find((c) => c.tech === tech);
  const sumOf = (k: 'labor' | 'mileage') => Math.round(charges.reduce((t, c) => t + (c[k] ?? 0), 0) * 100 + 1e-9) / 100;
  // A rate as it was typed, to four places ($0.725/mi), so the amount beside it can be checked (Greptile on PR #40).
  const rateText = (rate: number) => rate.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const rateCell = (rate: number | null | undefined, unit: string) => <td style={cell}>{rate == null ? '—' : `${rateText(rate)}/${unit}`}</td>;
  const moneyCell = (n: number | null | undefined) => <td style={cell}>{n == null ? '—' : fmtMoney(n)}</td>;
  const setRate = (i: number, patch: Partial<RateRow>) => editRates((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const saveRates = async () => {
    const clean = rates, cleanAll = typedAll;
    setSaving(true);
    const { error } = await queueSave(w.id, () => createClient().from('job_log_rates')
      .upsert({ wo_id: w.id, rates: clean, all_hours_rate: cleanAll, invoice: savedMeta, updated_at: new Date().toISOString() }, { onConflict: 'wo_id' }));
    setSaving(false);
    if (error) { toastError("The rates didn't save. Check your connection and try again."); return; }
    setSavedRates(clean);
    setSavedAll(cleanAll);
    // Back to the table as saved, unless a rate was changed while it saved: that change stays, still to save (Greptile on PR #40).
    setRateEdit((now) => (now && !sameRates(ratesFromRows(now), clean) ? now : null));
    setAllEdit((now) => (now && (now.on ? now.hour : null) !== cleanAll ? now : null));
    toastSuccess("Rates saved. They're on the client's copy only.");
  };

  // Editing on the invoice: each change is to the time sheet under it, a tech's rates or the invoice's own boxes.
  const plusDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  /** A new line's day: the day after the tech's last (a day worked, a drive), or their first day (a hotel, a material). */
  const newDay = (s: JobSheet, tech: string, item: 'Labor' | 'Mileage' | 'Material' | 'Hotel') => {
    const worked = s.time.filter((r) => r.tech === tech).map((r) => r.day).sort();
    const all = [...worked, ...(item === 'Mileage' ? s.miles.filter((r) => r.tech === tech).map((r) => r.day) : [])].sort();
    const day = item === 'Hotel' || item === 'Material' ? worked[0] ?? (from || todayDay) : all.length ? plusDay(all.at(-1)!, 1) : (from || todayDay);
    // In the dates picked, so the line added shows to be filled in (Greptile on PR #44).
    return to && day > to ? to : from && day < from ? from : day;
  };
  type InvDraft = NonNullable<typeof invDraft>;
  const editInv = (f: (d: InvDraft) => InvDraft) => setInvDraft((d) => (d ? f(d) : d));
  const invoiceEditor: InvoiceEditor | undefined = invDraft ? {
    meta: invDraft.meta,
    billToDefault: w.customer_name ?? '',
    setMeta: (p) => editInv((d) => ({ ...d, meta: { ...d.meta, ...p } })),
    together: invDraft.together,
    setTogether: (t) => editInv((d) => ({ ...d, together: t })),
    rateOf: (tech) => invDraft.rates[tech] ?? { hour: null, mile: null },
    setRate: (tech, k, v) => editInv((d) => ({ ...d, rates: { ...d.rates, [tech]: { ...(d.rates[tech] ?? { hour: null, mile: null }), [k]: v } } })),
    change: (l, p) => editInv((d) => ({ ...d, sheet: editLine(d.sheet, l, p) })),
    remove: (l) => editInv((d) => ({ ...d, sheet: removeLine(d.sheet, l) })),
    add: (tech, item) => editInv((d) => ({ ...d, sheet: addLine(d.sheet, tech, item, newDay(d.sheet, tech, item)) })),
  } : undefined;
  // Saved together: the time sheet (only when it changed, so the log still follows the app otherwise), then the rates
  // and the invoice's boxes.
  const saveInvoice = async () => {
    if (!invDraft) return;
    const draftSaved = invDraft;
    const problems = sheetProblems(invDraft.sheet);
    if (problems.length) { toastError(`Each line needs a name and a date: ${problems.join(', ')}.`); return; }
    // The sheet as it started (its rows in their order), so an invoice saved with no change to it doesn't save it.
    const clean = sheetToSave(invDraft.sheet);
    const cleanRates = ratesToSave(invDraft.rates), cleanAll = invDraft.together.on ? invDraft.together.hour : null;
    const cleanMeta = parseInvoiceMeta(invDraft.meta, todayDay);
    const db = createClient();
    setSaving(true);
    if (JSON.stringify(clean) !== JSON.stringify(sheetToSave(sheet))) {
      const { error } = await queueSave(w.id, () => db.from('work_orders').update({ job_log_sheet: clean }).eq('id', w.id));
      if (error) { setSaving(false); toastError("The invoice didn't save. Check your connection and try again."); return; }
      setSavedSheet(clean);
    }
    const { error } = await queueSave(w.id, () => db.from('job_log_rates')
      .upsert({ wo_id: w.id, rates: cleanRates, all_hours_rate: cleanAll, invoice: cleanMeta, updated_at: new Date().toISOString() }, { onConflict: 'wo_id' }));
    setSaving(false);
    if (error) { toastError("The rates and the invoice's number didn't save. Check your connection and try again."); return; }
    setSavedRates(cleanRates);
    setSavedAll(cleanAll);
    setSavedMeta(cleanMeta);
    setRateEdit(null);
    setAllEdit(null);
    // Done editing, unless something was changed while it saved: that stays, still to save (Greptile on PR #44).
    setInvDraft((now) => (now === draftSaved ? null : now));
    toastSuccess('Invoice saved. The job log and its time sheet show it.');
  };

  // Saving an edit: the job keeps its own sheet, and the log, the print and Excel show it from then on.
  const saveSheet = async () => {
    if (!draft) return;
    const problems = sheetProblems(draft);
    if (problems.length) { toastError(`Each row needs a name and a date: ${problems.join(', ')}.`); return; }
    const clean = sheetToSave(draft);
    setSaving(true);
    const { error } = await queueSave(w.id, () => createClient().from('work_orders').update({ job_log_sheet: clean }).eq('id', w.id));
    setSaving(false);
    if (error) { toastError("That didn't save. Check your connection and try again."); return; }
    setSavedSheet(clean);
    setDraft(null);
    toastSuccess('Time sheet saved. The job log, its PDF and Excel show it.');
  };
  // Back to what the app has: the clock-ins, the Field Sheet's miles and the approved receipts.
  const startOver = async () => {
    if (!window.confirm('Go back to what the app has (the clock-ins, the Field Sheet miles and the approved receipts)? Your edits to this time sheet will be gone.')) return;
    setSaving(true);
    const { error } = await queueSave(w.id, () => createClient().from('work_orders').update({ job_log_sheet: null }).eq('id', w.id));
    setSaving(false);
    if (error) { toastError("That didn't save. Check your connection and try again."); return; }
    setSavedSheet(null);
    toastSuccess('The job log shows what the app has again.');
  };
  // Fred's workbook (job-log-timesheet.xlsx) with this log's rows, the days picked; its numbers are formulas.
  const downloadExcel = () => {
    if (invoice) {
      downloadInvoiceXlsx(`${pdfName}.xlsx`, invoice, invoiceHead).catch(() => toastError("The Excel file didn't download. Try again."));
      return;
    }
    const lines = [
      [w.customer_name && `Client: ${w.customer_name}`, w.external_wo_id && `Client WO #: ${w.external_wo_id}`, `FAJ WO #: ${w.wo_number}`].filter(Boolean).join(' · '),
      ...(w.site_name || where ? [`Site: ${[w.site_name, where].filter(Boolean).join(' — ')}`] : []),
      ...(techs.length ? [`Technician${techs.length > 1 ? 's' : ''}: ${techs.join(', ')}`] : []),
    ];
    downloadJobLogXlsx(copy === 'client' ? `${logName} · Client time sheet.xlsx` : `${logName} · Time sheet.xlsx`,
      shown, { title: w.title || 'Work order', lines, range, crew }, copy === 'client' ? billRates : undefined,
      // The receipts the log shows are the ones its breakdown charges, in Excel as in the PDF (CodeRabbit on PR #41).
      { meals: inc.meals, materials: inc.materials, other: inc.otherReceipts }, copy === 'client' && savedAll != null)
      .catch(() => toastError("The Excel file didn't download. Try again."));
  };

  const toggle = (k: keyof Include, label: string) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={inc[k]} onChange={(e) => setInc((s) => ({ ...s, [k]: e.target.checked }))} /> {label}
    </label>
  );

  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #ECE8DF', textAlign: 'left', verticalAlign: 'top' };
  const headCell: React.CSSProperties = { ...cell, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 };
  // Each tech's total on cream; the overall total under a navy rule (the layout Fred okayed, 2026-10-30).
  const techTotal: React.CSSProperties = { fontWeight: 700, background: '#FBF6EA' };
  const overallRow: React.CSSProperties = { fontWeight: 700, borderTop: '2px solid #0E1B2E' };
  // "In these dates" when only some of the job's days are shown (Greptile on PR #38).
  const noneLine = (techs: string[], what: string) => techs.map((t) => (
    <div key={t} className="jl-avoid" style={{ color: '#5E6470', fontSize: 12, marginTop: 6 }}>{t}: no {what} {from || to ? 'in these dates' : 'on this job'}.</div>
  ));

  /**
   * The client's copy, under TOTAL CHARGES: each tech's hours and their dollars, the hours' total, the mileage, then
   * each tech's mileage and the mileage's total, then the receipts' totals as the copy shows them, and all of it added
   * up (Fred, 2026-10-30: "the break down total paul hours total kendal hours and then amount ... then all it all up
   * together for an over all total"; "milage paul mailge + rate same with kendal then the total amount the Meals,
   * Materials and Other receipts ... then OVERALL TOTAL").
   */
  const breakdown = () => {
    const r2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;
    const hotels = otherReceipts.filter(isHotel), restOther = otherReceipts.filter((r) => !isHotel(r));
    const receiptLines = [
      ...(inc.meals && mealReceipts.length > 0 ? [{ what: `Meals · ${receiptCount(mealReceipts.length)}`, amount: moneyTotal(mealReceipts) }] : []),
      ...(inc.materials && materialReceipts.length > 0 ? [{ what: `Materials · ${receiptCount(materialReceipts.length)}`, amount: moneyTotal(materialReceipts) }] : []),
      // The hotels on their own line, then the rest of the other receipts (Fred, 2026-10-30: "see it hotels also").
      ...(inc.otherReceipts && hotels.length > 0 ? [{ what: `Hotels · ${receiptCount(hotels.length)}`, amount: moneyTotal(hotels) }] : []),
      ...(inc.otherReceipts && restOther.length > 0 ? [{ what: `Other receipts · ${receiptCount(restOther.length)}`, amount: moneyTotal(restOther) }] : []),
    ];
    const lines = [
      // A tech's line when they've hours (or miles) to charge for: no "0 mi × $0.60 = $0.00".
      // One rate for all hours: all the techs' hours on one line at it.
      ...(savedAll != null ? [{ what: `All techs’ hours · ${hrs(r2(charges.reduce((t, c) => t + c.hours, 0)))} × ${rateText(savedAll)}/hr`, amount: sumOf('labor'), bold: true }] : [
        ...charges.filter((c) => c.hourRate != null && c.hours > 0).map((c) => ({ what: `${c.tech} hours · ${hrs(c.hours)} × ${rateText(c.hourRate!)}/hr`, amount: c.labor ?? 0, bold: false })),
        { what: 'Hours total', amount: sumOf('labor'), bold: true },
      ]),
      ...charges.filter((c) => c.mileRate != null && c.miles > 0).map((c) => ({ what: `${c.tech} mileage · ${c.miles.toLocaleString('en-US')} mi × ${rateText(c.mileRate!)}/mi`, amount: c.mileage ?? 0, bold: false })),
      ...(charges.some((c) => c.mileRate != null) ? [{ what: 'Mileage total', amount: sumOf('mileage'), bold: true }] : []),
      ...receiptLines.map((l) => ({ ...l, bold: false })),
    ];
    const overall = r2(chargesTotal(charges) + receiptLines.reduce((t, l) => t + l.amount, 0));
    return (
      <div className="jl-sec jl-avoid">
        <H>Breakdown</H>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="jl-avoid" style={l.bold ? techTotal : undefined}>
                <td style={cell}>{l.what}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="jl-band jl-avoid" style={{ marginTop: 10, background: '#0E1B2E', color: '#fff', borderRadius: 8, padding: '9px 14px', display: 'flex', flexWrap: 'wrap', gap: '4px 22px', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 14 }}>
          <b style={{ color: '#E3C987', letterSpacing: 1 }}>OVERALL TOTAL</b>
          <b>{fmtMoney(overall)}</b>
        </div>
      </div>
    );
  };

  /**
   * A table of receipts like the hours: each tech's receipts (name and date on every row), the tech's
   * total, then the overall total. `forCol`: a "For" column with what the tech said the receipt was for.
   */
  const receiptTable = (list: MoneyRow[], what: string, forCol: boolean) => {
    const groups = byTechGroups(list, (r) => r.tech, crew);
    const span = forCol ? 4 : 3;
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ background: '#F6F4EF' }}>
          {['Name', 'Date', ...(forCol ? ['For'] : []), 'Store', 'Amount'].map((h) => <th key={h} style={headCell}>{h}</th>)}
        </tr></thead>
        {groups.map((g) => (
          <tbody key={g.tech} className="jl-avoid">
            {g.items.map((e, i) => (
              <tr key={i} className="jl-avoid">
                <td style={cell}>{e.tech}</td>
                <td style={cell}>{dateText(e.day)}</td>
                {/* What the tech picked, and their own note on it when they wrote one (CodeRabbit on PR #38). */}
                {forCol && <td style={{ ...cell, overflowWrap: 'anywhere' }}>{e.for || '—'}</td>}
                <td style={cell}>{e.store || '—'}</td>
                <td style={cell}>{fmtMoney(e.amount)}</td>
              </tr>
            ))}
            <tr className="jl-avoid" style={techTotal}>
              <td style={cell} colSpan={span}>{g.tech} total{what ? ` ${what}` : ''} · {receiptCount(g.items.length)}</td>
              <td style={cell}>{fmtMoney(moneyTotal(g.items))}</td>
            </tr>
          </tbody>
        ))}
        <tbody>
          <tr className="jl-avoid" style={overallRow}>
            <td style={cell} colSpan={span}>Overall total {what || 'other receipts'}</td>
            <td style={cell}>{fmtMoney(moneyTotal(list))}</td>
          </tr>
        </tbody>
      </table>
    );
  };

  /**
   * A section of pictures, each with its mark to take it out or put it back.
   * Left out: not printed, and shown (faded) only while "Pictures left out" is
   * ticked. `whole`: each one shown uncropped, so a long receipt keeps its date
   * and total.
   */
  const pictures = (title: string, all: Pic[], whole = false) => {
    const list = all.filter((p) => inc.leftOut || !leftOut.has(p.key));
    return list.length > 0 && (
    <div className={list.some(printed) ? undefined : 'no-print'}>
      <H>{title}</H>
      <div className={whole ? undefined : 'jl-grid-4'} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        {list.map((p) => {
          const out = !printed(p);
          // Taken out with its ✗; a declined receipt can be too, though it never prints either way.
          const taken = leftOut.has(p.key);
          const what = `${p.caption ?? 'Photo'} ${p.stamp}`;
          const isReceipt = p.photoId ? receiptPhotos.has(p.photoId) : false;
          return (
            <div key={p.key} className={out ? 'jl-avoid no-print' : 'jl-avoid'} style={{ position: 'relative' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.pdf ? (
                <a href={p.src} target="_blank" rel="noopener noreferrer" aria-label={what}
                  style={{ aspectRatio: '3 / 4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 6, border: '1px solid #E4DFD3', background: '#F6F4EF', color: '#0E1B2E', textDecoration: 'none', fontSize: 12, fontWeight: 600, opacity: out ? 0.35 : 1 }}>
                  <FileText size={28} /> PDF receipt
                  <span className="no-print" style={{ fontWeight: 400 }}>Tap to open</span>
                </a>
              ) : (
                <img src={p.src} alt={what} style={{ width: '100%', aspectRatio: whole ? '3 / 4' : '4 / 3', objectFit: whole ? 'contain' : 'cover', background: whole ? '#F6F4EF' : undefined, borderRadius: 6, border: '1px solid #E4DFD3', display: 'block', opacity: out ? 0.35 : 1 }} />
              )}
              {p.photoId && fresh.has(p.src) && (
                <span className="no-print" data-fresh style={{ position: 'absolute', top: 6, left: 6, background: '#C9A24B', color: '#0E1B2E', borderRadius: 10, padding: '3px 9px', fontSize: 11.5, fontWeight: 700 }}>New</span>
              )}
              {p.declined && (
                <span style={{ position: 'absolute', top: 6, left: 6, background: '#B42318', color: '#fff', borderRadius: 10, padding: '3px 9px', fontSize: 11.5, fontWeight: 700 }}>Declined</span>
              )}
              {/* The mark is what a tap does: ✗ takes it out, ✓ puts it back. Every picture has one,
                  a declined receipt too (Fred, 2026-10-26: "remove on every photo and receipt"). */}
              <button type="button" className="no-print"
                onClick={() => {
                  // The first one out (none others showing as left out, in these dates): off the screen,
                  // whatever was ticked before (Greptile on PR #24).
                  if (!taken && leftCount === 0) setInc((s) => ({ ...s, leftOut: false }));
                  // Said once it's saved, and only if it's still out then (Greptile on PR #24).
                  void flip(p.key).then((ok) => {
                    if (ok && !taken && savedOut(p.key)) toastSuccess('Taken out of the job log. It’s still on the job: tick “Pictures left out” to see it.');
                  });
                }}
                aria-label={taken ? `Put back in the log: ${what}` : `Leave out of the log: ${what}`} title={taken ? 'Not in the job log. Tap ✓ to put it back.' : 'In the job log. Tap ✗ to take it out; it stays on the job.'}
                style={{ position: 'absolute', top: 6, right: 6, width: 32, height: 32, borderRadius: 16, border: `2px solid ${taken ? '#fff' : '#B42318'}`, background: taken ? '#047857' : '#fff', color: taken ? '#fff' : '#B42318', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                {taken ? <Check size={18} /> : <X size={18} />}
              </button>
              <div style={{ fontSize: 11, color: p.declined ? '#B42318' : '#5E6470', marginTop: 3 }}>
                {p.caption ? `${p.caption} · ` : ''}{p.stamp}{p.tech ? ` · ${p.tech}` : ''}
              </div>
              {taken && (
                <div style={{ fontSize: 11, fontWeight: 700, color: '#B42318', marginTop: 2 }}>Not in the job log: the client won’t see it. Still on the job.</div>
              )}
              {(() => {
                const name = photoFileName([`WO ${w.wo_number}`, p.caption ?? 'Photo', p.tech, `${p.day.slice(5, 7)}-${p.day.slice(8, 10)}-${p.day.slice(0, 4)}`], fileExt(p.src, p.pdf ? 'pdf' : 'jpg'));
                return (
                  <a className="no-print" href={downloadHref(p.src, name)} download={name} aria-label={`Download ${what}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 600, color: '#0E1B2E', marginTop: 3 }}>
                    <Download size={12} /> Download
                  </a>
                );
              })()}
              {p.photoId && (
                <div className="no-print" role="group" aria-label={`Label ${what}`} style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {([[true, 'Receipt'], [false, 'Not a receipt']] as const).map(([r, text]) => (
                    <button key={text} type="button" aria-pressed={isReceipt === r} onClick={() => { if (isReceipt !== r) label(p.photoId!, r); }}
                      style={{ flex: 1, fontSize: 11.5, padding: '3px 4px', borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${isReceipt === r ? '#0E1B2E' : '#D8D3C8'}`, background: isReceipt === r ? '#0E1B2E' : '#fff', color: isReceipt === r ? '#fff' : '#1B1C1F' }}>
                      {text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
    );
  };

  return createPortal(
    <div id="job-log-root" className="wf" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(2,4,9,0.55)', overflowY: 'auto', padding: '16px 12px 40px' }}>
      {/* Controls — never printed */}
      <div className="no-print" style={{ maxWidth: 850, margin: '0 auto 12px', background: '#F6F4EF', borderRadius: 14, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 16, flex: '1 1 160px' }}>Job log · WO {w.wo_number}</div>
        <label style={{ fontSize: 13 }}>From <input type="date" className="wf-input" style={{ width: 150, minHeight: 36, padding: '4px 8px' }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 13 }}>To <input type="date" className="wf-input" style={{ width: 150, minHeight: 36, padding: '4px 8px' }} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {/* Not until the job's days are in: the PDF's name has them (Greptile on PR #21). */}
        {/* While editing, save first: the print and Excel are what's saved. */}
        {/* And the rates saved first on the client's copy, so what's printed is what's kept. */}
        <button className="wf-btn wf-btn-gold wf-btn-sm" disabled={!loaded || !!draft || clientBlocked} onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={!loaded || !!draft || clientBlocked} onClick={downloadExcel}><FileSpreadsheet size={16} /> Time sheet in Excel</button>
        {copy === 'invoice' ? (invDraft ? (
          <>
            <button className="wf-btn wf-btn-gold wf-btn-sm" disabled={saving} onClick={() => void saveInvoice()}><Check size={16} /> {saving ? 'Saving…' : 'Save invoice'}</button>
            <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={saving} onClick={() => setInvDraft(null)}>Cancel</button>
          </>
        ) : (
          <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={!loaded || ratesFailed}
            // From the rates as they're typed on the client's copy, saved or not, so none are lost (CodeRabbit on PR #44).
            onClick={() => setInvDraft({ sheet, rates, together: all, meta: savedMeta })}><Pencil size={16} /> Edit invoice</button>
        )) : draft ? (
          <>
            <button className="wf-btn wf-btn-gold wf-btn-sm" disabled={saving} onClick={() => void saveSheet()}><Check size={16} /> {saving ? 'Saving…' : 'Save time sheet'}</button>
            <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={saving} onClick={() => setDraft(null)}>Cancel</button>
          </>
        ) : (
          <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={!loaded} onClick={() => setDraft(sheetByTech(sheet, crew))}><Pencil size={16} /> Edit time sheet</button>
        )}
        <AddJobPhotos woId={w.id} woNumber={w.wo_number} techs={techs.filter((t): t is string => !!t)}
          day={photoDay(w.start_date, w.end_date, new Date().toLocaleDateString('en-CA', { timeZone: TZ }))} onAdded={(urls) => { setFresh(new Set(urls)); setAdded((n) => n + 1); }} />
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div role="group" aria-label="Which copy" style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1B1C1F', marginRight: 4 }}>Copy:</span>
          <button type="button" aria-pressed={copy === 'tech'} className={`wf-btn wf-btn-sm ${copy === 'tech' ? 'wf-btn-navy' : 'wf-btn-outline'}`} disabled={!!draft || !!invDraft} onClick={() => setCopy('tech')}>Tech copy (no rates)</button>
          <button type="button" aria-pressed={copy === 'client'} className={`wf-btn wf-btn-sm ${copy === 'client' ? 'wf-btn-navy' : 'wf-btn-outline'}`} disabled={!!draft || !!invDraft} onClick={() => setCopy('client')}>Client copy (rates)</button>
          <button type="button" aria-pressed={copy === 'invoice'} className={`wf-btn wf-btn-sm ${copy === 'invoice' ? 'wf-btn-navy' : 'wf-btn-outline'}`} disabled={!!draft || !!invDraft} onClick={() => setCopy('invoice')}>Invoice</button>
        </div>
        {copy === 'invoice' && (
          <div role="status" style={{ flexBasis: '100%', fontSize: 13, background: '#FBF6EA', border: '1px solid #E3C987', borderRadius: 10, padding: '8px 12px' }}>
            {invDraft ? <>Editing the invoice: type each tech’s $ per hour and ¢ per mile in the box at its top, change any day, hours, meals, miles or hotel right on its lines, add or take out a line, then <b>Save invoice</b>. The job log’s time sheet changes with it.</>
              : ratesFailed ? 'The saved rates didn’t load, so the invoice can’t be changed or printed right now. Close the job log and open it again.'
                : noSavedRates ? <>Press <b>Edit invoice</b>, type each tech’s $ per hour and ¢ per mile in the box at its top, then <b>Save invoice</b> to print it.</>
                  : <>The invoice as the client lays it out. <b>Edit invoice</b> to change it right on its lines.</>}
          </div>
        )}
        {copy === 'client' && (
          <div style={{ flexBasis: '100%', background: '#fff', border: '1px solid #E3C987', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Rates <span style={{ fontWeight: 400, color: '#5E6470' }}>(on the client’s copy only; a box left empty isn’t charged)</span></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              {/* The techs' hours separate, each at their own rate, or together at one (Fred: "give me the options for together or separate hours"). */}
              <div role="group" aria-label="Hours on the client's copy" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, marginRight: 4 }}>Hours:</span>
                <button type="button" aria-pressed={!all.on} className={`wf-btn wf-btn-sm ${!all.on ? 'wf-btn-navy' : 'wf-btn-outline'}`} onClick={() => setAllEdit({ on: false, hour: all.hour })}>Separate (each tech’s rate)</button>
                <button type="button" aria-pressed={all.on} className={`wf-btn wf-btn-sm ${all.on ? 'wf-btn-navy' : 'wf-btn-outline'}`} onClick={() => setAllEdit({ on: true, hour: all.hour })}>Together (one rate)</button>
              </div>
              {all.on && <>
                <span style={{ width: 110 }}><NumBox label="$ per hour, all techs" value={all.hour} onChange={(n) => setAllEdit({ on: true, hour: n })} /></span>
                <span style={{ fontSize: 12.5, color: '#5E6470' }}>{all.hour == null ? 'Type the $ per hour for all the hours.' : 'All the techs’ hours on one line at this rate, in place of each tech’s.'}</span>
              </>}
            </div>
            <div className="jlr-row" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: '#5E6470' }}>
              <span>Name</span><span>$ per hour</span><span>¢ per mile</span><span />
            </div>
            {rateTable.map((r, i) => (
              <div key={`${i}-${r.tech}`} className="jlr-row" style={{ padding: '4px 0', borderTop: '1px solid #ECE8DF' }}>
                <select aria-label={`Name, rate row ${i + 1}`} className="wf-input" style={{ minHeight: 36, padding: '4px 4px', fontSize: 13 }} value={r.tech}
                  onChange={(e) => setRate(i, { tech: e.target.value })}>
                  <option value="">Pick a tech</option>
                  {rateNames.filter((n) => n === r.tech || !rateTable.some((o) => o.tech === n)).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <NumBox label={`$ per hour, ${r.tech || `rate row ${i + 1}`}`} value={r.hour} onChange={(n) => setRate(i, { hour: n })} disabled={all.on} />
                {/* In cents (Fred: "Cent per mile"). */}
                <NumBox label={`¢ per mile, ${r.tech || `rate row ${i + 1}`}`} value={toCents(r.mile)} onChange={(n) => setRate(i, { mile: fromCents(n) })} />
                <button type="button" aria-label={`Take out ${r.tech || `rate row ${i + 1}`}`} title="Take this rate out" onClick={() => editRates((rows) => rows.filter((_, j) => j !== i))}
                  style={{ width: 32, height: 32, border: 'none', background: 'none', color: '#B42318', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
              </div>
            ))}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" disabled={rateNames.every((n) => rateTable.some((r) => r.tech === n))}
                onClick={() => editRates((rows) => [...rows, { tech: rateNames.find((n) => !rows.some((r) => r.tech === n)) ?? '', hour: null, mile: null }])}><Plus size={14} /> Add a rate</button>
              <button className="wf-btn wf-btn-gold wf-btn-sm" disabled={saving || !ratesChanged || ratesFailed} onClick={() => void saveRates()}><Check size={16} /> {saving ? 'Saving…' : 'Save rates'}</button>
              {ratesChanged ? <span style={{ fontSize: 12.5, color: '#5E6470' }}>Save the rates, then print or download.</span>
                : noSavedRates && !ratesFailed && <span style={{ fontSize: 12.5, color: '#5E6470' }}>Set a rate and save it to print the client’s copy.</span>}
              {/* The total as the rates are typed (Fred: "i enter the rates and it shows the total"). */}
              <b style={{ marginLeft: 'auto', fontSize: 14 }}>Total {fmtMoney(chargesTotal(typedCharges))}</b>
            </div>
            {ratesFailed && <div role="alert" style={{ fontSize: 12.5, color: '#B42318', marginTop: 6 }}>The saved rates didn’t load, so they can’t be changed or printed right now. Close the job log and open it again.</div>}
            {unbilled.length > 0 && <div style={{ fontSize: 12.5, color: '#B42318', marginTop: 6 }}>Not charged (no rates): {unbilled.join(', ')}.</div>}
          </div>
        )}
        <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: '6px 16px', color: '#5E6470' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1B1C1F' }}>Show:</span>
          {gaps.length > 0 && toggle('gaps', 'Not completed')}{toggle('time', 'Hours')}{shown.miles.length > 0 && toggle('mileage', 'Mileage')}{mealReceipts.length > 0 && toggle('meals', 'Meals')}{materialReceipts.length > 0 && toggle('materials', 'Materials')}{otherReceipts.length > 0 && toggle('otherReceipts', 'Other receipts')}{tasks.length > 0 && toggle('checklist', 'Checklist')}{toggle('answers', 'Answers')}
          {toggle('notes', "Tech's notes")}{(receipts.length > 0 || receiptPhotos.size > 0) && toggle('receipts', 'Receipts')}{odometer.length > 0 && toggle('odometer', 'Odometer')}
          {toggle('photos', 'Photos')}{toggle('scope', 'Scope of work')}{leftCount > 0 && toggle('leftOut', `Pictures left out (${leftCount})`)}
        </div>
        <div style={{ flexBasis: '100%', fontSize: 12.5, color: '#5E6470' }}>
          Tap <b style={{ color: '#B42318' }}>✗</b> on a picture to take it out of the job log: the client won’t see it, and it stays on the job. Tick “Pictures left out” to see those again, and tap <b style={{ color: '#047857' }}>✓</b> to put one back. Label a photo Receipt and it goes with the receipts. Declined receipts never print, and their ✗ takes them off the screen too. Nothing is deleted.
        </div>
        {draft && (
          <div role="status" style={{ flexBasis: '100%', fontSize: 13, background: '#FBF6EA', border: '1px solid #E3C987', borderRadius: 10, padding: '8px 12px' }}>
            Editing the time sheet: every day’s hours, miles, meals, materials and other receipts. Change any box, add a row or take one out, then <b>Save time sheet</b>, and the job log shows it. The clock-ins, the Hours screen and the receipts stay as they are.
          </div>
        )}
        {savedSheet && !draft && (
          <div role="status" style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13, background: '#FBF6EA', border: '1px solid #E3C987', borderRadius: 10, padding: '8px 12px' }}>
            <span style={{ flex: '1 1 260px' }}>The job log shows your time sheet, so a new clock-in, a change on the Hours screen, or a new mile or receipt won’t show here.</span>
            <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={saving} onClick={() => void startOver()}>Start over from the app</button>
          </div>
        )}
      </div>

      {/* The report itself; or the invoice, as the client lays it out. */}
      {invoice ? (
        <div className="jl-page" style={{ maxWidth: 850, margin: '0 auto', background: '#fff', color: '#000', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
          {/* While it's edited, the browser's own print has none of it: only what's saved is ever printed (Greptile on PR #44). */}
          {screenZoom < 1 && !invDraft && (
            <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 10px 0' }}>
              <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setFullSize((f) => !f)}>{fullSize ? 'Fit to screen' : 'Full size (swipe sideways)'}</button>
            </div>
          )}
          <div ref={invoiceBox} className={`jl-invoice-scroll${invDraft ? ' no-print' : ''}`}>
            <div className="jl-invoice-zoom" style={screenZoom < 1 && !fullSize && !invDraft ? { zoom: screenZoom } : undefined}>
              <JobLogInvoice invoice={invoice} head={invoiceHead} edit={invoiceEditor} />
            </div>
          </div>
          {invDraft && <div className="jl-print-only" style={{ padding: 24 }}>The invoice is being changed. Save it, then print it.</div>}
        </div>
      ) : (
      <div className="jl-page" style={{ maxWidth: 850, margin: '0 auto', background: '#fff', color: '#1B1C1F', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', fontSize: 13 }}>
        <div className="jl-band" style={{ background: 'linear-gradient(180deg, #13284A 0%, #0E1B2E 100%)', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="jl-logo" src="/wf/logo-wide.png" alt="FAJ Solutions — Technology. Delivered." style={{ height: 54, width: 'auto' }} />
          <div style={{ textAlign: 'right', color: '#fff' }}>
            <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 1.5, color: '#E3C987' }}>JOB LOG</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{range}</div>
          </div>
        </div>

        <div className="jl-body" style={{ padding: '20px 24px 28px' }}>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{w.title || 'Work order'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '6px 20px', marginTop: 10 }}>
            {/* What the client reads first (Fred, 2026-10-30): "Client WO:#, site Number:, Site address:, schedule:
                Mon Oct 19 thue Oct 23, technician:". FAJ's own WO number only when the client hasn't one. */}
            <div><b>{w.external_wo_id ? 'Client WO #' : 'WO #'}:</b> {w.external_wo_id || w.wo_number}</div>
            {siteNo && <div><b>Site number:</b> {siteNo}</div>}
            {where && <div><b>Site address:</b> {where}</div>}
            {schedule && <div><b>Schedule:</b> {schedule}</div>}
            {techs.length > 0 && <div><b>Technician{techs.length > 1 ? 's' : ''}:</b> {techs.join(', ')}</div>}
          </div>

          <div className="jl-avoid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 16 }}>
            {[
              ...(siteHours > 0 ? [['Hours on site', hrs(siteHours)]] : []),
              ...(daysOnSite > 0 ? [['Days', String(daysOnSite)]] : []),
              ...(totalMiles > 0 ? [['Miles', totalMiles.toLocaleString('en-US')]] : []),
              ...(mealReceipts.length ? [['Meals', fmtMoney(moneyTotal(mealReceipts))]] : []),
              ...(materialReceipts.length ? [['Materials', fmtMoney(moneyTotal(materialReceipts))]] : []),
              ...(otherReceipts.length ? [['Other receipts', fmtMoney(moneyTotal(otherReceipts))]] : []),
              ...(pictureCount > 0 ? [['Pictures', String(pictureCount)]] : []),
              ...(tasks.length ? [['Checklist', `${tasks.filter((t) => t.completed).length} of ${tasks.length}`]] : []),
              ...(qa.length ? [['Questions', `${qa.filter((q) => (q.answer ?? '').trim()).length} of ${qa.length}`]] : []),
            ].map(([label, value]) => (
              <div key={label} className="jl-tile" style={{ border: '1px solid #E4DFD3', borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: '#5E6470', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
                <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 18, fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>

          {inc.gaps && gaps.length > 0 && (
            <>
              <H>Not completed</H>
              <div className="jl-avoid" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {gaps.map((g) => (
                  <div key={g.text} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: '#B42318', fontWeight: 700, width: 16 }}>✗</span>
                    <span style={{ flex: 1 }}>{g.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {inc.scope && w.description && (<><H>Scope of work</H><div style={{ whiteSpace: 'pre-wrap' }}>{w.description}</div></>)}

          {/* Editing: every row of the five tables, as Fred's workbook has them (components/JobSheetEditor.tsx). */}
          {draft ? (
            <JobSheetEditor sheet={draft} onChange={setDraft} crew={crew} firstDay={from || w.start_date?.slice(0, 10) || dayOf(new Date().toISOString(), TZ)} />
          ) : (
            <>
              {inc.time && (punches === null || shown.time.length > 0) && (
                <div className="jl-sec">
                  <H>Time on site</H>
                  {punches === null ? <div style={{ color: '#5E6470' }}>Loading…</div>
                    : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        {/* Fred's own sheet, 2026-10-30: Name | date | clock in | clock out | (break) | hours. One row each time a tech
                            clocks in and out, so a day with a break shows both, and the gap between them. */}
                        <thead><tr style={{ background: '#F6F4EF' }}>
                          {['Name', 'Date', 'Clock in', 'Clock out', 'Break', 'Hours', ...(withRates ? ['Rate', 'Amount'] : [])].map((h) => <th key={h} style={headCell}>{h}</th>)}
                        </tr></thead>
                        {/* Each tech's rows in their own body, kept on one page when they fit (Greptile on PR #35). */}
                        {timeGroups.map((g) => (
                          <tbody key={g.tech} className="jl-avoid">
                            {g.items.map((r, i) => {
                              const h = rowHours(r);
                              return (
                                <tr key={i} className="jl-avoid">
                                  <td style={cell}>{r.tech}</td>
                                  <td style={cell}>{dateText(r.day)}</td>
                                  <td style={cell}>{clock12(r.in)}</td>
                                  <td style={cell}>{r.out ? clock12(r.out) : r.open ? 'On site now' : '—'}</td>
                                  <td style={cell}>{r.brk ? hrs(r.brk) : '—'}</td>
                                  <td style={cell}>{h == null ? '—' : hrs(h)}</td>
                                  {withRates && <>{rateCell(billRates[r.tech]?.hour, 'hr')}{moneyCell(lineAmount(h, billRates[r.tech]?.hour))}</>}
                                </tr>
                              );
                            })}
                            <tr className="jl-avoid" style={techTotal}>
                              <td style={cell} colSpan={5}>{g.tech} final hours · {dayCount(g.items.map((r) => r.day))}</td>
                              <td style={cell}>{hrs(hoursTotal(g.items))}</td>
                              {withRates && <><td style={cell} />{moneyCell(chargeOf(g.tech)?.labor)}</>}
                            </tr>
                          </tbody>
                        ))}
                        {/* At the bottom with one tech too, as the mileage table's total is (CodeRabbit on PR #37). */}
                        <tbody>
                          <tr className="jl-avoid" style={overallRow}>
                            <td style={cell} colSpan={5}>Overall total worked</td>
                            <td style={cell}>{hrs(siteHours)}</td>
                            {withRates && <><td style={cell} />{moneyCell(sumOf('labor'))}</>}
                          </tr>
                        </tbody>
                      </table>
                    )}
                </div>
              )}

              {inc.mileage && shown.miles.length > 0 && (
                <div className="jl-sec">
                  <H>Mileage</H>
                  {/* Like the hours: name and date on every row, each tech's total, then the overall total. */}
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ background: '#F6F4EF' }}>
                      {['Name', 'Date', 'Odometer start', 'Odometer end', 'Miles', ...(withRates ? ['Rate', 'Amount'] : [])].map((h) => <th key={h} style={headCell}>{h}</th>)}
                    </tr></thead>
                    {mileGroups.map((g) => (
                      <tbody key={g.tech} className="jl-avoid">
                        {g.items.map((r, i) => (
                          <tr key={i} className="jl-avoid">
                            <td style={cell}>{r.tech}</td>
                            <td style={cell}>{dateText(r.day)}</td>
                            <td style={cell}>{r.start != null ? r.start.toLocaleString('en-US') : '—'}</td>
                            <td style={cell}>{r.end != null ? r.end.toLocaleString('en-US') : '—'}</td>
                            <td style={cell}>{r.miles.toLocaleString('en-US')}</td>
                            {withRates && <>{rateCell(billRates[r.tech]?.mile, 'mi')}{moneyCell(lineAmount(r.miles, billRates[r.tech]?.mile))}</>}
                          </tr>
                        ))}
                        <tr className="jl-avoid" style={techTotal}>
                          <td style={cell} colSpan={4}>{g.tech} total miles · {dayCount(g.items.map((r) => r.day))}</td>
                          <td style={cell}>{milesTotal(g.items).toLocaleString('en-US')}</td>
                          {withRates && <><td style={cell} />{moneyCell(chargeOf(g.tech)?.mileage)}</>}
                        </tr>
                      </tbody>
                    ))}
                    <tbody>
                      <tr className="jl-avoid" style={overallRow}>
                        <td style={cell} colSpan={4}>Overall total miles</td><td style={cell}>{totalMiles.toLocaleString('en-US')}</td>
                        {withRates && <><td style={cell} />{moneyCell(sumOf('mileage'))}</>}
                      </tr>
                    </tbody>
                  </table>
                  {noneLine(without(mileGroups), 'miles')}
                </div>
              )}

              {inc.meals && mealReceipts.length > 0 && (
                <div className="jl-sec">
                  <H>Meals</H>
                  {receiptTable(mealReceipts, 'meals', false)}
                  {noneLine(without(byTechGroups(mealReceipts, (r) => r.tech, crew)), 'meals')}
                </div>
              )}

              {inc.materials && materialReceipts.length > 0 && (
                <div className="jl-sec">
                  <H>Materials</H>
                  {receiptTable(materialReceipts, 'materials', false)}
                  {noneLine(without(byTechGroups(materialReceipts, (r) => r.tech, crew)), 'materials')}
                </div>
              )}

              {inc.otherReceipts && otherReceipts.length > 0 && (
                <div className="jl-sec">
                  <H>Other receipts</H>
                  {receiptTable(otherReceipts, '', true)}
                </div>
              )}

              {/* The job's hours and miles in one line, as on Fred's workbook. No money on it: no billable total ("No, keep it off"),
                  and the receipts' dollars stay in their own tables (Fred, 2026-10-30: "i dont want it mix"). */}
              {(siteHours > 0 || totalMiles > 0) && (
                <div className="jl-band jl-avoid" style={{ marginTop: 16, background: '#0E1B2E', color: '#fff', borderRadius: 8, padding: '9px 14px', display: 'flex', flexWrap: 'wrap', gap: '4px 22px', alignItems: 'baseline', fontSize: 13 }}>
                  <b style={{ color: '#E3C987', letterSpacing: 1 }}>JOB TOTAL</b>
                  <span>Hours <b>{hrs(siteHours)}</b></span>
                  <span>Miles <b>{totalMiles.toLocaleString('en-US')}</b></span>
                </div>
              )}

              {/* The client's copy only: the hours' and the miles' dollars, and the two added up. */}
              {withRates && (
                <div className="jl-band jl-avoid" style={{ marginTop: 10, background: '#0E1B2E', color: '#fff', borderRadius: 8, padding: '9px 14px', display: 'flex', flexWrap: 'wrap', gap: '4px 22px', alignItems: 'baseline', fontSize: 13 }}>
                  <b style={{ color: '#E3C987', letterSpacing: 1 }}>TOTAL CHARGES</b>
                  <span>Hours <b>{fmtMoney(sumOf('labor'))}</b></span>
                  <span>Mileage <b>{fmtMoney(sumOf('mileage'))}</b></span>
                  <span>Total <b>{fmtMoney(chargesTotal(charges))}</b></span>
                </div>
              )}
              {withRates && breakdown()}
            </>
          )}

          {inc.checklist && tasks.length > 0 && (
            <>
              <H>Checklist</H>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tasks.map((t) => (
                  <div key={t.id} className="jl-avoid" style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: t.completed ? '#047857' : '#9AA0AA', fontWeight: 700, width: 16 }}>{t.completed ? '✓' : '○'}</span>
                    <span style={{ flex: 1 }}>{t.label}</span>
                    <span style={{ color: '#5E6470', fontSize: 12 }}>{t.completed && t.completed_at ? fmtStamp(t.completed_at) : t.category}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {inc.answers && qa.length > 0 && (
            <>
              <H>Answers</H>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {qa.map((q) => {
                  const a = (q.answer ?? '').trim();
                  return (
                    <div key={q.id} className="jl-avoid">
                      <div style={{ fontWeight: 600 }}>{q.label}</div>
                      {!a ? <div style={{ color: '#9AA0AA' }}>Not answered</div>
                        : isUrl(a)
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={a} alt={q.label} style={{ maxWidth: 260, maxHeight: 160, borderRadius: 6, border: '1px solid #E4DFD3', marginTop: 4 }} />
                          : <div style={{ whiteSpace: 'pre-wrap' }}>{a}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {inc.notes && (w.closeout_notes ?? '').trim() && (
            <><H>Technician&apos;s notes</H><div className="jl-avoid" style={{ whiteSpace: 'pre-wrap' }}>{w.closeout_notes}</div></>
          )}

          {/* On paper the pictures start on a page of their own, after the tables (when any will print). */}
          <div className={pictureCount > 0 ? 'jl-pics' : undefined}>
            {inc.receipts && pictures('Receipts', shownReceipts, true)}
            {inc.odometer && pictures('Odometer', shownOdometer)}
            {inc.photos && pictures('Photos', shownPhotos)}
          </div>

          <div style={{ marginTop: 28, paddingTop: 10, borderTop: '1px solid #E4DFD3', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, color: '#5E6470', flexWrap: 'wrap' }}>
            <span><b style={{ color: '#0E1B2E' }}>FAJ Solutions</b> · Bringing People and Technology Together</span>
            <span>Prepared {today}</span>
          </div>
        </div>
      </div>
      )}
    </div>,
    document.body,
  );
}
