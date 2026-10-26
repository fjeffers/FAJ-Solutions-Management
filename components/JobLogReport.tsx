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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, FileText, Printer, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { expenseCategoryLabel } from '@/lib/expenses';
import { dayCalc, parseEdits, rowsFor, type SavedDay, type SheetRow } from '@/lib/field-sheet';
import type { OdoRow as Reading } from '@/lib/weekly-bill';
import { loadEvents } from '@/components/wf/ProjectOffice';
import { toastError, toastSuccess } from '@/lib/toast';
import { buildVisits, inRange, logTotals, hoursText, dayOf, jobLogName, type Punch } from '@/lib/job-log';
import { mapLink } from '@/lib/geo';
import { jobGaps } from '@/lib/job-gaps';
import { isFinished, wfJobFromOwner } from '@/lib/wf';
import { asks, parseCapture } from '@/lib/capture';
import { downloadHref, fileExt, photoDay, photoFileName } from '@/lib/job-photos';
import AddJobPhotos from '@/components/AddJobPhotos';
import type { EnrichedWorkOrder, TimeLog } from '@/lib/types';

type PhotoRow = { id: string; url: string; taken_at: string; lat: number | null; lng: number | null; contractor_name: string | null };
type ReceiptRow = { id: string; contractor_name: string | null; category: string; vendor: string | null; amount: number; expense_date: string; status: string; decline_reason: string | null; receipt_path: string | null };
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
type Include = { gaps: boolean; time: boolean; mileage: boolean; checklist: boolean; answers: boolean; notes: boolean; photos: boolean; receipts: boolean; odometer: boolean; scope: boolean; leftOut: boolean };

const TZ = 'America/New_York';
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const fmtStamp = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });

/**
 * Each job's saves still going. Kept outside the log, so a log closed and
 * opened again straight away waits for them before it reads the job.
 */
