'use client';
// Projects in the office (Fred, 2026-10-13). Migration 117.
//   ProjectDayCard     on a project job's page: each tech's day — travel legs
//                      with miles (Fred can correct a mile figure), time on
//                      site with lunch taken out — and Add receipt for the
//                      hotels and meals the office paid itself.
//   ProjectReport      the whole project (every site with the same project
//                      name) for a week or any dates, to print or save as a
//                      PDF and attach to the invoice: time on site, travel and
//                      miles, receipts with their photos, what each site
//                      delivered, the sign-off or why there isn't one, and the
//                      job photos. Never any tech pay or margin.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Car, FileSpreadsheet, FileText, Image as ImageIcon, MapPin, Plus, Printer, Receipt, Sparkles, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLiveRows } from '@/components/wf/useLive';
import {
  buildDayLogs, dayOf, hoursOf, legLabel, parseDayEvents, totalsOf, type DayEvent, type DayLog,
} from '@/lib/project-day';
import { parseCloseout, parseCloseoutLists, listFor, skipReason, type CloseoutList } from '@/lib/closeout';
import { EXPENSE_CATEGORIES, expenseCategoryLabel, expenseReasonText, parseExpenseAmount } from '@/lib/expenses';
import { inRange } from '@/lib/job-log';
import { formatDuration, isFinished, wfJobFromOwner } from '@/lib/wf';
import { jobGaps } from '@/lib/job-gaps';
import { fmtMoney } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import type { EnrichedWorkOrder } from '@/lib/types';
import { Dialog, Section } from './WfUi';
import { PushSwitch } from './PushSwitch';
import { mailtoHref, sheetInvite, smsHref } from '@/lib/send-sheet';
import { asks, parseCapture } from '@/lib/capture';
import { askedDeliverables } from '@/lib/wf';
import { aiFailureText } from '@/lib/wo-ai';
import { downloadXLSXBook } from '@/lib/export';
import { billJpeg } from '@/lib/bill-image';
import {
  billReadings, matchOdometer, odoProblems, sheetName, siteBill, siteSheetRows, summaryFacts, totalsSheetRows,
  type BillDay, type BillLeg, type BillSite, type OdoProblem, type OdoRow, type SiteBill,
} from '@/lib/weekly-bill';

const TZ = 'America/New_York';
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtDayLong = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Tell the Expenses card to reload after the office adds or removes a receipt. */
export const EXPENSES_CHANGED = 'faj:expenses-changed';

type EventRow = { id?: string; contractor_name: string; kind: string; at: string; origin?: string | null; dest?: string | null; miles?: number | null; wo_id?: string };

/** Every tech's taps on these jobs: travel and lunch (job_day_events) and the clock (job_punches). */
async function loadEvents(woIds: string[]): Promise<(DayEvent & { woId: string })[]> {
  if (woIds.length === 0) return [];
  const db = createClient();
  const [d, p] = await Promise.all([
    db.from('job_day_events').select('id, wo_id, contractor_name, kind, at, origin, dest, miles').in('wo_id', woIds).order('at'),
    db.from('job_punches').select('wo_id, contractor_name, kind, at').in('wo_id', woIds).order('at'),
  ]);
  const rows = [...((d.data as EventRow[] | null) ?? []), ...((p.data as EventRow[] | null) ?? [])];
  const out: (DayEvent & { woId: string })[] = [];
  for (const r of rows) {
    const [ev] = parseDayEvents([r]);
    if (ev) out.push({ ...ev, woId: String(r.wo_id ?? '') });
  }
  return out;
}

// ── On the job page ─────────────────────────────────────────────────────────

export function ProjectDayCard({ w, lists }: { w: EnrichedWorkOrder; lists: CloseoutList[] }) {
  const [events, setEvents] = useState<DayEvent[] | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const load = useCallback(async () => { setEvents(await loadEvents([w.id])); }, [w.id]);
  useEffect(() => { void load(); }, [load]);
  useLiveRows('job_day_events', w.id, () => void load());
  useLiveRows('job_punches', w.id, () => void load());
  // The tech's odometer photos on each drive (Fred, 2026-10-18: "The milage needs to reflect on the back end").
  const odo = useOdometer(w.id);
  const logs = useMemo(() => buildDayLogs(events ?? [], new Date(), TZ), [events]);
  const t = totalsOf(logs);
  const capture = parseCapture(w.capture);
  const showOdo = odo.readings.length > 0 || (capture !== null && asks(capture, 'odometer'));
  const legs = useMemo(() => matchOdometer(logs.flatMap((d) => d.legs), odo.readings), [logs, odo.readings]);
  const problems = useMemo(() => odoProblems(legs), [legs]);
  // A reading no drive took (a photo with no drive around it) still shows, under its day.
  const loose = useMemo(() => {
    const used = new Set(legs.flatMap((l) => [l.odoStart, l.odoEnd]));
    return odo.readings.filter((o) => !used.has(o));
  }, [legs, odo.readings]);

  return (
    <Section
      title={w.is_project ? 'Project day' : 'Travel and time'}
      subtitle={w.project_name ? `${w.project_name} · from the techs' phones` : "From the techs' phones"}
      right={<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setReceiptOpen(true)}><Plus size={15} /> Add receipt</button>
        {/* The weekly bill for the client, on every job (Fred, 2026-10-18: "printed and exportable to send to clients"). */}
        <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => setReportOpen(true)}><FileText size={15} /> Weekly bill</button>
      </div>}
    >
      {events === null ? <div className="wf-subtle">Loading…</div>
        : logs.length === 0 ? (
          <div className="wf-subtle" style={{ fontSize: 13 }}>
            Nothing yet. When a tech taps Clock in, Start travel, Start job, Lunch and Off site on this {w.is_project ? 'site' : 'job'}, each day shows here with every drive and its miles.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 12 }}>
              {[['Days', String(t.days)], ['On site', formatDuration(t.onSiteMs)], ['Travel', formatDuration(t.travelMs)], ['Miles', String(t.miles)]].map(([k, v]) => (
                <div key={k} className="wf-card" style={{ padding: '8px 10px' }}>
                  <div className="wf-label">{k}</div>
                  <div className="wf-display" style={{ fontWeight: 700, fontSize: 18 }}>{v}</div>
                </div>
              ))}
            </div>
            {logs.map((d) => (
              <DayBlock key={`${d.day}|${d.tech}`} d={d} onChanged={load}
                odo={showOdo ? {
                  legs: legs.filter((l) => l.tech === d.tech && l.day === d.day), problems, urls: odo.urls,
                  loose: loose.filter((o) => o.contractor_name === d.tech && dayOf(o.at, TZ) === d.day),
                } : null} />
            ))}
          </>
        )}
      {receiptOpen && (
        <OfficeReceiptDialog woId={w.id} onClose={() => setReceiptOpen(false)}
          onSaved={() => { setReceiptOpen(false); window.dispatchEvent(new Event(EXPENSES_CHANGED)); }} />
      )}
      {reportOpen && <ProjectReport projectName={w.is_project ? w.project_name ?? '' : ''} startWoId={w.id} lists={lists} onClose={() => setReportOpen(false)} />}
    </Section>
  );
}

type DayOdo = { legs: BillLeg[]; problems: Map<BillLeg, OdoProblem[]>; urls: Record<string, string>; loose: OdoRow[] };

