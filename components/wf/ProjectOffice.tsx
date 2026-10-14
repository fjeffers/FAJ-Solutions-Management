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
import { Car, FileText, MapPin, Plus, Printer, Receipt, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  buildDayLogs, dayOf, hoursOf, legLabel, parseDayEvents, totalsOf, type DayEvent, type DayLog,
} from '@/lib/project-day';
import { parseCloseout, parseCloseoutLists, listFor, skipReason, type CloseoutList } from '@/lib/closeout';
import { EXPENSE_CATEGORIES, expenseCategoryLabel, expenseReasonText, parseExpenseAmount } from '@/lib/expenses';
import { inRange } from '@/lib/job-log';
import { formatDuration } from '@/lib/wf';
import { fmtMoney } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import type { EnrichedWorkOrder } from '@/lib/types';
import { Dialog, Section } from './WfUi';

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
  const logs = useMemo(() => buildDayLogs(events ?? [], new Date(), TZ), [events]);
  const t = totalsOf(logs);

  return (
    <Section
      title="Project day"
      subtitle={w.project_name ? `${w.project_name} · from the techs' phones` : "From the techs' phones"}
      right={<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setReceiptOpen(true)}><Plus size={15} /> Add receipt</button>
        <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => setReportOpen(true)}><FileText size={15} /> Client report</button>
      </div>}
    >
      {events === null ? <div className="wf-subtle">Loading…</div>
        : logs.length === 0 ? (
          <div className="wf-subtle" style={{ fontSize: 13 }}>
            Nothing yet. When a tech taps Start travel, Start job, Lunch and Off site on this site, each day shows here with the miles.
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
            {logs.map((d) => <DayBlock key={`${d.day}|${d.tech}`} d={d} onChanged={load} />)}
          </>
        )}
      {receiptOpen && (
        <OfficeReceiptDialog woId={w.id} onClose={() => setReceiptOpen(false)}
          onSaved={() => { setReceiptOpen(false); window.dispatchEvent(new Event(EXPENSES_CHANGED)); }} />
      )}
      {reportOpen && <ProjectReport projectName={w.project_name ?? ''} startWoId={w.id} lists={lists} onClose={() => setReportOpen(false)} />}
    </Section>
  );
}