const savesFor = new Map<string, Promise<void>>();
const afterSaves = (woId: string) => savesFor.get(woId) ?? Promise.resolve();

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
  <h3 style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 15, fontWeight: 700, color: '#0E1B2E', margin: '22px 0 8px', paddingBottom: 6, borderBottom: '2px solid #C9A24B' }}>{children}</h3>
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
  const { leftOut, receiptPhotos, loaded: loadedChoices, flip, label, savedOut } = useLogChoices(w.id, w.job_log_left_out, w.job_log_receipt_photos);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Each tech's days as the Hours screen and the Field Sheet have them, for the miles
  // (Fred, 2026-10-25: "i don't see the mileages on the job logs along with the pictures").
  const [days, setDays] = useState<SheetRow[]>([]);
  // Pictures added from the office: the log reads the job's photos again, and the
  // new ones are marked New and scrolled to, as they sit under their own day
  // among the others (Fred, 2026-10-26: "when i add a photo it not saving on the job log").
  const [added, setAdded] = useState(0);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [inc, setInc] = useState<Include>({ gaps: true, time: true, mileage: true, checklist: true, answers: true, notes: true, photos: true, receipts: true, odometer: true, scope: false, leftOut: false });

  useEffect(() => {
    const db = createClient();
    void Promise.all([
      db.from('job_punches').select('contractor_name, kind, at, lat, lng, accuracy').eq('wo_id', w.id).order('at'),
      db.from('wo_photos').select('id, url, taken_at, lat, lng, contractor_name').eq('wo_id', w.id).order('taken_at'),
      fetch(`/api/wo-time-logs?wo_id=${w.id}`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      db.from('job_expenses').select('id, contractor_name, category, vendor, amount, expense_date, status, decline_reason, receipt_path').eq('wo_id', w.id).order('expense_date'),
      db.from('job_odometer').select('id, wo_id, contractor_name, at, moment, reading, ai_reading, photo_path').eq('wo_id', w.id).order('at'),
      // What's left out and labeled now: the job on screen may be older than the last change,
      // and a save from the log just closed may still be going.
      afterSaves(w.id).then(() => db.from('work_orders').select('job_log_left_out, job_log_receipt_photos').eq('id', w.id).maybeSingle()),
      loadEvents([w.id]),
      db.from('field_sheet_days').select('id, day, tech, edits, added, hidden').eq('wo_id', w.id),
    ]).then(async ([p, ph, l, ex, od, wo, ev, fs]) => {
      setPunches(((p.data as Punch[] | null) ?? []));
      setPhotos(((ph.data as PhotoRow[] | null) ?? []));
      setLogs(Array.isArray(l) ? (l as TimeLog[]) : []);
      const kept = wo.data as { job_log_left_out?: string[] | null; job_log_receipt_photos?: string[] | null } | null;
      if (kept) loadedChoices({ leftOut: new Set(kept.job_log_left_out ?? []), receiptPhotos: new Set(kept.job_log_receipt_photos ?? []) });
      // Approved and declined; one still waiting on Fred isn't either yet.
      const rec = ((ex.data as ReceiptRow[] | null) ?? []).filter((e) => (e.status === 'approved' || e.status === 'declined') && e.receipt_path);
      const readings = ((od.data as Reading[] | null) ?? []).map((o) => ({ ...o, reading: Number(o.reading), ai_reading: o.ai_reading == null ? null : Number(o.ai_reading) }));
      const saved = ((fs.data as (Omit<SavedDay, 'edits'> & { edits: unknown })[] | null) ?? []).map((d) => ({ ...d, edits: parseEdits(d.edits) }));
      const crew = (w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter((t): t is string => !!t);
      setDays(rowsFor({ events: ev, readings, saved, techs: crew, start: w.start_date, end: w.end_date, timeZone: TZ }).filter((r) => !r.hidden));
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

  const visits = useMemo(() => buildVisits(punches ?? [], logs, new Date(), TZ).filter((v) => inRange(v.day, from, to)), [punches, logs, from, to]);
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
  const totals = logTotals(visits);
  // A day's miles: the miles typed on the Hours screen, else the odometer, else the GPS.
  const mileage = days.filter((r) => inRange(r.day, from, to))
    .map((r) => ({ r, miles: dayCalc(r.values, 0).miles }))
    .filter(({ r, miles }) => miles > 0 || r.values.odoStart != null || r.values.odoEnd != null)
    .sort((a, b) => a.r.day.localeCompare(b.r.day) || a.r.tech.localeCompare(b.r.tech));
  const totalMiles = Math.round(mileage.reduce((t, m) => t + m.miles, 0) * 10) / 10;
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
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ });
  const range = from || to ? `${from ? fmtDay(from) : 'Start'} – ${to ? fmtDay(to) : 'today'}` : 'Whole job';
  // The saved PDF's name: the print window names it after the page (lib/job-log.ts
  // jobLogName). The days picked, else the job's first and last day on the Field Sheet.
  const worked = [...visits.map((v) => v.day), ...days.filter((r) => inRange(r.day, from, to)).map((r) => r.day)].sort();
  const logName = jobLogName(w, from || worked[0] || '', to || worked.at(-1) || '');
  useEffect(() => {
    const was = document.title;
    document.title = logName;
    return () => { document.title = was; };
  }, [logName]);

  const toggle = (k: keyof Include, label: string) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={inc[k]} onChange={(e) => setInc((s) => ({ ...s, [k]: e.target.checked }))} /> {label}
    </label>
  );

  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #ECE8DF', textAlign: 'left', verticalAlign: 'top' };

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
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
        <button className="wf-btn wf-btn-gold wf-btn-sm" disabled={!loaded} onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>
        <AddJobPhotos woId={w.id} woNumber={w.wo_number} techs={techs.filter((t): t is string => !!t)}
          day={photoDay(w.start_date, w.end_date, new Date().toLocaleDateString('en-CA', { timeZone: TZ }))} onAdded={(urls) => { setFresh(new Set(urls)); setAdded((n) => n + 1); }} />
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: '6px 16px', color: '#5E6470' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1B1C1F' }}>Show:</span>
          {gaps.length > 0 && toggle('gaps', 'Not completed')}{toggle('time', 'Time & GPS')}{mileage.length > 0 && toggle('mileage', 'Mileage')}{tasks.length > 0 && toggle('checklist', 'Checklist')}{toggle('answers', 'Answers')}
          {toggle('notes', "Tech's notes")}{(receipts.length > 0 || receiptPhotos.size > 0) && toggle('receipts', 'Receipts')}{odometer.length > 0 && toggle('odometer', 'Odometer')}
          {toggle('photos', 'Photos')}{toggle('scope', 'Scope of work')}{leftCount > 0 && toggle('leftOut', `Pictures left out (${leftCount})`)}
        </div>
        <div style={{ flexBasis: '100%', fontSize: 12.5, color: '#5E6470' }}>
          Tap <b style={{ color: '#B42318' }}>✗</b> on a picture to take it out of the job log: the client won’t see it, and it stays on the job. Tick “Pictures left out” to see those again, and tap <b style={{ color: '#047857' }}>✓</b> to put one back. Label a photo Receipt and it goes with the receipts. Declined receipts never print, and their ✗ takes them off the screen too. Nothing is deleted.
        </div>
      </div>

      {/* The report itself */}
      <div className="jl-page" style={{ maxWidth: 850, margin: '0 auto', background: '#fff', color: '#1B1C1F', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', fontSize: 13 }}>
        <div className="jl-band" style={{ background: 'linear-gradient(180deg, #13284A 0%, #0E1B2E 100%)', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-wide.png" alt="FAJ Solutions — Technology. Delivered." style={{ height: 54, width: 'auto' }} />
          <div style={{ textAlign: 'right', color: '#fff' }}>
            <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 1.5, color: '#E3C987' }}>JOB LOG</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{range}</div>
          </div>
        </div>

        <div style={{ padding: '20px 24px 28px' }}>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{w.title || 'Work order'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '6px 20px', marginTop: 10 }}>
            {w.customer_name && <div><b>Client:</b> {w.customer_name}</div>}
            {w.external_wo_id && <div><b>Client WO #:</b> {w.external_wo_id}</div>}
            <div><b>FAJ WO #:</b> {w.wo_number}</div>
            {(w.site_name || where) && <div><b>Site:</b> {[w.site_name, where].filter(Boolean).join(' — ')}</div>}
            {(w.scheduled_date || w.start_date) && <div><b>Scheduled:</b> {fmtDay((w.scheduled_date || w.start_date)!.slice(0, 10))}</div>}
            {techs.length > 0 && <div><b>Technician{techs.length > 1 ? 's' : ''}:</b> {techs.join(', ')}</div>}
          </div>

          <div className="jl-avoid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 16 }}>
            {[
              ...(totals.ms > 0 ? [['Time on site', hoursText(totals.ms)]] : []),
              ...(totals.days > 0 ? [['Days', String(totals.days)]] : []),
              ...(totalMiles > 0 ? [['Miles', totalMiles.toLocaleString('en-US')]] : []),
              ...(pictureCount > 0 ? [['Pictures', String(pictureCount)]] : []),
              ...(tasks.length ? [['Checklist', `${tasks.filter((t) => t.completed).length} of ${tasks.length}`]] : []),
              ...(qa.length ? [['Questions', `${qa.filter((q) => (q.answer ?? '').trim()).length} of ${qa.length}`]] : []),
            ].map(([label, value]) => (
              <div key={label} style={{ border: '1px solid #E4DFD3', borderRadius: 10, padding: '8px 10px' }}>
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

          {inc.time && (punches === null || visits.length > 0) && (
            <>
              <H>Time on site</H>
              {punches === null ? <div style={{ color: '#5E6470' }}>Loading…</div>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ background: '#F6F4EF' }}>
                      {['Date', 'Technician', 'In', 'Out', 'Hours', 'Location (GPS)'].map((h) => <th key={h} style={{ ...cell, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {visits.map((v, i) => (
                        <tr key={i} className="jl-avoid">
                          <td style={cell}>{fmtDay(v.day)}</td>
                          <td style={cell}>{v.tech}</td>
                          <td style={cell}>{fmtTime(v.inAt)}</td>
                          <td style={cell}>{v.outAt ? fmtTime(v.outAt) : v.open ? 'On site now' : '—'}</td>
                          <td style={cell}>{hoursText(v.ms)}</td>
                          <td style={{ ...cell, fontSize: 12 }}>
                            {v.inGps ? <a href={mapLink(v.inGps.lat, v.inGps.lng)} target="_blank" rel="noopener noreferrer" style={{ color: '#0E1B2E' }}>{v.inGps.lat.toFixed(5)}, {v.inGps.lng.toFixed(5)}</a> : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </>
          )}

          {inc.mileage && mileage.length > 0 && (
            <>
              <H>Mileage</H>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#F6F4EF' }}>
                  {['Date', 'Technician', 'Odometer start', 'Odometer end', 'Miles'].map((h) => <th key={h} style={{ ...cell, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {mileage.map(({ r, miles }) => (
                    <tr key={r.key} className="jl-avoid">
                      <td style={cell}>{fmtDay(r.day)}</td>
                      <td style={cell}>{r.tech}</td>
                      <td style={cell}>{r.values.odoStart != null ? r.values.odoStart.toLocaleString('en-US') : '—'}</td>
                      <td style={cell}>{r.values.odoEnd != null ? r.values.odoEnd.toLocaleString('en-US') : '—'}</td>
                      <td style={cell}>{miles.toLocaleString('en-US')}</td>
                    </tr>
                  ))}
                  <tr><td style={{ ...cell, fontWeight: 700 }} colSpan={4}>Total</td><td style={{ ...cell, fontWeight: 700 }}>{totalMiles.toLocaleString('en-US')}</td></tr>
                </tbody>
              </table>
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

          {inc.receipts && pictures('Receipts', shownReceipts, true)}
          {inc.odometer && pictures('Odometer', shownOdometer)}
          {inc.photos && pictures('Photos', shownPhotos)}

          <div style={{ marginTop: 28, paddingTop: 10, borderTop: '1px solid #E4DFD3', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, color: '#5E6470', flexWrap: 'wrap' }}>
            <span><b style={{ color: '#0E1B2E' }}>FAJ Solutions</b> · Bringing People and Technology Together</span>
            <span>Prepared {today}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