/** Every odometer reading on the job, with a link to each photo. Reloads as the tech adds one. */
function useOdometer(woId: string) {
  const [readings, setReadings] = useState<OdoRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const db = createClient();
    const { data, error } = await db.from('job_odometer')
      .select('id, wo_id, contractor_name, at, moment, reading, ai_reading, photo_path').eq('wo_id', woId).order('at');
    if (error) return;
    const rows = ((data as OdoRow[] | null) ?? []).map((o) => ({ ...o, reading: Number(o.reading), ai_reading: o.ai_reading == null ? null : Number(o.ai_reading) }));
    setReadings(rows);
    const paths = rows.map((o) => o.photo_path).filter((x): x is string => !!x);
    if (paths.length) {
      const { data: signed } = await db.storage.from('job-receipts').createSignedUrls(paths, 60 * 60);
      const m: Record<string, string> = {};
      for (const x of signed ?? []) if (x.path && x.signedUrl) m[x.path] = x.signedUrl;
      setUrls(m);
    }
  }, [woId]);
  useEffect(() => { void load(); }, [load]);
  useLiveRows('job_odometer', woId, () => void load());
  return { readings, urls };
}

const odoNum = (n: number) => n.toLocaleString('en-US');

/** One odometer reading: the number, and its photo as a small picture that opens full size. */
function OdoShot({ o, urls, label }: { o: OdoRow | null; urls: Record<string, string>; label: string }) {
  if (!o) return <span className="wf-subtle">{label}: no photo</span>;
  const url = o.photo_path ? urls[o.photo_path] : undefined;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" title={`Open the ${label.toLowerCase()} photo`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`${label} odometer ${odoNum(o.reading)}`} style={{ width: 44, height: 33, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--wf-line)', display: 'block' }} />
        </a>
      )}
      <span>
        {label} <b>{odoNum(o.reading)}</b>
        {o.ai_reading != null && Math.abs(o.ai_reading - o.reading) > 1 ? <span className="wf-subtle"> (photo reads {odoNum(o.ai_reading)})</span> : null}
      </span>
    </span>
  );
}