function DayBlock({ d, onChanged }: { d: DayLog; onChanged: () => void }) {
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
        ...d.legs.map((l) => ({ at: l.start, el: (
          <div key={`l${l.start}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
            <Car size={14} color="var(--wf-subtle)" />
            <span>{legLabel(l)} · {timeOf(l.start)}–{l.end ? timeOf(l.end) : 'driving now'} · {formatDuration(l.ms)}</span>
            <MilesEdit id={l.endId} miles={l.miles} onSaved={onChanged} />
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
  | 'customer_name' | 'external_wo_id' | 'closeout_notes' | 'scheduled_date' | 'start_date' | 'signature_required'> & { closeout: unknown };
type ReportExpense = { id: string; wo_id: string; category: string; vendor: string | null; amount: number; expense_date: string; note: string | null; receipt_path: string | null; status: string };
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

  useEffect(() => {
    const db = createClient();
    void (async () => {
      const cols = 'id, wo_number, title, description, site_name, site_address, site_city, site_state, site_zip, customer_name, external_wo_id, closeout_notes, scheduled_date, start_date, signature_required, closeout';
      // The whole project: every project site with this name. A job with no
      // project name reports on its own.
      const q = projectName.trim()
        ? db.from('work_orders').select(cols).eq('is_project', true).eq('project_name', projectName)
        : db.from('work_orders').select(cols).eq('id', startWoId);
      const { data } = await q.order('scheduled_date', { ascending: true, nullsFirst: false });
      const list = ((data as ReportWo[] | null) ?? []);
      setWos(list);
      const ids = list.map((x) => x.id);
      if (ids.length === 0) return;
      const [ev, ex, ph] = await Promise.all([
        loadEvents(ids),
        db.from('job_expenses').select('id, wo_id, category, vendor, amount, expense_date, note, receipt_path, status').in('wo_id', ids).order('expense_date'),
        db.from('wo_photos').select('id, wo_id, url, taken_at, contractor_name').in('wo_id', ids).order('taken_at'),
      ]);
      setEvents(ev);
      const all = ((ex.data as ReportExpense[] | null) ?? []);
      setExpenses(all.filter((e) => e.status === 'approved'));
      setWaiting(all.filter((e) => e.status === 'submitted').length);
      setPhotos(((ph.data as ReportPhoto[] | null) ?? []));
      const paths = all.map((e) => e.receipt_path).filter((p): p is string => !!p);
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
    return {
      wo, logs, totals: totalsOf(logs),
      receipts: expenses.filter((e) => e.wo_id === wo.id && inRange(e.expense_date, from, to)),
      photos: photos.filter((p) => p.wo_id === wo.id && inRange(dayOf(p.taken_at, TZ), from, to)),
    };
  }), [wos, events, expenses, photos, from, to, now]);
  const shown = perSite.filter((s) => s.logs.length > 0 || s.receipts.length > 0 || s.photos.length > 0);
  const all = totalsOf(shown.flatMap((s) => s.logs));
  const receipts = shown.flatMap((s) => s.receipts.map((r) => ({ ...r, wo: s.wo })));
  const byCat = EXPENSE_CATEGORIES.map((c) => ({ c, sum: receipts.filter((r) => r.category === c.key).reduce((t, r) => t + Number(r.amount), 0) })).filter((x) => x.sum > 0);
  const receiptTotal = receipts.reduce((t, r) => t + Number(r.amount), 0);
  const client = (wos ?? []).find((x) => x.customer_name)?.customer_name ?? '';
  const range = `${fmtDayLong(from)} – ${fmtDayLong(to)}`;

  const H = ({ children }: { children: React.ReactNode }) => (
    <h3 style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 15, fontWeight: 700, color: '#0E1B2E', margin: '22px 0 8px', paddingBottom: 6, borderBottom: '2px solid #C9A24B' }}>{children}</h3>
  );
  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #ECE8DF', textAlign: 'left', verticalAlign: 'top' };
  const th = (h: string) => <th key={h} style={{ ...cell, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>;
  const where = (wo: ReportWo) => [wo.site_address, [wo.site_city, [wo.site_state, wo.site_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');

  return createPortal(
    <div id="job-log-root" className="wf" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(2,4,9,0.55)', overflowY: 'auto', padding: '16px 12px 40px' }}>
      <div className="no-print" style={{ maxWidth: 850, margin: '0 auto 12px', background: '#F6F4EF', borderRadius: 14, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 16, flex: '1 1 160px' }}>Client report · {projectName || 'this site'}</div>
        <label style={{ fontSize: 13 }}>From <input type="date" className="wf-input" style={{ width: 150, minHeight: 36, padding: '4px 8px' }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 13 }}>To <input type="date" className="wf-input" style={{ width: 150, minHeight: 36, padding: '4px 8px' }} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={showPhotos} onChange={(e) => setShowPhotos(e.target.checked)} /> Job photos
        </label>
        <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>
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
            <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 1.5, color: '#E3C987' }}>PROJECT REPORT</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{range}</div>
          </div>
        </div>

        <div style={{ padding: '20px 24px 28px' }}>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{projectName || (wos?.[0]?.title ?? 'Project')}</div>
          {client && <div style={{ marginTop: 4 }}><b>Client:</b> {client}</div>}

          {wos === null ? <div style={{ color: '#5E6470', marginTop: 14 }}>Loading…</div> : (
            <>
              <div className="jl-avoid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 16 }}>
                {[
                  ['Sites', String(shown.length)],
                  ['Days', String(all.days)],
                  ['Hours on site', String(hoursOf(all.onSiteMs))],
                  ['Travel hours', String(hoursOf(all.travelMs))],
                  ['Miles', String(all.miles)],
                  ['Receipts', fmtMoney(receiptTotal)],
                ].map(([label, value]) => (
                  <div key={label} style={{ border: '1px solid #E4DFD3', borderRadius: 10, padding: '8px 10px' }}>
                    <div style={{ fontSize: 11, color: '#5E6470', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
                    <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 18, fontWeight: 700 }}>{value}</div>
                  </div>
                ))}
              </div>
              {shown.length === 0 && <div style={{ color: '#5E6470', marginTop: 14 }}>Nothing recorded in these dates.</div>}

              {shown.map(({ wo, logs, totals, receipts: siteReceipts, photos: sitePhotos }) => {
                const c = parseCloseout(wo.closeout);
                const items = listFor(lists, wo.title ?? '', wo.description ?? '').items;
                const cant = items.filter((i) => skipReason(c, i));
                return (
                  <div key={wo.id}>
                    <H>{wo.site_name || wo.title || 'Site'} · WO {wo.wo_number}{wo.external_wo_id ? ` · Client # ${wo.external_wo_id}` : ''}</H>
                    {where(wo) && <div style={{ color: '#5E6470', marginBottom: 6 }}>{where(wo)}</div>}
                    {logs.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ background: '#F6F4EF' }}>{['Date', 'Technician', 'What', 'From', 'To', 'Hours', 'Miles'].map(th)}</tr></thead>
                        <tbody>
                          {logs.flatMap((d) => [
                            ...(d.clockIn ? [{ at: d.clockIn, row: (
                              <tr key={`c${d.tech}${d.clockIn}`} className="jl-avoid">
                                <td style={cell}>{fmtDay(d.day)}</td><td style={cell}>{d.tech}</td>
                                <td style={cell}>Clocked in</td>
                                <td style={cell}>{timeOf(d.clockIn)}</td><td style={cell}>{d.signOut ? `Signed out ${timeOf(d.signOut)}` : ''}</td>
                                <td style={cell}>{d.signOut ? hoursOf(Date.parse(d.signOut) - Date.parse(d.clockIn)) : ''}</td><td style={cell}></td>
                              </tr>
                            ) }] : []),
                            ...d.legs.map((l) => ({ at: l.start, row: (
                              <tr key={`l${d.tech}${l.start}`} className="jl-avoid">
                                <td style={cell}>{fmtDay(d.day)}</td><td style={cell}>{d.tech}</td>
                                <td style={cell}>Travel: {legLabel(l)}</td>
                                <td style={cell}>{timeOf(l.start)}</td><td style={cell}>{l.end ? timeOf(l.end) : '—'}</td>
                                <td style={cell}>{hoursOf(l.ms)}</td><td style={cell}>{l.miles ?? '—'}</td>
                              </tr>
                            ) })),
                            ...d.spans.map((s) => ({ at: s.in, row: (
                              <tr key={`s${d.tech}${s.in}`} className="jl-avoid">
                                <td style={cell}>{fmtDay(d.day)}</td><td style={cell}>{d.tech}</td>
                                <td style={cell}>On site{s.lunchMs ? ` (lunch ${formatDuration(s.lunchMs)} not counted)` : ''}</td>
                                <td style={cell}>{timeOf(s.in)}</td><td style={cell}>{s.out ? timeOf(s.out) : 'still on site'}</td>
                                <td style={cell}>{hoursOf(s.ms)}</td><td style={cell}></td>
                              </tr>
                            ) })),
                          ].sort((a, b) => a.at.localeCompare(b.at)).map((x) => x.row))}
                          <tr style={{ fontWeight: 700 }}>
                            <td style={cell} colSpan={5}>Site total: {hoursOf(totals.onSiteMs)} h on site, {hoursOf(totals.travelMs)} h travel</td>
                            <td style={cell}>{hoursOf(totals.onSiteMs + totals.travelMs)}</td><td style={cell}>{totals.miles}</td>
                          </tr>
                        </tbody>
                      </table>
                    )}

                    {(items.length > 0 || c.signoff || c.signSkip) && (
                      <div className="jl-avoid" style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 600 }}>Deliverables: {items.filter((i) => c.done.includes(i)).length} of {items.length} done{cant.length ? `, ${cant.length} could not be done` : ''}</div>
                        {cant.map((i) => <div key={i} style={{ fontSize: 12.5 }}>• {i}: <i>{skipReason(c, i)}</i></div>)}
                        <div style={{ fontSize: 12.5, marginTop: 4 }}>
                          {c.signoff ? <>Signed off by <b>{c.signoff.name}</b>{c.signoff.signedAt ? ` on ${new Date(c.signoff.signedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ })}` : ''}</>
                            : c.signSkip ? <>No customer signature: <i>{c.signSkip.reason}</i></>
                              : 'Not signed off yet.'}
                        </div>
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
  const sites = useMemo(() => workOrders.filter((w) => w.is_project), [workOrders]);
  const [events, setEvents] = useState<(DayEvent & { woId: string })[]>([]);
  const [receipts, setReceipts] = useState<Record<string, number>>({});
  const [lists, setLists] = useState<CloseoutList[]>([]);
  const [report, setReport] = useState<{ name: string; id: string } | null>(null);
  const ids = useMemo(() => sites.map((w) => w.id), [sites]);
  useEffect(() => {
    const db = createClient();
    void db.from('closeout_lists').select('id, name, keywords, items, sort').order('sort')
      .then(({ data }) => setLists(parseCloseoutLists(data)));
  }, []);
  useEffect(() => {
    if (ids.length === 0) return;
    void loadEvents(ids).then(setEvents);
    void createClient().from('job_expenses').select('wo_id, amount, status').in('wo_id', ids).eq('status', 'approved')
      .then(({ data }) => {
        const m: Record<string, number> = {};
        for (const r of (data as { wo_id: string; amount: number }[] | null) ?? []) m[r.wo_id] = (m[r.wo_id] ?? 0) + Number(r.amount);
        setReceipts(m);
      });
  }, [ids]);

  const groups = useMemo(() => {
    const g = new Map<string, EnrichedWorkOrder[]>();
    for (const w of sites) {
      const k = (w.project_name ?? '').trim() || 'No project name';
      g.set(k, [...(g.get(k) ?? []), w]);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sites]);

  return (
    <div className="wf" style={{ padding: 16, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 className="wf-h1" style={{ margin: 0 }}>Projects</h1>
        <div className="wf-subtle">Multi-day sites: travel, time on site, miles and receipts from the techs&apos; phones, and the report for the client.</div>
      </div>
      {groups.length === 0 ? (
        <Section title="No projects yet">
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            To start one: open a work order, tap <b>Edit job</b>, type the project&apos;s name under <b>Project / Campaign</b> and tick
            <b> Project site</b>. Do that for each site (same project name). The techs on it then see it under <b>Projects</b> in their
            app, with Start travel, Start job, Lunch, Off site and the drive to the hotel or home.
          </div>
        </Section>
      ) : groups.map(([name, list]) => {
        const listIds = new Set(list.map((w) => w.id));
        const t = totalsOf(buildDayLogs(events.filter((e) => listIds.has(e.woId)), new Date(), TZ));
        const spent = list.reduce((s, w) => s + (receipts[w.id] ?? 0), 0);
        return (
          <Section key={name} title={name}
            subtitle={`${list.length} ${list.length === 1 ? 'site' : 'sites'} · ${t.days} days · ${formatDuration(t.onSiteMs)} on site · ${formatDuration(t.travelMs)} travel · ${t.miles} mi · ${fmtMoney(spent)} receipts`}
            right={<button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => setReport({ name: name === 'No project name' ? '' : name, id: list[0].id })}>
              <FileText size={15} /> Client report
            </button>}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {list.map((w) => {
                const s = totalsOf(buildDayLogs(events.filter((e) => e.woId === w.id), new Date(), TZ));
                return (
                  <button key={w.id} onClick={() => onOpen(w.id)}
                    style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 4px', border: 'none', borderTop: '1px solid var(--wf-line)', background: 'transparent', font: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
                    <MapPin size={16} color="var(--wf-subtle)" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>WO {w.wo_number}</b> · {w.site_name || w.title || 'Site'}{w.site_city ? `, ${w.site_city}` : ''}
                      <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5 }}>
                        {(w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter(Boolean).join(', ') || 'No tech yet'}
                        {' · '}{w.wo_status ?? 'Open'}{w.scheduled_date || w.start_date ? ` · ${fmtDay(String(w.scheduled_date || w.start_date).slice(0, 10))}` : ''}
                      </span>
                    </span>
                    <span className="wf-subtle" style={{ fontSize: 12.5, textAlign: 'right' }}>
                      {s.days ? `${formatDuration(s.onSiteMs)} on site · ${s.miles} mi` : 'Not started'}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        );
      })}
      {report && <ProjectReport projectName={report.name} startWoId={report.id} lists={lists} onClose={() => setReport(null)} />}
    </div>
  );
}