/** Under a drive: the odometer at the start and the end, the miles between, and anything that can't be right. */
function OdoLine({ l, problems, urls }: { l: BillLeg; problems: OdoProblem[]; urls: Record<string, string> }) {
  return (
    <div style={{ margin: '2px 0 6px 22px', fontSize: 12.5 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <OdoShot o={l.odoStart} urls={urls} label="Start" />
        {(l.end || l.odoEnd) && <OdoShot o={l.odoEnd} urls={urls} label="End" />}
        {l.odoMiles != null && !problems.length && <span className="wf-chip">{odoNum(l.odoMiles)} mi by odometer</span>}
      </div>
      {problems.map((p) => (
        <div key={p.kind} style={{ color: '#B42318', marginTop: 2 }}>Check: {p.text}</div>
      ))}
    </div>
  );
}

function DayBlock({ d, onChanged, odo }: { d: DayLog; onChanged: () => void; odo: DayOdo | null }) {
  return (
    <div style={{ borderTop: '1px solid var(--wf-line)', padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b>{fmtDay(d.day)}</b><span className="wf-subtle">{d.tech}</span>
        <span className="wf-subtle" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
          On site {formatDuration(d.onSiteMs)} · travel {formatDuration(d.travelMs)} · {d.miles} mi
        </span>
      </div>
      {(d.clockIn || d.signOut) && (
        <div className="wf-subtle" style={{ fontSize: 12.5, marginBottom: 2 }}>
          {d.clockIn ? `Clocked in ${timeOf(d.clockIn)}` : 'No clock-in'}
          {d.signOut ? ` · signed out ${timeOf(d.signOut)}` : ''}
          {d.clockIn && d.signOut ? ` (${formatDuration(Date.parse(d.signOut) - Date.parse(d.clockIn))} day)` : ''}
        </div>
      )}
      {[
        ...d.legs.map((l) => {
          const withOdo = odo?.legs.find((x) => x.start === l.start);
          return { at: l.start, el: (
            <div key={`l${l.start}`}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
                <Car size={14} color="var(--wf-subtle)" />
                <span>{legLabel(l)} · {timeOf(l.start)}–{l.end ? timeOf(l.end) : 'driving now'} · {formatDuration(l.ms)}</span>
                <MilesEdit id={l.endId} miles={l.miles} onSaved={onChanged} />
              </div>
              {odo && withOdo && <OdoLine l={withOdo} problems={odo.problems.get(withOdo) ?? []} urls={odo.urls} />}
            </div>
          ) };
        }),
        ...(odo?.loose ?? []).map((o) => ({ at: o.at, el: (
          <div key={`o${o.id ?? o.at}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, flexWrap: 'wrap', marginLeft: 22 }}>
            <OdoShot o={o} urls={odo?.urls ?? {}} label={`Odometer at ${timeOf(o.at)}, not on a drive:`} />
          </div>
        ) })),
        ...d.spans.map((s) => ({ at: s.in, el: (
          <div key={`s${s.in}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <MapPin size={14} color="var(--wf-subtle)" />
            <span>On site · {timeOf(s.in)}–{s.out ? timeOf(s.out) : 'on site now'} · {formatDuration(s.ms)}{s.lunchMs ? ` (lunch ${formatDuration(s.lunchMs)})` : ''}</span>
          </div>
        ) })),
      ].sort((a, b) => a.at.localeCompare(b.at)).map((x) => x.el)}
    </div>
  );
}

/** The miles on a leg; Fred can correct them (the GPS figure is a straight line x 1.2). */
function MilesEdit({ id, miles, onSaved }: { id: string | null; miles: number | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(miles != null ? String(miles) : '');
  if (!id) return miles != null ? <span className="wf-chip">{miles} mi</span> : <span className="wf-subtle" style={{ fontSize: 12 }}>no miles</span>;
  if (!editing) {
    return (
      <button className="wf-chip" style={{ border: '1px solid var(--wf-line)', background: 'var(--wf-card)', cursor: 'pointer', font: 'inherit', fontSize: 12.5 }}
        onClick={() => setEditing(true)} title="Correct the miles">
        {miles != null ? `${miles} mi` : 'Add miles'}
      </button>
    );
  }
  const save = async () => {
    const n = val.trim() === '' ? null : Number(val);
    if (n != null && (!Number.isFinite(n) || n < 0 || n >= 3000)) { toastError('Miles must be a number under 3000.'); return; }
    const { error } = await createClient().from('job_day_events')
      .update({ miles: n == null ? null : Math.round(n * 10) / 10, miles_from_gps: false }).eq('id', id);
    if (error) { toastError("Couldn't save the miles."); return; }
    setEditing(false);
    toastSuccess('Miles saved.');
    onSaved();
  };
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input className="wf-input" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} autoFocus
        style={{ width: 80, minHeight: 32, padding: '2px 8px' }} aria-label="Miles" />
      <button className="wf-btn wf-btn-navy wf-btn-sm" onClick={() => void save()}>Save</button>
      <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setEditing(false)}>Cancel</button>
    </span>
  );
}

const todayNY = () => dayOf(new Date().toISOString(), TZ);

function OfficeReceiptDialog({ woId, onClose, onSaved }: { woId: string; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState('hotel');
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayNY);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const amt = parseExpenseAmount(amount);
  const save = async () => {
    if (amt == null) { toastError(expenseReasonText('bad_amount')); return; }
    setBusy(true);
    const fd = new FormData();
    fd.append('wo_id', woId); fd.append('category', category); fd.append('vendor', vendor);
    fd.append('amount', String(amt)); fd.append('date', date); fd.append('note', note);
    if (file) fd.append('file', file);
    try {
      const res = await fetch('/api/owner/expense', { method: 'POST', body: fd });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) { toastError(j.error ?? "Couldn't save the receipt."); return; }
      toastSuccess(`${fmtMoney(amt)} ${expenseCategoryLabel(category).toLowerCase()} receipt added.`);
      onSaved();
    } catch {
      toastError("Couldn't save the receipt. Check your connection.");
    } finally {
      setBusy(false);
    }
  };
  const label = (t: string) => <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>{t}</span>;
  return (
    <Dialog title="Add a receipt" onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={busy || amt == null} onClick={() => void save()}>
          <Receipt size={16} /> {busy ? 'Saving…' : 'Save receipt'}
        </button>
      </>}>
      <div className="wf-subtle" style={{ fontSize: 12.5, marginBottom: 10 }}>
        A receipt FAJ paid itself (a hotel on the company card). It goes on the client report; no tech is paid back for it.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label>{label('What for')}
          <select className="wf-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label>{label('Amount')}<input className="wf-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$0.00" /></label>
        <label>{label('Store / hotel')}<input className="wf-input" value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={120} placeholder="Hampton Inn" /></label>
        <label>{label('Date')}<input className="wf-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <label style={{ display: 'block', marginTop: 10 }}>{label('Note (optional)')}
        <input className="wf-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="2 nights, 2 rooms" />
      </label>
      <label style={{ display: 'block', marginTop: 10 }}>{label('Receipt photo or PDF (optional)')}
        <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
    </Dialog>
  );
}

// ── The client report ───────────────────────────────────────────────────────

type ReportWo = Pick<EnrichedWorkOrder,
  'id' | 'wo_number' | 'title' | 'description' | 'site_name' | 'site_address' | 'site_city' | 'site_state' | 'site_zip'
  | 'customer_name' | 'external_wo_id' | 'closeout_notes' | 'scheduled_date' | 'start_date' | 'signature_required'
  | 'wo_status' | 'archived_at' | 'wo_tasks' | 'custom_qa' | 'photo_required'> & { closeout: unknown; capture?: unknown };
type ReportExpense = {
  id: string; wo_id: string; contractor_name: string | null; category: string; vendor: string | null; amount: number; expense_date: string; note: string | null; receipt_path: string | null; status: string;
  /** Migration 128. */
  gallons?: number | null; ai?: unknown;
};

/** The day table's columns: only what the site's jobs ask for (lib/capture.ts). */
function dayColumns(s: SiteBill['shows'], t: SiteBill['totals']): { h: string; v: (d: BillDay) => React.ReactNode; total: React.ReactNode }[] {
  const at = (iso: string | null, none = '—') => (iso ? timeOf(iso) : none);
  return [
    { h: 'Date', v: (d) => fmtDay(d.day), total: 'Site total' },
    { h: 'Technician', v: (d) => d.tech, total: '' },
    ...(s.travel ? [{ h: 'Left', v: (d: BillDay) => (d.left ? `${timeOf(d.left)}${d.from === 'hotel' ? ' (hotel)' : d.from === 'home' ? ' (home)' : ''}` : '—'), total: '' }] : []),
    { h: 'On site', v: (d) => at(d.arrived), total: '' },
    { h: 'Off site', v: (d) => at(d.leftSite, d.arrived ? 'still on site' : '—'), total: '' },
    ...(s.travel ? [{ h: 'Back', v: (d: BillDay) => at(d.back), total: '' }] : []),
    { h: 'Hours on site', v: (d) => d.onSiteHours, total: t.onSiteHours },
    ...(s.travel ? [
      { h: 'Travel hours', v: (d: BillDay) => d.travelHours, total: t.travelHours },
      { h: 'Miles (GPS)', v: (d: BillDay) => d.gpsMiles, total: t.gpsMiles },
    ] : []),
    ...(s.odometer ? [{ h: 'Odometer miles', v: (d: BillDay) => d.odoMiles ?? '—', total: t.odoMiles ?? '—' }] : []),
    ...(s.receipts ? [{ h: 'Receipts', v: (d: BillDay) => (d.receipts ? fmtMoney(d.receipts) : '—'), total: fmtMoney(t.receipts) }] : []),
  ];
}

/** Save a file the browser made. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
/** The summary as the client sees it: the AI's "For the office:" line stays on screen. */
const clientSummary = (text: string) => text.split('\n').map((l) => l.replace(/\s*for the office:.*$/i, '')).filter((l) => l.trim()).join('\n').trim();
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Weekly bill';
type ReportPhoto = { id: string; wo_id: string; url: string; taken_at: string; contractor_name: string | null };

/** Monday of this week (New York), as YYYY-MM-DD. */
function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function ProjectReport({ projectName, startWoId, lists, onClose }: {
  projectName: string; startWoId: string; lists: CloseoutList[]; onClose: () => void;
}) {
  const [wos, setWos] = useState<ReportWo[] | null>(null);
  const [events, setEvents] = useState<(DayEvent & { woId: string })[]>([]);
  const [expenses, setExpenses] = useState<ReportExpense[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(() => mondayOf(todayNY()));
  const [to, setTo] = useState(todayNY);
  const [showPhotos, setShowPhotos] = useState(true);
  // Odometer readings (migration 128), and the AI's summary Fred can edit before printing.
  const [odo, setOdo] = useState<OdoRow[]>([]);
  // null: no summary box yet.
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  useEffect(() => {
    const db = createClient();
    void (async () => {
      const cols = 'id, wo_number, title, description, site_name, site_address, site_city, site_state, site_zip, customer_name, external_wo_id, closeout_notes, scheduled_date, start_date, signature_required, closeout, wo_status, archived_at, wo_tasks, custom_qa, photo_required';
      // The whole project: every project site with this name. A job with no
      // project name reports on its own.
      const pick = (c: string) => (projectName.trim()
        ? db.from('work_orders').select(c).eq('is_project', true).eq('project_name', projectName)
        : db.from('work_orders').select(c).eq('id', startWoId)).order('scheduled_date', { ascending: true, nullsFirst: false });
      // What each job asks the tech for (migration 128); before it, every job asks for everything.
      let res = await pick(`${cols}, capture`);
      if (res.error) res = await pick(cols);
      const list = ((res.data as unknown as ReportWo[] | null) ?? []);
      setWos(list);
      const ids = list.map((x) => x.id);
      if (ids.length === 0) return;
      const exCols = 'id, wo_id, contractor_name, category, vendor, amount, expense_date, note, receipt_path, status';
      const expensesOf = (c: string) => db.from('job_expenses').select(c).in('wo_id', ids).order('expense_date');
      const [ev, ex, ph, od] = await Promise.all([
        loadEvents(ids),
        expensesOf(`${exCols}, gallons, ai`).then((r) => (r.error ? expensesOf(exCols) : r)),
        db.from('wo_photos').select('id, wo_id, url, taken_at, contractor_name').in('wo_id', ids).order('taken_at'),
        db.from('job_odometer').select('id, wo_id, contractor_name, at, moment, reading, ai_reading, photo_path').in('wo_id', ids).order('at'),
      ]);
      setEvents(ev);
      const readings = ((od.data as OdoRow[] | null) ?? []).map((o) => ({ ...o, reading: Number(o.reading), ai_reading: o.ai_reading == null ? null : Number(o.ai_reading) }));
      setOdo(readings);
      const all = ((ex.data as unknown as ReportExpense[] | null) ?? []);
      setExpenses(all.filter((e) => e.status === 'approved'));
      setWaiting(all.filter((e) => e.status === 'submitted').length);
      setPhotos(((ph.data as ReportPhoto[] | null) ?? []));
      const paths = [...all.map((e) => e.receipt_path), ...readings.map((o) => o.photo_path)].filter((p): p is string => !!p);
      if (paths.length) {
        const { data: signed } = await db.storage.from('job-receipts').createSignedUrls(paths, 60 * 60);
        const m: Record<string, string> = {};
        for (const s of signed ?? []) if (s.path && s.signedUrl) m[s.path] = s.signedUrl;
        setUrls(m);
      }
    })();
  }, [projectName, startWoId]);

  // Printing shows only the report (app/wf.css, body.job-log-open), the same as the job log.
  useEffect(() => {
    document.body.classList.add('job-log-open');
    return () => document.body.classList.remove('job-log-open');
  }, []);

  const now = useMemo(() => new Date(), []);
  const perSite = useMemo(() => (wos ?? []).map((wo) => {
    const logs = buildDayLogs(events.filter((e) => e.woId === wo.id), now, TZ).filter((d) => inRange(d.day, from, to));
    const receipts = expenses.filter((e) => e.wo_id === wo.id && inRange(e.expense_date, from, to));
    const readings = odo.filter((o) => o.wo_id === wo.id && inRange(dayOf(o.at, TZ), from, to));
    return {
      wo, logs, totals: totalsOf(logs), receipts, readings,
      // The weekly bill for this site (lib/weekly-bill.ts): days, drives, odometer, receipts, what to check.
      // Every reading on the job goes in, so an overnight drive at the end of the dates keeps its end reading.
      bill: siteBill({ woId: wo.id, capture: parseCapture(wo.capture), logs, readings: billReadings(odo, wo.id), receipts, today: todayNY() }),
      photos: photos.filter((p) => p.wo_id === wo.id && inRange(dayOf(p.taken_at, TZ), from, to)),
    };
  }), [wos, events, expenses, odo, photos, from, to, now]);
  const shown = perSite.filter((s) => s.logs.length > 0 || s.receipts.length > 0 || s.photos.length > 0);
  const all = totalsOf(shown.flatMap((s) => s.logs));
  const receipts = shown.flatMap((s) => s.receipts.map((r) => ({ ...r, wo: s.wo })));
  const byCat = EXPENSE_CATEGORIES.map((c) => ({ c, sum: receipts.filter((r) => r.category === c.key).reduce((t, r) => t + Number(r.amount), 0) })).filter((x) => x.sum > 0);
  const receiptTotal = receipts.reduce((t, r) => t + Number(r.amount), 0);
  const client = (wos ?? []).find((x) => x.customer_name)?.customer_name ?? '';
  const range = `${fmtDayLong(from)} – ${fmtDayLong(to)}`;
  const where = (wo: ReportWo) => [wo.site_address, [wo.site_city, [wo.site_state, wo.site_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const anyOdometer = shown.some((s) => s.bill.shows.odometer);
  // The bill's own hours: a drive or a day left open on a past day isn't counted (lib/weekly-bill.ts).
  const sumOf = (f: (b: SiteBill) => number) => Math.round(shown.reduce((t, s) => t + f(s.bill), 0) * 100) / 100;
  const odoTotal = Math.round(shown.reduce((t, s) => t + (s.bill.totals.odoMiles ?? 0), 0) * 10) / 10;
  const title = projectName || (wos?.[0]?.title ?? 'Project');
  const billSites: BillSite[] = shown.map(({ wo, bill }) => ({
    name: wo.site_name || wo.title || 'Site', wo: wo.wo_number, clientWo: wo.external_wo_id, address: where(wo), bill,
  }));
  const fileBase = fileSafe(`${title} ${from} to ${to}`);

  // Excel: a totals sheet, then each site on its own sheet (Fred, 2026-10-18: "make sure they two site are separated").
  const excel = async () => {
    const taken = new Set<string>(['totals']);
    await downloadXLSXBook(`${fileBase}.xlsx`, [
      { name: 'Totals', rows: totalsSheetRows(title, client, range, billSites), colWidths: [32, 10, 8, 14, 13, 11, 15, 12] },
      ...billSites.map((x) => ({ name: sheetName(`${x.wo} ${x.name}`, taken), rows: siteSheetRows(x, range), colWidths: [12, 18, 12, 11, 14, 11, 11, 13, 12, 11, 15, 12] })),
    ]);
  };
  const jpeg = async (x: BillSite) => {
    try {
      saveBlob(await billJpeg(x, { project: title, client, range }), `${fileSafe(`${x.name} WO ${x.wo} ${from} to ${to}`)}.jpg`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't make the image.");
    }
  };
  const writeSummary = async () => {
    setSummaryBusy(true);
    try {
      const res = await fetch('/api/ai/weekly-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts: summaryFacts(title, range, billSites) }),
      });
      const json = (await res.json().catch(() => ({}))) as { text?: string; why?: string };
      if (json.text) setSummary(json.text);
      else {
        toastError(aiFailureText(json.why, ' Write the summary yourself in the box.'));
        setSummary((s) => s ?? '');
      }
    } catch {
      toastError('The AI needs signal. Try again in a moment.');
      setSummary((s) => s ?? '');
    }
    setSummaryBusy(false);
  };

  const H = ({ children }: { children: React.ReactNode }) => (
    <h3 style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 15, fontWeight: 700, color: '#0E1B2E', margin: '22px 0 8px', paddingBottom: 6, borderBottom: '2px solid #C9A24B' }}>{children}</h3>
  );
  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #ECE8DF', textAlign: 'left', verticalAlign: 'top' };
  const th = (h: string) => <th key={h} style={{ ...cell, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>;

  return createPortal(
    <div id="job-log-root" className="wf" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(2,4,9,0.55)', overflowY: 'auto', padding: '16px 12px 40px' }}>
      <div className="no-print" style={{ maxWidth: 850, margin: '0 auto 12px', background: '#F6F4EF', borderRadius: 14, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 16, flex: '1 1 160px' }}>Weekly bill · {projectName || 'this site'}</div>
        <label style={{ fontSize: 13 }}>From <input type="date" className="wf-input" style={{ width: 150, minHeight: 36, padding: '4px 8px' }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 13 }}>To <input type="date" className="wf-input" style={{ width: 150, minHeight: 36, padding: '4px 8px' }} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={showPhotos} onChange={(e) => setShowPhotos(e.target.checked)} /> Job photos
        </label>
        <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>
        <button className="wf-btn wf-btn-outline wf-btn-sm" disabled={!wos || shown.length === 0} onClick={() => void excel()}><FileSpreadsheet size={16} /> Excel</button>
        <button className="wf-btn wf-btn-outline wf-btn-sm" disabled={!wos || shown.length === 0 || summaryBusy} onClick={() => void writeSummary()}>
          <Sparkles size={16} /> {summaryBusy ? 'Writing…' : summary ? 'Write the summary again' : 'Write summary with AI'}
        </button>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        {waiting > 0 && (
          <div style={{ flexBasis: '100%', fontSize: 12.5, color: '#B45309' }}>
            {waiting} receipt{waiting === 1 ? ' is' : 's are'} still waiting for your approval and {waiting === 1 ? 'is' : 'are'} not on this report.
          </div>
        )}
      </div>

      <div className="jl-page" style={{ maxWidth: 850, margin: '0 auto', background: '#fff', color: '#1B1C1F', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', fontSize: 13 }}>
        <div className="jl-band" style={{ background: 'linear-gradient(180deg, #13284A 0%, #0E1B2E 100%)', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-wide.png" alt="FAJ Solutions — Technology. Delivered." style={{ height: 54, width: 'auto' }} />
          <div style={{ textAlign: 'right', color: '#fff' }}>
            <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 1.5, color: '#E3C987' }}>WEEKLY BILL</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{range}</div>
          </div>
        </div>

        <div style={{ padding: '20px 24px 28px' }}>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{title}</div>
          {client && <div style={{ marginTop: 4 }}><b>Client:</b> {client}</div>}
          {summary !== null && (
            <div style={{ marginTop: 12 }}>
              <label className="no-print" style={{ display: 'block', fontSize: 12, color: '#5E6470', marginBottom: 4 }}>
                Summary for the client{summary ? ' (written by AI from the numbers below; edit it before you print or send. A line starting “For the office:” is left off the printout.)' : ''}
                <textarea className="wf-input" rows={Math.min(10, 3 + Math.ceil(summary.length / 110))} value={summary}
                  onChange={(e) => setSummary(e.target.value)} style={{ marginTop: 4, width: '100%', fontSize: 13 }} />
              </label>
              {clientSummary(summary) && <div className="jl-print-only jl-avoid" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{clientSummary(summary)}</div>}
            </div>
          )}

          {wos === null ? <div style={{ color: '#5E6470', marginTop: 14 }}>Loading…</div> : (
            <>
              <div className="jl-avoid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 16 }}>
                {[
                  ['Sites', String(shown.length)],
                  ['Days', String(all.days)],
                  ['Hours on site', String(sumOf((b) => b.totals.onSiteHours))],
                  ['Travel hours', String(sumOf((b) => b.totals.travelHours))],
                  ['Miles (GPS)', String(all.miles)],
                  ...(anyOdometer ? [['Odometer miles', String(odoTotal)]] : []),
                  ['Receipts', fmtMoney(receiptTotal)],
                ].map(([label, value]) => (
                  <div key={label} style={{ border: '1px solid #E4DFD3', borderRadius: 10, padding: '8px 10px' }}>
                    <div style={{ fontSize: 11, color: '#5E6470', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
                    <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 18, fontWeight: 700 }}>{value}</div>
                  </div>
                ))}
              </div>
              {shown.length === 0 && <div style={{ color: '#5E6470', marginTop: 14 }}>Nothing recorded in these dates.</div>}

              {shown.map(({ wo, bill, readings, receipts: siteReceipts, photos: sitePhotos }) => {
                const c = parseCloseout(wo.closeout);
                // A finished site lists everything the tech left undone (lib/job-gaps.ts), only what the job asked for.
                const job = wfJobFromOwner(wo);
                const items = askedDeliverables(job, listFor(lists, wo.title ?? '', wo.description ?? '').items);
                const cant = items.filter((i) => skipReason(c, i));
                const gaps = isFinished(job) ? jobGaps(job, items, photos.filter((p) => p.wo_id === wo.id).length) : null;
                const site = billSites.find((x) => x.bill.woId === wo.id)!;
                const cols = dayColumns(bill.shows, bill.totals);
                const odoShots = readings.filter((o) => o.photo_path && urls[o.photo_path]);
                return (
                  <div key={wo.id}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                      <div style={{ flex: 1 }}><H>{site.name} · WO {wo.wo_number}{wo.external_wo_id ? ` · Client # ${wo.external_wo_id}` : ''}</H></div>
                      <button className="wf-btn wf-btn-ghost wf-btn-sm no-print" style={{ marginBottom: 8 }} onClick={() => void jpeg(site)}
                        aria-label={`Save ${site.name} as a JPEG`}><ImageIcon size={15} /> JPEG</button>
                    </div>
                    {site.address && <div style={{ color: '#5E6470', marginBottom: 6 }}>{site.address}</div>}
                    {bill.flags.length > 0 && (
                      <div className="no-print" role="note" style={{ border: '1px solid #F2C94C', background: '#FFF8E1', borderRadius: 10, padding: '8px 12px', margin: '6px 0 10px' }}>
                        <div style={{ fontWeight: 700, color: '#8A5A00' }}>To check before sending · only you see this</div>
                        {bill.flags.map((f) => <div key={f.text} style={{ fontSize: 12.5 }}>• {f.text}</div>)}
                      </div>
                    )}
                    {bill.days.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ background: '#F6F4EF' }}>{cols.map((k) => th(k.h))}</tr></thead>
                        <tbody>
                          {bill.days.map((d) => (
                            <tr key={d.day + d.tech} className="jl-avoid">{cols.map((k) => <td key={k.h} style={cell}>{k.v(d)}</td>)}</tr>
                          ))}
                          <tr style={{ fontWeight: 700 }}>{cols.map((k) => <td key={k.h} style={cell}>{k.total}</td>)}</tr>
                        </tbody>
                      </table>
                    )}
                    {bill.shows.travel && bill.legs.length > 0 && (
                      <>
                        <div style={{ fontWeight: 600, margin: '12px 0 4px' }}>Drives</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead><tr style={{ background: '#F6F4EF' }}>
                            {['Date', 'Technician', 'Drive', 'Started', 'Ended', 'Hours', 'Miles (GPS)', ...(bill.shows.odometer ? ['Odometer', 'Odometer miles'] : [])].map(th)}
                          </tr></thead>
                          <tbody>
                            {bill.legs.map((l) => (
                              <tr key={l.tech + l.start} className="jl-avoid">
                                <td style={cell}>{fmtDay(l.day)}</td><td style={cell}>{l.tech}</td><td style={cell}>{legLabel(l)}</td>
                                <td style={cell}>{timeOf(l.start)}</td><td style={cell}>{l.end ? timeOf(l.end) : '—'}</td>
                                <td style={cell}>{l.end ? hoursOf(l.ms) : '—'}</td><td style={cell}>{l.miles ?? '—'}</td>
                                {bill.shows.odometer && <>
                                  <td style={cell}>{l.odoStart ? l.odoStart.reading.toLocaleString('en-US') : '—'} → {l.odoEnd ? l.odoEnd.reading.toLocaleString('en-US') : '—'}</td>
                                  <td style={cell}>{l.odoMiles ?? '—'}</td>
                                </>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                    {bill.shows.odometer && odoShots.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 10 }}>
                        {odoShots.map((o) => (
                          <figure key={o.id ?? o.at} className="jl-avoid" style={{ margin: 0 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={urls[o.photo_path!]} alt={`Odometer ${o.reading}`} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 6, border: '1px solid #E4DFD3' }} />
                            <figcaption style={{ fontSize: 11, color: '#5E6470' }}>{o.contractor_name} · {fmtDay(dayOf(o.at, TZ))} {timeOf(o.at)} · {o.reading.toLocaleString('en-US')}</figcaption>
                          </figure>
                        ))}
                      </div>
                    )}

                    {(items.length > 0 || c.signoff || c.signSkip) && (
                      <div className="jl-avoid" style={{ marginTop: 10 }}>
                        {items.length > 0 && <div style={{ fontWeight: 600 }}>Deliverables: {items.filter((i) => c.done.includes(i)).length} of {items.length} done{cant.length ? `, ${cant.length} could not be done` : ''}</div>}
                        {!gaps && cant.map((i) => <div key={i} style={{ fontSize: 12.5 }}>• {i}: <i>{skipReason(c, i)}</i></div>)}
                        {(c.signoff || (!gaps && (c.signSkip || wo.signature_required))) && (
                          <div style={{ fontSize: 12.5, marginTop: 4 }}>
                            {c.signoff ? <>Signed off by <b>{c.signoff.name}</b>{c.signoff.signedAt ? ` on ${new Date(c.signoff.signedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ })}` : ''}</>
                              : c.signSkip ? <>No customer signature: <i>{c.signSkip.reason}</i></>
                                : 'Not signed off yet.'}
                          </div>
                        )}
                      </div>
                    )}
                    {gaps && gaps.length > 0 && (
                      <div className="jl-avoid" style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 600, color: '#B42318' }}>Not completed</div>
                        {gaps.map((g) => <div key={g.text} style={{ fontSize: 12.5 }}>✗ {g.text}</div>)}
                      </div>
                    )}
                    {(wo.closeout_notes ?? '').trim() && (
                      <div className="jl-avoid" style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 600 }}>Technician&apos;s notes</div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{wo.closeout_notes}</div>
                      </div>
                    )}
                    {siteReceipts.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 600 }}>Receipts at this site: {fmtMoney(siteReceipts.reduce((t, r) => t + Number(r.amount), 0))}</div>
                      </div>
                    )}
                    {showPhotos && sitePhotos.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 10 }}>
                        {sitePhotos.map((p) => (
                          <figure key={p.id} className="jl-avoid" style={{ margin: 0 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt="" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 6, border: '1px solid #E4DFD3' }} />
                            <figcaption style={{ fontSize: 11, color: '#5E6470' }}>{new Date(p.taken_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ })}</figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {receipts.length > 0 && (
                <>
                  <H>Receipts</H>
                  {byCat.length > 0 && (
                    <div className="jl-avoid" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
                      {byCat.map(({ c, sum }) => <span key={c.key}><b>{c.label}:</b> {fmtMoney(sum)}</span>)}
                      <span><b>Total:</b> {fmtMoney(receiptTotal)}</span>
                    </div>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ background: '#F6F4EF' }}>{['Date', 'Site', 'For', 'Store / note', 'Amount'].map(th)}</tr></thead>
                    <tbody>
                      {receipts.map((r) => (
                        <tr key={r.id} className="jl-avoid">
                          <td style={cell}>{fmtDay(r.expense_date)}</td>
                          <td style={cell}>WO {r.wo.wo_number}</td>
                          <td style={cell}>{expenseCategoryLabel(r.category)}</td>
                          <td style={cell}>{[r.vendor, r.note].filter(Boolean).join(' — ') || '—'}</td>
                          <td style={cell}>{fmtMoney(Number(r.amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
                    {receipts.filter((r) => r.receipt_path && urls[r.receipt_path]).map((r) => (
                      <figure key={r.id} className="jl-avoid" style={{ margin: 0 }}>
                        {r.receipt_path!.endsWith('.pdf')
                          ? <a href={urls[r.receipt_path!]} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: 20, border: '1px solid #E4DFD3', borderRadius: 6, textAlign: 'center', color: '#0E1B2E' }}>Receipt (PDF)</a>
                          // eslint-disable-next-line @next/next/no-img-element
                          : <img src={urls[r.receipt_path!]} alt="Receipt" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 6, border: '1px solid #E4DFD3', background: '#FAFAF7' }} />}
                        <figcaption style={{ fontSize: 11, color: '#5E6470' }}>{fmtDay(r.expense_date)} · {expenseCategoryLabel(r.category)} · {fmtMoney(Number(r.amount))}</figcaption>
                      </figure>
                    ))}
                  </div>
                </>
              )}

              <div style={{ marginTop: 22, fontSize: 11.5, color: '#5E6470' }}>
                Times and miles come from the technicians&apos; phones (GPS at each start and stop). Hours on site leave out lunch.
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Office › Projects ───────────────────────────────────────────────────────

/**
 * Every project in one place (Fred, 2026-10-13: "a project section"): each
 * project with its sites, the time, travel and miles so far, receipts, and the
 * client report. A site opens its work order.
 */
export function ProjectsView({ workOrders, onOpen }: { workOrders: EnrichedWorkOrder[]; onOpen: (id: string) => void }) {
  // Fred, 2026-10-14: "the client gets a URL and the technician gets an app"
  // ... "the projects need to be clean". A short list of projects; opening one
  // shows its live sheet exactly as the client sees it, with Send the sheet,
  // the client report and a small Setup (sites, who gets alerts).
  const sites = useMemo(() => workOrders.filter((w) => w.is_project), [workOrders]);
  const [events, setEvents] = useState<(DayEvent & { woId: string })[]>([]);
  const [lists, setLists] = useState<CloseoutList[]>([]);
  const [report, setReport] = useState<{ name: string; id: string } | null>(null);
  const [openName, setOpenName] = useState<string | null>(null);
  const ids = useMemo(() => sites.map((w) => w.id), [sites]);
  useEffect(() => {
    const db = createClient();
    void db.from('closeout_lists').select('id, name, keywords, items, sort').order('sort')
      .then(({ data }) => setLists(parseCloseoutLists(data)));
  }, []);
  useEffect(() => {
    if (ids.length === 0) return;
    void loadEvents(ids).then(setEvents);
  }, [ids]);

  const groups = useMemo(() => {
    const g = new Map<string, EnrichedWorkOrder[]>();
    for (const w of sites) {
      const k = (w.project_name ?? '').trim() || 'No project name';
      g.set(k, [...(g.get(k) ?? []), w]);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sites]);

  const reportModal = report && <ProjectReport projectName={report.name} startWoId={report.id} lists={lists} onClose={() => setReport(null)} />;
  const opened = openName ? groups.find(([n]) => n === openName) ?? null : null;
  if (opened) {
    const [name, list] = opened;
    return (
      <>
        <ProjectSheetPanel name={name} list={list} onBack={() => setOpenName(null)} onOpen={onOpen}
          onReport={() => setReport({ name: name === 'No project name' ? '' : name, id: list[0].id })} />
        {reportModal}
      </>
    );
  }

  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <div className="wf" style={{ padding: 16, maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h1 className="wf-h1" style={{ margin: 0 }}>Projects</h1>
        <div className="wf-subtle">Your client follows each project on its live sheet. Your techs work it from the app.</div>
      </div>
      <PushSwitch hideWhenOn />
      {groups.length === 0 ? (
        <Section title="No projects yet">
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            To start one: open a work order, tap <b>Edit job</b>, type the project&apos;s name under <b>Project / Campaign</b> and tick
            <b> Project site</b>. Do that for each site (same project name). The techs on it then see it under <b>Projects</b> in their app.
          </div>
        </Section>
      ) : groups.map(([name, list]) => {
        const listIds = new Set(list.map((w) => w.id));
        const evs = events.filter((e) => listIds.has(e.woId));
        const last = evs.reduce((m, e) => (e.at > m ? e.at : m), '');
        const t = totalsOf(buildDayLogs(evs, new Date(), TZ));
        const techs = [...new Set(list.flatMap((w) => (w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter(Boolean) as string[]))];
        const openSites = list.filter((w) => !['Work Done', 'Approved', 'Paid', 'Cancelled'].includes(w.wo_status ?? '')).length;
        return (
          <button key={name} className="wf-card" onClick={() => setOpenName(name)}
            style={{ padding: '14px 16px', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 16 }}>{name}</b>
              <span className="wf-subtle" style={{ display: 'block', fontSize: 13, marginTop: 3 }}>
                {list.length} {list.length === 1 ? 'site' : 'sites'} · {openSites} open · {techs.length} {techs.length === 1 ? 'tech' : 'techs'}
                {t.days ? ` · ${formatDuration(t.onSiteMs)} on site · ${t.miles} mi` : ''}
              </span>
            </span>
            <span className="wf-subtle" style={{ fontSize: 12.5, textAlign: 'right' }}>{last ? `Updated ${when(last)}` : 'Not started'}</span>
            <span aria-hidden style={{ fontSize: 20, color: 'var(--wf-subtle)' }}>›</span>
          </button>
        );
      })}
      {reportModal}
    </div>
  );
}

/** One project: its live sheet as the client sees it, and a small setup. */
function ProjectSheetPanel({ name, list, onBack, onOpen, onReport }: {
  name: string; list: EnrichedWorkOrder[]; onBack: () => void; onOpen: (id: string) => void; onReport: () => void;
}) {
  const db = useMemo(() => createClient(), []);
  const noName = name === 'No project name';
  const [url, setUrl] = useState<string | null>(null);
  const [people, setPeople] = useState<AlertPersonRow[]>([]);
  const [sending, setSending] = useState(false);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    if (noName) return;
    void db.rpc('project_sheet_token', { p_project: name, p_new: false })
      .then(({ data }) => setUrl(typeof data === 'string' ? `${window.location.origin}/sheet/${data}` : null));
    void db.from('project_alert_people').select('id, name, role, email, phone, auth_user_id, by_email, by_push, by_text').eq('project_name', name)
      .then(({ data }) => setPeople((data as AlertPersonRow[] | null) ?? []));
  }, [db, name, noName, setup]);

  return (
    <div className="wf" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onBack}>← Projects</button>
        <h1 className="wf-h1" style={{ margin: 0, flex: 1, minWidth: 160, fontSize: 20 }}>{name}</h1>
        {url && <button className="wf-btn wf-btn-navy wf-btn-sm" onClick={() => setSending(true)}>Send the sheet</button>}
        {url && <a className="wf-btn wf-btn-outline wf-btn-sm" href={url} target="_blank" rel="noopener noreferrer">Open as the client sees it</a>}
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onReport}><FileText size={15} /> Weekly bill</button>
        {!noName && <button className="wf-btn wf-btn-ghost wf-btn-sm" aria-expanded={setup} onClick={() => setSetup((s) => !s)}>{setup ? 'Hide setup' : 'Setup'}</button>}
      </div>

      {setup && !noName && (
        <div className="wf-card" style={{ padding: 12 }}>
          <div className="wf-label" style={{ marginBottom: 4 }}>Sites</div>
          {list.map((w) => (
            <button key={w.id} onClick={() => onOpen(w.id)}
              style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', padding: '8px 2px', border: 'none', borderTop: '1px solid var(--wf-line)', background: 'transparent', font: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
              <MapPin size={15} color="var(--wf-subtle)" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>WO {w.wo_number}</b> · {w.site_name || w.title || 'Site'}{w.site_city ? `, ${w.site_city}` : ''}
                <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5 }}>
                  {(w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter(Boolean).join(', ') || 'No tech yet'} · {w.wo_status ?? 'Open'}
                </span>
              </span>
            </button>
          ))}
          <AlertPeople project={name} />
        </div>
      )}

      {noName ? (
        <Section title="Give these sites a project name">
          <div style={{ fontSize: 14 }}>Open each work order, tap <b>Edit job</b> and type the project&apos;s name under <b>Project / Campaign</b>. Then it gets its live sheet.</div>
        </Section>
      ) : url ? (
        <iframe title={`${name} live sheet`} src={url}
          style={{ width: '100%', height: 'calc(100vh - 150px)', minHeight: 520, border: '1px solid var(--wf-line)', borderRadius: 10, background: '#fff' }} />
      ) : <div className="wf-subtle">Loading the sheet…</div>}

      {sending && url && (
        <SendSheetDialog project={name} url={url} people={people.filter((p) => p.role !== 'owner')} onClose={() => setSending(false)} />
      )}
    </div>
  );
}

// ── Live alerts (migration 119) ─────────────────────────────────────────────

type AlertPersonRow = {
  id: string; name: string; role: 'owner' | 'assistant' | 'pm' | 'other';
  email: string | null; phone: string | null; auth_user_id: string | null;
  by_email: boolean; by_push: boolean; by_text: boolean;
};

const ROLE_WORD: Record<AlertPersonRow['role'], string> = { owner: 'You', assistant: 'Assistant', pm: 'Project manager', other: 'Other' };

/** Who gets one project's alerts, and how. Empty: the owner, by email and pop-up. */
export function AlertPeople({ project }: { project: string }) {
  const [rows, setRows] = useState<AlertPersonRow[] | null>(null);
  const [staff, setStaff] = useState<{ name: string; email: string; auth_user_id: string | null }[]>([]);
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(false);
  const db = useMemo(() => createClient(), []);
  const load = useCallback(async () => {
    const { data } = await db.from('project_alert_people')
      .select('id, name, role, email, phone, auth_user_id, by_email, by_push, by_text').eq('project_name', project).order('created_at');
    setRows((data as AlertPersonRow[] | null) ?? []);
  }, [db, project]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void db.from('staff_members').select('name, email, auth_user_id, enabled').eq('enabled', true)
      .then(({ data }) => setStaff(((data as { name: string; email: string; auth_user_id: string | null }[] | null) ?? [])));
  }, [db]);

  const add = async (p: Partial<AlertPersonRow> & { name: string; role: AlertPersonRow['role'] }) => {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;
    const { error } = await db.from('project_alert_people').insert({
      user_id: user.id, project_name: project, name: p.name, role: p.role, email: p.email ?? null, phone: p.phone ?? null,
      auth_user_id: p.auth_user_id ?? null, by_email: p.by_email ?? true, by_push: p.by_push ?? !!p.auth_user_id, by_text: p.by_text ?? false,
    });
    if (error) { toastError('Could not add them.'); return; }
    await load();
  };
  const addMe = async () => {
    const { data: { user } } = await db.auth.getUser();
    if (user) await add({ name: 'You', role: 'owner', email: 'fajsolutions@gmail.com', auth_user_id: user.id, by_push: true });
  };
  const save = async (id: string, patch: Partial<AlertPersonRow>) => {
    setRows((r) => r?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? r);
    const { error } = await db.from('project_alert_people').update(patch).eq('id', id);
    if (error) { toastError('Could not save that.'); void load(); }
  };
  const remove = async (r: AlertPersonRow) => {
    if (!confirm(`Stop sending ${project} alerts to ${r.name}?`)) return;
    await db.from('project_alert_people').delete().eq('id', r.id);
    await load();
  };
  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/alerts/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_name: project }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) toastError(j.error ?? 'Could not send the test.');
      else toastSuccess('Test alert sent. It should arrive in a few seconds.');
    } finally {
      setTesting(false);
    }
  };

  // The live project sheet (migration 120): one link per project, no login.
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const sheetLink = useCallback(async (fresh: boolean) => {
    const { data, error } = await db.rpc('project_sheet_token', { p_project: project, p_new: fresh });
    if (error || typeof data !== 'string') return false;
    setSheetUrl(`${window.location.origin}/sheet/${data}`);
    return true;
  }, [db, project]);
  useEffect(() => { void sheetLink(false); }, [sheetLink]);
  const copySheet = async () => {
    if (!sheetUrl) return;
    try { await navigator.clipboard.writeText(sheetUrl); toastSuccess('Link copied. Paste it into an email or text.'); }
    catch { window.prompt('Copy the link:', sheetUrl); }
  };
  const newSheetLink = async () => {
    if (!confirm(`Give ${project} a new live sheet link? The old link stops working for everyone who has it.`)) return;
    if (await sheetLink(true)) toastSuccess('New link made. Alert emails use it from now on.');
    else toastError('Could not make a new link.');
  };

  const [sending, setSending] = useState(false);

  const hasMe = rows?.some((r) => r.role === 'owner');
  const chip = (on: boolean, label: string, onClick: () => void, title?: string) => (
    <button className="wf-chip" onClick={onClick} title={title} aria-pressed={on}
      style={{ border: '1px solid var(--wf-line)', cursor: 'pointer', font: 'inherit', fontSize: 12,
        background: on ? 'var(--wf-navy)' : 'var(--wf-card)', color: on ? '#fff' : 'var(--wf-subtle)' }}>{label}</button>
  );

  return (
    <div style={{ borderTop: '1px solid var(--wf-line)', marginTop: 8, paddingTop: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, padding: '8px 10px', border: '1px solid var(--wf-line)', borderRadius: 10 }}>
        <span style={{ flex: '1 1 220px', minWidth: 0 }}>
          <b>Live sheet</b>
          <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5 }}>
            One page per site, a line for every clock-in, drive, photo and receipt as it happens. Anyone with the link can watch, no login. Every alert email carries it.
          </span>
        </span>
        {sheetUrl ? <>
          <button className="wf-btn wf-btn-navy wf-btn-sm" onClick={() => setSending(true)}>Send the sheet</button>
          <a className="wf-btn wf-btn-outline wf-btn-sm" href={sheetUrl} target="_blank" rel="noopener noreferrer">Open</a>
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void copySheet()}>Copy link</button>
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void newSheetLink()}>New link</button>
        </> : <span className="wf-subtle">Loading…</span>}
      </div>
      {sending && sheetUrl && (
        <SendSheetDialog project={project} url={sheetUrl} people={(rows ?? []).filter((r) => r.role !== 'owner')} onClose={() => setSending(false)} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <b style={{ flex: 1 }}>Live alerts go to</b>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={testing} onClick={() => void test()}>Send a test alert</button>
      </div>
      <div className="wf-subtle" style={{ fontSize: 12.5, marginBottom: 8 }}>
        Clock in and sign out, travel, start job, off site, site finished, photos, notes, answers and receipts on this project, as they happen.
      </div>
      {rows === null ? <div className="wf-subtle">Loading…</div> : rows.length === 0 && (
        <div style={{ fontSize: 13, marginBottom: 8 }}>Nobody added yet, so they go to <b>you</b> by email and pop-up.</div>
      )}
      {(rows ?? []).map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--wf-line)' }}>
          <span style={{ flex: '1 1 150px', minWidth: 0 }}>
            <b>{r.name}</b> <span className="wf-subtle" style={{ fontSize: 12 }}>{ROLE_WORD[r.role]}</span>
            <span style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              <input className="wf-input" defaultValue={r.email ?? ''} placeholder="Email" aria-label={`${r.name} email`}
                style={{ minHeight: 32, padding: '2px 8px', fontSize: 16, flex: '1 1 160px' }}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.email ?? '')) void save(r.id, { email: v || null }); }} />
              <input className="wf-input" defaultValue={r.phone ?? ''} placeholder="Cell for texts" aria-label={`${r.name} phone`} inputMode="tel"
                style={{ minHeight: 32, padding: '2px 8px', fontSize: 16, flex: '1 1 120px' }}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.phone ?? '')) void save(r.id, { phone: v || null }); }} />
            </span>
          </span>
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {chip(r.by_email, 'Email', () => void save(r.id, { by_email: !r.by_email }))}
            {r.auth_user_id && chip(r.by_push, 'Pop-up', () => void save(r.id, { by_push: !r.by_push }), 'On phones where they turned pop-ups on')}
            {chip(r.by_text, 'Text', () => void save(r.id, { by_text: !r.by_text }), 'Texts start once text messaging is set up')}
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void remove(r)} aria-label={`Remove ${r.name}`}>Remove</button>
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {!hasMe && <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => void addMe()}><Plus size={14} /> Me</button>}
        {staff.filter((s) => !(rows ?? []).some((r) => r.auth_user_id && r.auth_user_id === s.auth_user_id)).map((s) => (
          <button key={s.email} className="wf-btn wf-btn-outline wf-btn-sm"
            onClick={() => void add({ name: s.name, role: 'assistant', email: s.email, auth_user_id: s.auth_user_id })}>
            <Plus size={14} /> {s.name} (assistant)
          </button>
        ))}
        <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Project manager or someone else</button>
      </div>
      {adding && <AddPersonDialog project={project} onClose={() => setAdding(false)} onAdd={async (p) => { await add(p); setAdding(false); }} />}
    </div>
  );
}

function AddPersonDialog({ project, onClose, onAdd }: {
  project: string; onClose: () => void;
  onAdd: (p: { name: string; role: 'pm' | 'other'; email: string | null; phone: string | null; by_email: boolean; by_text: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'pm' | 'other'>('pm');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const ok = name.trim() && (email.includes('@') || phone.replace(/\D/g, '').length >= 10);
  const label = (t: string) => <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>{t}</span>;
  return (
    <Dialog title={`Add to ${project} alerts`} onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={!ok} onClick={() => void onAdd({
          name: name.trim(), role, email: email.trim() || null, phone: phone.trim() || null,
          by_email: email.includes('@'), by_text: false,
        })}>Add</button>
      </>}>
      <div className="wf-subtle" style={{ fontSize: 12.5, marginBottom: 10 }}>
        They get this project&apos;s alerts by email (and text once texts are set up): times, photos, notes and receipts. If they work for the client,
        they see your techs&apos; day live. No prices or pay are ever in an alert.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label>{label('Name')}<input className="wf-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>{label('Who they are')}
          <select className="wf-input" value={role} onChange={(e) => setRole(e.target.value as 'pm' | 'other')}>
            <option value="pm">Project manager</option>
            <option value="other">Someone else</option>
          </select>
        </label>
        <label>{label('Email')}<input className="wf-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>{label('Cell (for texts)')}<input className="wf-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      </div>
    </Dialog>
  );
}

/**
 * Send the sheet (Fred, 2026-10-14: "need to send the sheet, not log into any
 * app"). Opens this phone's Messages or email with the link and a short note
 * filled in; Fred presses send. Nothing goes out on its own.
 */
export function SendSheetDialog({ project, url, people, onClose }: {
  project: string; url: string; people: { id: string; name: string; email: string | null; phone: string | null }[]; onClose: () => void;
}) {
  const reachable = people.filter((p) => p.email || p.phone);
  const row = (name: string | null, phone: string | null, email: string | null, key: string) => {
    const note = sheetInvite(project, url, name);
    return (
      <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--wf-line)' }}>
        <span style={{ flex: 1, minWidth: 0 }}><b>{name ?? 'Someone else'}</b>
          {name && <span className="wf-subtle" style={{ display: 'block', fontSize: 12 }}>{[phone, email].filter(Boolean).join(' · ')}</span>}
        </span>
        {(phone || !name) && <a className="wf-btn wf-btn-navy wf-btn-sm" href={smsHref(phone, note)}>Text</a>}
        {(email || !name) && <a className="wf-btn wf-btn-outline wf-btn-sm" href={mailtoHref(email, project, note)}>Email</a>}
      </div>
    );
  };
  return (
    <Dialog title="Send the live sheet" onClose={onClose}>
      <p className="wf-subtle" style={{ marginTop: 0, fontSize: 13 }}>
        Opens your phone&apos;s messages or email with the link and a short note filled in. You press send. They don&apos;t need to log in to anything.
      </p>
      {reachable.map((p) => row(p.name, p.phone, p.email, p.id))}
      {row(null, null, null, 'other')}
      <div className="wf-label" style={{ marginTop: 12 }}>The note</div>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: 'var(--wf-bg, #F6F4EF)', borderRadius: 8, padding: '8px 10px', marginTop: 4 }}>
        {sheetInvite(project, url, reachable[0]?.name ?? null)}
      </div>
    </Dialog>
  );
}
