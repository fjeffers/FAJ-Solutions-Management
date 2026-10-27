'use client';
// Office → FAJ Solutions Field Sheet (Fred, 2026-10-24: "add it under office and
// i can pull it by the app work order number and edit whats needed"; "give it
// one general name ... FAJ Solutions Field sheet"; "a way for me to build not
// only LDS but Wendys and other clients"). One sheet per site. Type a WO number
// (or the client's ticket or site number) and the job's week comes up, one line
// per tech per day from the techs' taps, with the office's own figures on top
// (lib/field-sheet.ts, migration 136). Every figure can be typed over. Receipts
// are approved or declined here the same way as in WorkFlow, a declined one
// moves to its own list and leaves the bill, and the odometer, receipt and job
// photos are at the bottom. Excel for the client or Smartsheet.
//
// Billing: pick the client, the site location and how they pay (hourly,
// blended, fixed or per item; mileage, meals, hotel, receipts). Each day shows
// what it bills and the week adds up. Finish creates the invoice in QuickBooks
// the same way as the Site Log and can email it to the client
// (/api/quickbooks/field-sheet-invoice).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ExternalLink, EyeOff, FileSpreadsheet, FileText, Plus, Receipt, RotateCcw, Search, Send, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { dayOf } from '@/lib/project-day';
import type { OdoRow } from '@/lib/weekly-bill';
import {
  atCost, billRange, blocksBilling, dayBill, dayCalc, fieldSheetRows, inDates, LABOR_TYPES, nextEdits, overlaps, parseEdits, parseSettings, rowsFor, sheetTotals,
  withAccountRate, type BillItem, type LaborType, type SavedDay, type SheetField, type SheetReceipt, type SheetRow, type SheetSettings, type SheetTotals,
} from '@/lib/field-sheet';
import { expenseCategoryLabel, expenseReasonText } from '@/lib/expenses';
import { isNetviewJob, netviewAnswers, netviewFormUrl, NETVIEW_PAYROLL } from '@/lib/netview-form';
import { tapWindow, weekSites, weekToBillFor, type WeekInvoice, type WeekSite, type WeekTap, type WeekTyped } from '@/lib/week-to-bill';
import { downloadCSVText, downloadXLSXBook } from '@/lib/export';
import { toCSV } from '@/lib/csv';
import { fieldSheetImportRows, sheetBillTotal, sheetInvoiceNumber, siteBillBook, type QboSheetBill } from '@/lib/qbo-work-order-export';
import { fmtMoney } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import type { EnrichedWorkOrder } from '@/lib/types';
import { Section } from '@/components/wf/WfUi';
import { loadEvents, OfficeReceiptDialog } from '@/components/wf/ProjectOffice';
import FieldSheetReport from '@/components/FieldSheetReport';
import { ClockPanel, StillOnSite } from '@/components/ClockFix';

const TZ = 'America/New_York';
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const at = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
const hrs = (n: number) => (n ? n.toFixed(2) : '–');
const mi = (n: number) => (n ? n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–');
const money = (n: number) => (n ? fmtMoney(n) : '–');
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Field sheet';

/** The job a search finds: its WO number, the client's ticket (LDS-1110) or the client's site number. */
export function findJob(workOrders: EnrichedWorkOrder[], q: string): EnrichedWorkOrder | null {
  const s = q.trim().toLowerCase().replace(/^wo\s*#?\s*/, '');
  if (!s) return null;
  const eq = (v: string | null | undefined) => (v ?? '').trim().toLowerCase() === s;
  return workOrders.find((w) => eq(w.wo_number)) ?? workOrders.find((w) => eq(w.external_wo_id))
    ?? workOrders.find((w) => eq(w.client_reference)) ?? null;
}

const jobName = (w: EnrichedWorkOrder) => w.site_name || w.title || `WO ${w.wo_number}`;

/**
 * A job's bill for some dates, built by the server exactly as its invoice would
 * be (a dry run of /api/quickbooks/field-sheet-invoice), for QuickBooks' invoice
 * import (Fred, 2026-10-25: "i need a auto sheet to enter into quickbooks").
 * Dates already invoiced, or nothing to bill, come back as the reason.
 */
async function sheetBill(wo: EnrichedWorkOrder, from?: string, to?: string): Promise<{ bill: QboSheetBill } | { error: string }> {
  try {
    const res = await fetch('/api/quickbooks/field-sheet-invoice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wo_id: wo.id, from: from || undefined, to: to || undefined, dry_run: true }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; customer?: string; from?: string; to?: string; memo?: string; lines?: QboSheetBill['lines'] };
    if (!res.ok || j.error || !j.customer || !j.from || !j.to || !j.lines?.length) return { error: j.error ?? "Couldn't build the bill." };
    return { bill: { woNumber: wo.wo_number, customerName: j.customer, from: j.from, to: j.to, memo: j.memo ?? '', lines: j.lines } };
  } catch {
    return { error: "Couldn't reach the app. Check your connection." };
  }
}
/** The file to import in QuickBooks: Settings → Import data → Invoices. date: the invoices' date, kept for their NetView forms. */
const downloadImport = (bills: QboSheetBill[], name: string, date: string) =>
  downloadCSVText(`${fileSafe(name)}.csv`, toCSV(fieldSheetImportRows(bills, date)));
const IMPORT_HOW = 'In QuickBooks: Settings → Import data → Invoices. Import each file once, then press Imported on each bill so its dates show as billed.';

/**
 * Once QuickBooks has imported a bill from the file: the server records its
 * dates as billed under the file's number, so they can't be billed again here.
 * Never on download, only on Fred's word. Returns the reason it couldn't.
 */
async function markImported(wo: EnrichedWorkOrder, bill: QboSheetBill, date: string): Promise<string | null> {
  try {
    const res = await fetch('/api/quickbooks/field-sheet-invoice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wo_id: wo.id, from: bill.from, to: bill.to, imported: true, total: sheetBillTotal(bill), date }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fix?: string };
    return res.ok && j.ok ? null : [j.error ?? "Couldn't mark it billed.", j.fix].filter(Boolean).join(' ');
  } catch {
    return "Couldn't reach the app. Check your connection.";
  }
}

/** Who is filling in NetView's form: the signed-in office user. */
function useMe(enabled: boolean) {
  const [me, setMe] = useState({ name: '', email: '' });
  useEffect(() => {
    if (!enabled) return;
    void createClient().auth.getUser().then(({ data }) => {
      const u = data.user;
      const meta = (u?.user_metadata ?? {}) as { full_name?: string; name?: string };
      setMe({ name: meta.full_name || meta.name || '', email: u?.email ?? '' });
    });
  }, [enabled]);
  return me;
}

/**
 * NetView's form for a bill in the import file, with the file's invoice number,
 * date and total, so the two match (Fred, 2026-10-25: "each site their own
 * bill and netview link to matched").
 */
const importNetviewLink = (wo: EnrichedWorkOrder, bill: QboSheetBill, me: { name: string; email: string }, date: string) => netviewFormUrl(netviewAnswers({
  job: wo,
  invoice: { number: sheetInvoiceNumber(bill.woNumber, bill.from), total: sheetBillTotal(bill), date, from: bill.from, to: bill.to },
  vendor: 'FAJ Solutions', enteredBy: me.name, email: me.email,
}));

/** A NetView job, counting the client the sheet bills (the bill's customer). */
const netviewBill = (m: MadeBill) => isNetviewJob(m.wo, m.bill.customerName);
type MadeBill = { wo: EnrichedWorkOrder; bill: QboSheetBill };

/**
 * The bills just put in an import file: each with Imported, to press once
 * QuickBooks has taken it, and its NetView form when it is a NetView job.
 */
function MadeBills({ made, date, me, netview, onMarked }: {
  made: MadeBill[]; date: string; me: { name: string; email: string }; netview?: boolean; onMarked: () => void;
}) {
  const [marked, setMarked] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  if (!made.length) return null;
  const mark = async (m: MadeBill, number: string) => {
    const dates = m.bill.from === m.bill.to ? fmtDay(m.bill.from) : `${fmtDay(m.bill.from)} – ${fmtDay(m.bill.to)}`;
    if (!window.confirm(`Did QuickBooks import invoice ${number}? ${dates} on ${jobName(m.wo)} will show as billed, and can't be billed again.`)) return;
    setBusy(number);
    try {
      const err = await markImported(m.wo, m.bill, date);
      if (err) { toastError(err); return; }
      setMarked((x) => [...x, number]);
      toastSuccess(`${number} is marked billed.`);
      onMarked();
    } finally {
      setBusy('');
    }
  };
  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
      <div className="wf-label">In the import file</div>
      {made.map((m) => {
        const number = sheetInvoiceNumber(m.bill.woNumber, m.bill.from);
        return (
          <div key={`${m.wo.id}-${m.bill.from}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span><b>{number}</b> · {jobName(m.wo)} · {fmtMoney(sheetBillTotal(m.bill))}</span>
            {marked.includes(number) ? <span className="wf-chip">Billed</span> : (
              <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={busy === number} onClick={() => void mark(m, number)}
                title="Press once QuickBooks has imported it, so these dates show as billed">
                {busy === number ? 'Marking…' : 'Imported'}
              </button>
            )}
            {(netview ?? netviewBill(m)) && (
              <a className="wf-btn wf-btn-outline wf-btn-sm" href={importNetviewLink(m.wo, m.bill, me, date)} target="_blank" rel="noopener noreferrer"
                title={`Opens NetView's payment form with this invoice filled in. Check it, then submit. The invoice itself goes to ${NETVIEW_PAYROLL}.`}>
                <ExternalLink size={14} /> Fill NetView form
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function FieldSheetView({ workOrders }: { workOrders: EnrichedWorkOrder[] }) {
  const [q, setQ] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('sheet') ?? ''));
  const [woId, setWoId] = useState<string | null>(null);
  const [week, setWeek] = useState<{ from: string; to: string } | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => {
    void createClient().from('field_sheets').select('wo_id, updated_at').order('updated_at', { ascending: false }).limit(12)
      .then(({ data }) => setOpened(((data as { wo_id: string }[] | null) ?? []).map((r) => r.wo_id)));
  }, []);
  // A link with ?sheet=19101402 opens that job straight away.
  useEffect(() => {
    if (woId || !q) return;
    const w = findJob(workOrders, q);
    if (w) setWoId(w.id);
  }, [workOrders]); // eslint-disable-line react-hooks/exhaustive-deps -- only on arrival, not while typing

  const pull = (e?: React.FormEvent) => {
    e?.preventDefault();
    const w = findJob(workOrders, q);
    if (!w) { toastError(`No work order ${q.trim()} found. Type the app's WO number, or the client's ticket or site number.`); return; }
    setWeek(null);
    setWoId(w.id);
  };
  const wo = woId ? workOrders.find((w) => w.id === woId) ?? null : null;
  // Quick picks: sheets already opened, then project sites, newest first.
  const picks = useMemo(() => {
    const byId = new Map(workOrders.map((w) => [w.id, w]));
    const list = [...opened.map((id) => byId.get(id)).filter((w): w is EnrichedWorkOrder => !!w),
      ...workOrders.filter((w) => w.is_project).sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''))];
    return [...new Map(list.map((w) => [w.id, w])).values()].slice(0, 10);
  }, [workOrders, opened]);

  return (
    <div className="wf" style={{ padding: 16, maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 className="wf-h1" style={{ margin: 0 }}>FAJ Solutions Field Sheet</h1>
        <div className="wf-subtle">One sheet per site, for any client. Pull a job by its work order number: each tech&apos;s days, hours, miles and receipts from the app, ready to fix, bill and send.</div>
      </div>
      <form onSubmit={pull} className="wf-card" style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="fs-wo" className="wf-label" style={{ flexBasis: '100%' }}>Work order number, client ticket or site number</label>
        <input id="fs-wo" className="wf-input" style={{ flex: '1 1 220px', minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="19101402 or LDS-1106 or 5006643" inputMode="search" autoComplete="off" />
        <button className="wf-btn wf-btn-navy" type="submit"><Search size={16} /> Pull it up</button>
        {picks.length > 0 && (
          <div style={{ flexBasis: '100%', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {picks.map((w) => (
              <button type="button" key={w.id} className={`wf-btn wf-btn-sm ${w.id === woId ? 'wf-btn-gold' : 'wf-btn-outline'}`}
                onClick={() => { setQ(w.wo_number); setWeek(null); setWoId(w.id); }}>
                WO {w.wo_number}{w.external_wo_id ? ` · ${w.external_wo_id}` : ''} · {jobName(w)}
              </button>
            ))}
          </div>
        )}
      </form>
      {!wo && <WeekToBill workOrders={workOrders} onOpen={(id, w) => { const job = workOrders.find((x) => x.id === id); if (job) setQ(job.wo_number); setWeek(w); setWoId(id); }} />}
      {!wo && <StillOnSite workOrders={workOrders} onOpen={(id) => { const w = workOrders.find((x) => x.id === id); if (w) setQ(w.wo_number); setWeek(null); setWoId(id); }} />}
      {wo ? <Sheet key={wo.id} wo={wo} week={week} onOpened={() => setOpened((o) => (o.includes(wo.id) ? o : [wo.id, ...o]))} /> : (
        <Section title="Pick a job">
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            Type the work order number above. The sheet comes up with every day the techs logged in the app. Fix any time,
            mile or hour by typing over it, add a day the app missed, and approve or decline the receipts. Pick the client
            and how they pay, then finish the week: it goes into QuickBooks as an invoice and can be emailed to the client.
            Your changes are kept here; what the techs tapped is never changed.
          </div>
        </Section>
      )}
    </div>
  );
}

/**
 * The week to bill (lib/week-to-bill.ts): every site with work that week, what
 * still needs an invoice first. Opening one shows its sheet on that week.
 */
function WeekToBill({ workOrders, onOpen }: { workOrders: EnrichedWorkOrder[]; onOpen: (id: string, week: { from: string; to: string }) => void }) {
  const [week, setWeek] = useState(() => weekToBillFor(dayOf(new Date().toISOString(), TZ)));
  const [sites, setSites] = useState<WeekSite[] | null>(null);
  // Bumped when a bill is marked imported, to load the week again.
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    const db = createClient();
    const w = tapWindow(week.from, week.to);
    void Promise.all([
      db.from('job_day_events').select('wo_id, at').gte('at', w.gte).lt('at', w.lt),
      db.from('job_punches').select('wo_id, at').gte('at', w.gte).lt('at', w.lt),
      db.from('field_sheet_days').select('wo_id, day, hidden').gte('day', week.from).lte('day', week.to),
      db.from('field_sheet_invoices').select('wo_id, from_day, to_day, qbo_invoice_id, qbo_invoice_number, created_at').lte('from_day', week.to).gte('to_day', week.from),
    ]).then(([d, p, t, i]) => {
      if (!live) return;
      if (d.error || p.error) { toastError("Couldn't load the week's taps. Refresh to try again."); setSites([]); return; }
      setSites(weekSites({
        from: week.from, to: week.to, timeZone: TZ,
        taps: [...((d.data as WeekTap[] | null) ?? []), ...((p.data as WeekTap[] | null) ?? [])],
        typed: (t.data as WeekTyped[] | null) ?? [], invoices: (i.data as WeekInvoice[] | null) ?? [],
      }));
    });
    return () => { live = false; };
  }, [week, reload]);
  const byId = useMemo(() => new Map(workOrders.map((w) => [w.id, w])), [workOrders]);
  const shown = (sites ?? []).filter((s) => byId.has(s.woId));
  const left = shown.filter((s) => s.status !== 'billed').length;
  const move = (n: number) => setWeek((w) => { const f = new Date(Date.parse(`${w.from}T12:00:00Z`) + n * 7 * 86_400_000).toISOString().slice(0, 10); return { from: f, to: new Date(Date.parse(`${f}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10) }; });
  const [making, setMaking] = useState(false);
  // The bills in the last file made, for the week it was made for, and the day it was made.
  const [made, setMade] = useState<{ week: string; date: string; list: MadeBill[] }>({ week: '', date: '', list: [] });
  const toBill = shown.filter((s) => s.status !== 'billed');
  const me = useMe(made.list.some(netviewBill));
  // Every site still to bill, each as the server bills it, in the order worked: the site's first day
  // that week (a bill for the week starts on the week's first day, whatever day the work did), then WO number.
  const weekBills = async () => {
    const done: (MadeBill & { first: string })[] = [];
    const skipped: string[] = [];
    for (const s of toBill) {
      const w = byId.get(s.woId)!;
      const r = await sheetBill(w, week.from, week.to);
      if ('bill' in r) done.push({ wo: w, bill: r.bill, first: s.days[0] ?? r.bill.from }); else skipped.push(`WO ${w.wo_number}: ${r.error}`);
    }
    done.sort((a, b) => a.first.localeCompare(b.first) || a.wo.wo_number.localeCompare(b.wo.wo_number, undefined, { numeric: true }));
    for (const m of skipped) toastError(m);
    if (!done.length && !skipped.length) toastError('Nothing to bill this week.');
    return done;
  };
  const importWeek = async () => {
    setMaking(true);
    try {
      const done = await weekBills();
      const bills = done.map((d) => d.bill);
      const date = dayOf(new Date().toISOString(), TZ);
      setMade({ week: week.from, date, list: done });
      if (bills.length) {
        downloadImport(bills, `QuickBooks import ${week.from} to ${week.to}`, date);
        toastSuccess(`${bills.length} invoice${bills.length === 1 ? '' : 's'} in the file. ${IMPORT_HOW}`);
      }
    } finally {
      setMaking(false);
    }
  };
  // The same bills in Excel, each site on its own tab (Fred, 2026-10-25: "each site on a separate page").
  const excelWeek = async () => {
    setMaking(true);
    try {
      const done = await weekBills();
      if (!done.length) return;
      const site = (w: EnrichedWorkOrder) => [w.site_name || w.title, [w.site_city, w.site_state].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
      await downloadXLSXBook(`${fileSafe(`Bills ${week.from} to ${week.to}`)}.xlsx`, siteBillBook(
        done.map(({ wo: w, bill }) => ({ name: w.site_city || jobName(w), site: site(w), clientWo: w.external_wo_id ?? null, bill })),
        dayOf(new Date().toISOString(), TZ),
      ));
    } finally {
      setMaking(false);
    }
  };
  const WORD = { to_bill: 'To bill', partly: 'Partly billed', billed: 'Billed' } as const;
  const COLOR = { to_bill: '#B45309', partly: '#8a6d2b', billed: '#2F7D4F' } as const;
  return (
    <Section title="Week to bill" subtitle={`${fmtDay(week.from)} – ${fmtDay(week.to)}${sites ? ` · ${left ? `${left} to bill` : 'all billed'}` : ''}`}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => move(-1)}>← Week before</button>
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => move(1)}>Week after →</button>
          {toBill.length > 0 && (
            <button type="button" className="wf-btn wf-btn-gold wf-btn-sm" disabled={making} onClick={() => void importWeek()}>
              <FileSpreadsheet size={16} /> {making ? 'Making the file…' : `QuickBooks import file (${toBill.length} site${toBill.length === 1 ? '' : 's'})`}
            </button>
          )}
          {toBill.length > 0 && (
            <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={making} onClick={() => void excelWeek()}>
              <FileSpreadsheet size={16} /> Excel, a tab per site
            </button>
          )}
        </div>
        <MadeBills key={`${made.week}-${made.date}-${made.list.length}`} made={made.week === week.from ? made.list : []} date={made.date} me={me} onMarked={() => setReload((n) => n + 1)} />
        {sites === null ? <div className="wf-subtle">Loading the week…</div>
          : shown.length === 0 ? <div className="wf-subtle">No techs logged work on any site this week.</div>
          : shown.map((s) => {
            const w = byId.get(s.woId)!;
            const techs = (w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter(Boolean).join(', ');
            return (
              <button type="button" key={s.woId} className="wf-card" onClick={() => onOpen(s.woId, week)}
                style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <span style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <b>WO {w.wo_number}</b>{w.external_wo_id ? ` · ${w.external_wo_id}` : ''} · {jobName(w)}
                  <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5 }}>
                    {[w.customer_name, techs, `${s.days.length} day${s.days.length === 1 ? '' : 's'}: ${s.days.map(fmtDay).join(', ')}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: COLOR[s.status], whiteSpace: 'nowrap' }}>
                  {WORD[s.status]}{s.invoices.length ? ` · invoice ${s.invoices.join(', ')}` : ''}{s.status === 'partly' ? ` · ${s.unbilled.length} day${s.unbilled.length === 1 ? '' : 's'} left` : ''}
                </span>
              </button>
            );
          })}
      </div>
    </Section>
  );
}

type Expense = {
  id: string; contractor_name: string | null; category: string; vendor: string | null; amount: number; expense_date: string;
  note: string | null; receipt_path: string | null; status: string; decline_reason: string | null;
  /** 'faj': a receipt the office added itself; it can be removed, not approved or declined. */
  paid_by?: string | null;
};
type Photo = { id: string; url: string; taken_at: string; contractor_name: string | null };
type Shot = { src: string; title: string; caption: string };

function Sheet({ wo, week, onOpened }: { wo: EnrichedWorkOrder; week?: { from: string; to: string } | null; onOpened: () => void }) {
  const db = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof loadEvents>>>([]);
  const [readings, setReadings] = useState<(OdoRow & { id: string })[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<SavedDay[]>([]);
  const [settings, setSettings] = useState<SheetSettings>(parseSettings({}));
  // Opened from the week to bill: already on that week.
  const [from, setFrom] = useState(week?.from ?? '');
  const [to, setTo] = useState(week?.to ?? '');
  const [showHidden, setShowHidden] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [zoom, setZoom] = useState<Shot | null>(null);
  const [customers, setCustomers] = useState<Client[]>([]);
  const [report, setReport] = useState(false);
  const [invoices, setInvoices] = useState<SheetInvoice[]>([]);
  // The rates as last saved: a failed save puts them back, so the totals never use an unsaved rate.
  const lastSettings = useRef<SheetSettings>(parseSettings({}));

  const sign = useCallback(async (paths: (string | null)[]) => {
    const list = paths.filter((p): p is string => !!p);
    if (!list.length) return;
    const { data: signed } = await db.storage.from('job-receipts').createSignedUrls(list, 60 * 60);
    const m: Record<string, string> = {};
    for (const x of signed ?? []) if (x.path && x.signedUrl) m[x.path] = x.signedUrl;
    setUrls((u) => ({ ...u, ...m }));
  }, [db]);
  const loadInvoices = useCallback(async () => {
    const { data } = await db.from('field_sheet_invoices')
      .select('id, from_day, to_day, customer_name, qbo_invoice_id, qbo_invoice_number, total, sent_to, sent_at, created_at, invoice_date').eq('wo_id', wo.id).order('from_day');
    setInvoices((data as SheetInvoice[] | null) ?? []);
  }, [db, wo.id]);
  const loadExpenses = useCallback(async () => {
    const cols = 'id, contractor_name, category, vendor, amount, expense_date, note, receipt_path, status, decline_reason';
    const pick = (c: string) => db.from('job_expenses').select(c).eq('wo_id', wo.id).order('expense_date');
    const res = await pick(`${cols}, paid_by`).then((r) => (r.error ? pick(cols) : r));
    const list = ((res.data as unknown as Expense[] | null) ?? []).map((e) => ({ ...e, amount: Number(e.amount) }));
    setExpenses(list);
    await sign(list.map((e) => e.receipt_path));
    return list;
  }, [db, wo.id, sign]);

  useEffect(() => {
    void (async () => {
      const [ev, od, , ph, fs, days, us] = await Promise.all([
        loadEvents([wo.id]),
        db.from('job_odometer').select('id, wo_id, contractor_name, at, moment, reading, ai_reading, photo_path').eq('wo_id', wo.id).order('at'),
        loadExpenses(),
        db.from('wo_photos').select('id, url, taken_at, contractor_name').eq('wo_id', wo.id).order('taken_at'),
        db.from('field_sheets').select('settings').eq('wo_id', wo.id).maybeSingle(),
        db.from('field_sheet_days').select('id, day, tech, edits, added, hidden').eq('wo_id', wo.id),
        db.from('user_settings').select('mileage_rate').maybeSingle(),
        loadInvoices(),
        db.from('customers').select('id, name, billing_email, default_mileage_rate, payment_terms').order('name')
          .then(({ data }) => setCustomers((data as Client[] | null) ?? [])),
      ]);
      setEvents(ev);
      const odo = ((od.data as (OdoRow & { id: string })[] | null) ?? []).map((o) => ({ ...o, reading: Number(o.reading), ai_reading: o.ai_reading == null ? null : Number(o.ai_reading) }));
      setReadings(odo);
      setPhotos((ph.data as Photo[] | null) ?? []);
      const s = parseSettings((fs.data as { settings?: unknown } | null)?.settings);
      const start = withAccountRate(s, (us.data as { mileage_rate?: unknown } | null)?.mileage_rate);
      setSettings(start);
      lastSettings.current = start;
      if (days.error) toastError("The field sheet isn't set up in the database yet (migration 136). Your changes won't save until it is.");
      setSaved(toSaved(days.data));
      await sign(odo.map((o) => o.photo_path));
      setLoading(false);
    })();
  }, [db, wo.id, loadExpenses, loadInvoices, sign]);

  const techs = useMemo(() => (wo.contractor_names?.length ? wo.contractor_names : [wo.contractor_name]).filter((t): t is string => !!t), [wo]);
  const allRows = useMemo(() => rowsFor({ events, readings, saved, techs, start: wo.start_date, end: wo.end_date, timeZone: TZ }),
    [events, readings, saved, techs, wo.start_date, wo.end_date]);
  const rows = useMemo(() => allRows.filter((r) => inDates(r.day, from, to)), [allRows, from, to]);
  // The weeks this site has days in, Sunday to Saturday, to bill one at a time.
  const weeks = useMemo(() => [...new Set(allRows.map((r) => weekOf(r.day)))].sort(), [allRows]);
  const visible = rows.filter((r) => showHidden || !r.hidden);
  const inRange = (d: string) => inDates(d, from, to);
  const receipts = expenses.filter((e) => inRange(e.expense_date));
  const billed: SheetReceipt[] = receipts.map((e) => ({ id: e.id, category: e.category, amount: e.amount, status: e.status, vendor: e.vendor, date: e.expense_date }));
  const totals = sheetTotals(rows, billed, settings);
  const allTechs = [...new Set([...techs, ...rows.map((r) => r.tech)])];

  // ── saving: one write at a time per line, and for the rates, so an older save can't land after a newer one ──
  const queues = useRef(new Map<string, Promise<void>>());
  const inTurn = (key: string, fn: () => Promise<void>) => {
    const p = (queues.current.get(key) ?? Promise.resolve()).then(fn, fn);
    queues.current.set(key, p);
    return p;
  };
  // A write that failed since the last flush. The screen has already gone back to what is saved.
  const failedSave = useRef(false);
  /** Wait for every change typed so far to reach the database; false if one didn't. The invoice is built from what is saved. */
  const flush = async () => {
    failedSave.current = false;
    await Promise.all([...queues.current.values()]);
    return !failedSave.current;
  };
  // After a failed write, show what is really saved.
  const reloadSaved = async () => {
    const { data } = await db.from('field_sheet_days').select('id, day, tech, edits, added, hidden').eq('wo_id', wo.id);
    setSaved(toSaved(data));
  };
  const store = (row: SheetRow, patch: { edits?: SavedDay['edits']; hidden?: boolean }) => {
    const next: SavedDay = {
      id: row.id ?? `new-${row.key}`, day: row.day, tech: row.tech,
      edits: patch.edits ?? row.edits, added: row.added || !row.app, hidden: patch.hidden ?? row.hidden,
    };
    setSaved((list) => [...list.filter((s) => !(s.day === row.day && s.tech === row.tech)), next]);
    return inTurn(row.key, async () => {
      const { data, error } = await db.from('field_sheet_days')
        .upsert({ wo_id: wo.id, day: next.day, tech: next.tech, edits: next.edits, added: next.added, hidden: next.hidden, updated_at: new Date().toISOString() },
          { onConflict: 'wo_id,tech,day' })
        .select('id').single();
      if (error) { failedSave.current = true; toastError("That change didn't save. Check your connection and try again."); await reloadSaved(); return; }
      setSaved((list) => list.map((s) => (s.day === next.day && s.tech === next.tech ? { ...s, id: (data as { id: string }).id } : s)));
      onOpened();
    });
  };
  const setField = (row: SheetRow, field: SheetField, value: string | number | boolean | null) => {
    const edits = nextEdits(row, field, value);
    if (JSON.stringify(edits) === JSON.stringify(row.edits)) return;
    void store(row, { edits });
  };
  const undo = (row: SheetRow) => {
    if (!row.id) return;
    setSaved((list) => list.filter((s) => !(s.day === row.day && s.tech === row.tech)));
    return inTurn(row.key, async () => {
      const { error } = await db.from('field_sheet_days').delete().eq('wo_id', wo.id).eq('tech', row.tech).eq('day', row.day);
      if (error) { failedSave.current = true; toastError("Couldn't undo that. Check your connection."); await reloadSaved(); }
    });
  };
  const saveSettings = (patch: Partial<SheetSettings>) => {
    const next = { ...settings, ...patch };
    if (JSON.stringify(next) === JSON.stringify(settings)) return Promise.resolve();
    setSettings(next);
    return inTurn('settings', async () => {
      const { error } = await db.from('field_sheets').upsert({ wo_id: wo.id, settings: next, updated_at: new Date().toISOString() }, { onConflict: 'wo_id' });
      if (error) { failedSave.current = true; toastError("That didn't save, so it's back to what it was. Check your connection."); setSettings(lastSettings.current); return; }
      lastSettings.current = next;
      onOpened();
    });
  };
  /** A receipt the office added itself: removed with its file, the same as in WorkFlow. */
  const removeOffice = async (e: Expense) => {
    if (!window.confirm(`Remove the ${fmtMoney(e.amount)} ${expenseCategoryLabel(e.category).toLowerCase()} receipt?`)) return;
    const res = await fetch(`/api/owner/expense?id=${encodeURIComponent(e.id)}`, { method: 'DELETE' });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !j.ok) { toastError(j.error ?? "Couldn't remove it."); return; }
    toastSuccess('Receipt removed.');
    await loadExpenses();
  };
  const decide = async (e: Expense, approve: boolean) => {
    let reason: string | null = null;
    if (!approve) {
      reason = window.prompt(`Decline ${fmtMoney(e.amount)} from ${e.contractor_name ?? 'the tech'}? Tell them why (optional):`, '');
      if (reason === null) return;
    }
    const { data, error } = await db.rpc('wf_owner_decide_expense', { p_id: e.id, p_approve: approve, p_reason: reason });
    const res = (data ?? {}) as { ok?: boolean; reason?: string };
    if (error || !res.ok) { toastError(error ? "Couldn't save that. Check your connection." : expenseReasonText(res.reason ?? '')); return; }
    toastSuccess(approve ? `Approved ${fmtMoney(e.amount)}.` : `Declined ${fmtMoney(e.amount)}. It's off the bill.`);
    await loadExpenses();
  };
  const excel = async () => {
    const head = { title: `${jobName(wo)} — ${[wo.site_city, wo.site_state].filter(Boolean).join(', ')}${from || to ? ` · ${from ? fmtDay(from) : '…'} – ${to ? fmtDay(to) : '…'}` : ''}`, wo: wo.wo_number, clientWo: wo.external_wo_id, address: address(wo) };
    const rec: (string | number)[][] = [['Date', 'Technician', 'For', 'Store', 'Amount', 'Status', 'Note']];
    for (const e of receipts) rec.push([e.expense_date, e.contractor_name ?? '', expenseCategoryLabel(e.category), e.vendor ?? '', e.amount, STATUS_WORD[e.status] ?? e.status, e.decline_reason ?? e.note ?? '']);
    await downloadXLSXBook(`${fileSafe(`WO ${wo.wo_number} ${wo.external_wo_id ?? ''} ${jobName(wo)}`)}.xlsx`, [
      { name: 'Field sheet', rows: fieldSheetRows(head, rows, totals, settings), colWidths: [11, 40, 12, 12, 11, 12, 8, 9, 9, 9, 11, 11, 9, 9, 11, 11, 50] },
      { name: 'Receipts', rows: rec, colWidths: [11, 18, 18, 18, 10, 10, 40] },
    ]);
  };

  // ── photos ────────────────────────────────────────────────────────────────
  const shots: { group: string; list: Shot[] }[] = [
    { group: 'Odometer', list: readings.filter((o) => o.photo_path && urls[o.photo_path] && inRange(dayOf(o.at, TZ)))
      .map((o) => ({ src: urls[o.photo_path!], title: `${o.contractor_name} · ${at(o.at)}`, caption: `${o.moment === 'end' ? 'End' : 'Start'} of drive: ${o.reading.toLocaleString('en-US')}` })) },
    { group: 'Receipts', list: receipts.filter((e) => e.receipt_path && urls[e.receipt_path])
      .map((e) => ({ src: urls[e.receipt_path!], title: `${e.contractor_name ?? 'Office'} · ${fmtDay(e.expense_date)}`, caption: `${expenseCategoryLabel(e.category)}${e.vendor ? `, ${e.vendor}` : ''}: ${fmtMoney(e.amount)}${e.status === 'declined' ? ' (declined)' : ''}` })) },
    { group: 'Job photos', list: photos.filter((p) => inRange(dayOf(p.taken_at, TZ)))
      .map((p) => ({ src: p.url, title: `${p.contractor_name ?? ''} · ${at(p.taken_at)}`, caption: '' })) },
  ];

  // The same photos with captions a client reads: what it shows first, then who and when.
  const clientPhotos = [
    { group: 'Receipts', list: receipts.filter((e) => e.status === 'approved' && e.receipt_path && urls[e.receipt_path])
      .map((e) => ({ src: urls[e.receipt_path!], caption: `${expenseCategoryLabel(e.category)}${e.vendor ? `, ${e.vendor}` : ''}: ${fmtMoney(e.amount)}`, title: fmtDay(e.expense_date) })) },
    { group: 'Mileage (odometer photos)', list: readings.filter((o) => o.photo_path && urls[o.photo_path] && inRange(dayOf(o.at, TZ)))
      .map((o) => ({ src: urls[o.photo_path!], caption: `Odometer ${o.reading.toLocaleString('en-US')} at the ${o.moment === 'end' ? 'end' : 'start'} of a drive`, title: `${o.contractor_name} · ${at(o.at)}` })) },
    { group: 'Photos from the site', list: photos.filter((p) => inRange(dayOf(p.taken_at, TZ))).map((p) => ({ src: p.url, caption: '', title: `${p.contractor_name ?? ''} · ${at(p.taken_at)}` })) },
  ];

  if (loading) return <Section title={`WO ${wo.wo_number}`}><div className="wf-subtle">Pulling the job from the app…</div></Section>;

  const approved = receipts.filter((e) => e.status === 'approved');
  const declined = receipts.filter((e) => e.status === 'declined');
  const waiting = receipts.filter((e) => e.status === 'submitted');
  return (
    <>
      <section className="wf-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <div className="wf-title" style={{ fontSize: 18 }}>{jobName(wo)}</div>
            <div className="wf-subtle" style={{ fontSize: 13 }}>
              {settings.client || wo.customer_name ? <b>{settings.client || wo.customer_name} · </b> : null}
              WO {wo.wo_number}{wo.external_wo_id ? ` · Client # ${wo.external_wo_id}` : ''}{wo.client_reference ? ` · Site ${wo.client_reference}` : ''} · {settings.site || address(wo)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => setReport(true)}><FileText size={16} /> Client report</button>
            <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => void excel()}><FileSpreadsheet size={16} /> Excel (Smartsheet)</button>
          </div>
        </div>
        <WeekPicker weeks={weeks} from={from} to={to} onPick={(f, t) => { setFrom(f); setTo(t); }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          <Stat label="Hours on site" value={hrs(totals.hours)} />
          <Stat label="Travel hours" value={hrs(totals.travel)} />
          <Stat label="Miles" value={mi(totals.miles)} />
          <Stat label="Labor" value={money(totals.labor)} />
          <Stat label="Mileage" value={money(totals.mileage)} />
          <Stat label="Meals + hotel" value={money(totals.meals.claim + totals.hotel.claim)} />
          <Stat label="Bill the client" value={money(totals.bill)} strong />
        </div>
      </section>

      <BillingPanel s={settings} wo={wo} customers={customers} onSave={(p) => void saveSettings(p)} />

      <DayForm techs={allTechs} rows={allRows} defaultDay={from || wo.start_date || dayOf(new Date().toISOString(), TZ)}
        photos={(day, tech) => [
          ...readings.filter((o) => o.photo_path && urls[o.photo_path] && o.contractor_name === tech && dayOf(o.at, TZ) === day)
            .map((o) => ({ src: urls[o.photo_path!], title: `${o.contractor_name} · ${at(o.at)}`, caption: `Odometer ${o.reading.toLocaleString('en-US')} (${o.moment === 'end' ? 'end' : 'start'} of drive)` })),
          ...photos.filter((ph) => (ph.contractor_name ?? '') === tech && dayOf(ph.taken_at, TZ) === day)
            .map((ph) => ({ src: ph.url, title: `${ph.contractor_name ?? ''} · ${at(ph.taken_at)}`, caption: '' })),
        ]}
        onZoom={setZoom}
        onSave={async (row, edits) => {
          // The day typed shows on the sheet even when it's outside the dates picked.
          if (from && row.day < from) setFrom(row.day);
          if (to && row.day > to) setTo(row.day);
          failedSave.current = false;
          await store(row, { edits });
          return !failedSave.current;
        }} />

      {(from || to) && rows.length < allRows.length && (
        <div className="wf-card" style={{ padding: '8px 12px', fontSize: 13.5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#FDF3E1' }}>
          Showing {from ? fmtDay(from) : 'the start'} – {to ? fmtDay(to) : 'the end'} only: {allRows.length - rows.length} more line{allRows.length - rows.length === 1 ? '' : 's'} on other days.
          <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => { setFrom(''); setTo(''); }}>Show every day</button>
        </div>
      )}

      <Section title="Days" subtitle={`${visible.filter((r) => !r.hidden).length} lines`} right={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {rows.some((r) => r.hidden) && (
            <label style={{ fontSize: 12.5, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden lines
            </label>
          )}
          <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => setAddOpen(true)}><Plus size={16} /> Add a day</button>
        </div>
      }>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, marginBottom: 8 }} className="wf-subtle">
          <span><Swatch bg={CELL.office} /> You typed it (clear it to go back to the app)</span>
          <span><Swatch bg={CELL.guess} /> Worked out from the drives: check it</span>
          <span><Swatch bg={CELL.missing} /> Nothing in the app</span>
          <span>Gray number: worked out for you, type over it to change it</span>
        </div>
        <div style={{ overflowX: 'auto', border: '1px solid var(--wf-line, #E4DFD3)', borderRadius: 10 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr>{['Day', 'Technician', 'Left hotel / home', 'Arrived on site', 'Left site', 'Back hotel / home', 'Lunch min', 'Hours on site', 'Travel hrs', 'Total',
                'Odometer start', 'Odometer end', 'GPS mi', 'Miles', 'Extra mi', 'Mileage $', 'Meals $', 'Spending $', 'Bills $', 'From the app / notes', 'Ask', ''].map((h) => <th key={h} style={TH}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map((r) => <DayLine key={r.key} r={r} s={settings} onSet={setField} onUndo={undo}
                onHide={(row) => void store(row, { hidden: !row.hidden })} />)}
              {visible.length === 0 && <tr><td colSpan={22} style={{ ...TD, padding: 14 }}>Nothing in the app for these dates yet. Press <b>Add a day</b> to type one.</td></tr>}
            </tbody>
            <tfoot>
              <tr style={{ background: '#F6F1E4', fontWeight: 700 }}>
                <td style={TD} colSpan={7}>Total · {totals.techDays} tech-days</td>
                <td style={TDN}>{hrs(totals.hours)}</td><td style={TDN}>{hrs(totals.travel)}</td><td style={TDN}>{hrs(totals.total)}</td>
                <td style={TD} colSpan={3} /><td style={TDN}>{mi(totals.miles)}</td><td style={TD} /><td style={TDN}>{money(totals.mileage)}</td>
                <td style={TD} colSpan={2} /><td style={TDN}>{money(totals.bill)}</td><td style={TD} colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <ClockPanel wo={wo} techs={allTechs} from={from} to={to} onChanged={() => void loadEvents([wo.id]).then(setEvents)} />

      <Section title="Receipts" subtitle={`${approved.length} approved${waiting.length ? ` · ${waiting.length} waiting for you` : ''}`} right={
        <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setReceiptOpen(true)}><Receipt size={16} /> Add a receipt</button>
      }>
        {waiting.length > 0 && <ReceiptList title="Waiting for you" list={waiting} urls={urls} onZoom={setZoom}
          actions={(e) => <><button className="wf-btn wf-btn-navy wf-btn-sm" onClick={() => void decide(e, true)}>Approve</button>
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void decide(e, false)}>Decline</button></>} />}
        <ReceiptList title="Approved: on the bill" list={approved} urls={urls} onZoom={setZoom}
          actions={(e) => (e.paid_by === 'faj'
            ? <><span className="wf-chip" style={{ alignSelf: 'center' }}>Paid by FAJ</span><button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void removeOffice(e)}>Remove</button></>
            : <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void decide(e, false)}>Decline</button>)} />
        <ReceiptList title="Declined: off the bill" list={declined} urls={urls} onZoom={setZoom} declined
          actions={(e) => <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void decide(e, true)}>Approve</button>} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12, fontSize: 13 }}>
          <div>Meals: {money(totals.meals.receipts)} in receipts{totals.meals.allowed != null ? `, up to ${money(totals.meals.allowed)} (${totals.techDays} tech-days)` : ''} → <b>{money(totals.meals.claim)}</b></div>
          <div>Hotel: {money(totals.hotel.receipts)} in receipts{totals.hotel.allowed != null ? `, up to ${money(totals.hotel.allowed)}` : ''} → <b>{money(totals.hotel.claim)}</b></div>
          <div className="wf-subtle">
            Not on the bill: fuel and mileage {money((totals.byCategory.fuel ?? 0) + (totals.byCategory.mileage ?? 0))} (in the mileage)
            {settings.receiptsAtCost ? '' : `, other receipts ${money(Object.entries(totals.byCategory).filter(([k]) => atCost(k)).reduce((t, [, v]) => t + v, 0))}`}, declined {money(totals.declined)}
          </div>
        </div>
      </Section>

      <FinishPanel wo={wo} s={settings} totals={totals} from={from} to={to} rows={rows} receipts={billed} invoices={invoices}
        allRows={allRows} allReceipts={expenses.map((e) => ({ id: e.id, category: e.category, amount: e.amount, status: e.status, vendor: e.vendor, date: e.expense_date }))}
        photoCount={shots.reduce((t, g) => t + g.list.length, 0)} flush={flush} onDone={() => void loadInvoices()} />

      <Section title="Photos" subtitle="time, place and GPS are stamped by the tech's phone">
        {shots.every((s) => s.list.length === 0) && <div className="wf-subtle" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Camera size={16} /> No photos on this job yet.</div>}
        {shots.filter((s) => s.list.length).map((s) => (
          <div key={s.group} style={{ marginBottom: 14 }}>
            <div className="wf-label" style={{ marginBottom: 6 }}>{s.group} ({s.list.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {s.list.map((p, i) => (
                <button key={`${s.group}-${i}`} type="button" onClick={() => setZoom(p)} className="wf-card"
                  style={{ padding: 0, overflow: 'hidden', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'zoom-in' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.src} alt={`${p.title} ${p.caption}`} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
                  <div style={{ padding: '6px 8px', fontSize: 12 }}><b>{p.title}</b>{p.caption && <div className="wf-subtle">{p.caption}</div>}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {addOpen && <AddDay techs={allTechs} rows={rows} defaultDay={wo.start_date ?? ''} onClose={() => setAddOpen(false)}
        onAdd={(day, tech) => { setAddOpen(false); void store({ key: `${day}|${tech}`, day, tech, id: null, added: true, hidden: false, missing: false, app: null, edits: {}, values: {} as SheetRow['values'], source: {} }, { edits: {} }); }} />}
      {report && (
        <FieldSheetReport site={settings.site || jobName(wo)} client={settings.client || wo.customer_name || ''} wo={wo.wo_number} clientWo={wo.external_wo_id}
          address={address(wo)} from={from || rows.filter((r) => !r.hidden).map((r) => r.day).sort()[0] || ''} to={to || rows.filter((r) => !r.hidden).map((r) => r.day).sort().at(-1) || ''}
          rows={rows} s={settings} totals={totals}
          receipts={approved.map((e) => ({ id: e.id, date: e.expense_date, category: e.category, vendor: e.vendor, amount: e.amount }))}
          photos={clientPhotos} onClose={() => setReport(false)} />
      )}
      {receiptOpen && <OfficeReceiptDialog woId={wo.id} onClose={() => setReceiptOpen(false)} onSaved={() => { setReceiptOpen(false); void loadExpenses(); }} />}
      {zoom && createPortal(
        <div className="wf wf-overlay" onClick={() => setZoom(null)} style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
          <div style={{ maxWidth: '96vw', maxHeight: '92vh', display: 'grid', gap: 8 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#fff' }}>
              <span>{zoom.title}{zoom.caption ? ` · ${zoom.caption}` : ''}</span>
              <button className="wf-btn wf-btn-sm" onClick={() => setZoom(null)} aria-label="Close"><X size={16} /></button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoom.src} alt={zoom.caption || zoom.title} style={{ maxWidth: '96vw', maxHeight: '84vh', objectFit: 'contain', borderRadius: 8 }} />
          </div>
        </div>, document.body)}
    </>
  );
}

type Client = { id: string; name: string; billing_email: string | null; default_mileage_rate: number | null; payment_terms: string | null };
type SheetInvoice = {
  id: string; from_day: string; to_day: string; customer_name: string; qbo_invoice_id: string | null; qbo_invoice_number: string | null; total: number | null;
  sent_to: string | null; sent_at: string | null; created_at: string;
  /** An imported file's invoice date (migration 143); empty: the day the row was made. */
  invoice_date?: string | null;
};

/** The Sunday a day's week starts on. */
export function weekOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Date(d.getTime() - d.getUTCDay() * 86_400_000).toISOString().slice(0, 10);
}
const addDays = (day: string, n: number) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** The dates billed: type the week's first and last day, or pick a week the site has days in. */
function WeekPicker({ weeks, from, to, onPick }: { weeks: string[]; from: string; to: string; onPick: (from: string, to: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
      <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">Week starts</span>
        <input type="date" className="wf-input" style={{ width: 150, minHeight: 34, padding: '4px 8px' }} value={from} onChange={(e) => onPick(e.target.value, to)} /></label>
      <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">Week ends</span>
        <input type="date" className="wf-input" style={{ width: 150, minHeight: 34, padding: '4px 8px' }} value={to} onChange={(e) => onPick(from, e.target.value)} /></label>
      {weeks.map((w) => {
        const end = addDays(w, 6), on = from === w && to === end;
        return (
          <button key={w} type="button" className={`wf-btn wf-btn-sm ${on ? 'wf-btn-gold' : 'wf-btn-outline'}`} onClick={() => onPick(w, end)}>
            Week of {fmtDay(w)}
          </button>
        );
      })}
      <button type="button" className={`wf-btn wf-btn-sm ${!from && !to ? 'wf-btn-gold' : 'wf-btn-ghost'}`} onClick={() => onPick('', '')}>Whole job</button>
    </div>
  );
}

/** A number box that saves when you leave it. */
function NumBox({ id, label, value, onSave, width = 110, placeholder = '–' }: {
  id: string; label: string; value: number | null; onSave: (v: number | null) => void; width?: number; placeholder?: string;
}) {
  return (
    <label htmlFor={id} style={{ display: 'grid', gap: 3, fontSize: 12 }}>
      <span className="wf-label">{label}</span>
      <input id={id} key={`${id}:${value ?? ''}`} className="wf-input" style={{ width, minHeight: 34, padding: '4px 8px' }} inputMode="decimal"
        defaultValue={value ?? ''} placeholder={placeholder}
        onBlur={(e) => { const v = num(e.target.value); if (v === undefined) { e.target.value = String(value ?? ''); toastError('Type a number, like 12.5'); return; } if (v !== value) onSave(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

function TextBox({ id, label, value, onSave, placeholder, list, width = 240 }: {
  id: string; label: string; value: string; onSave: (v: string) => void; placeholder?: string; list?: string; width?: number;
}) {
  return (
    <label htmlFor={id} style={{ display: 'grid', gap: 3, fontSize: 12, flex: `1 1 ${width}px`, minWidth: 0 }}>
      <span className="wf-label">{label}</span>
      <input id={id} key={`${id}:${value}`} className="wf-input" style={{ minHeight: 34, padding: '4px 8px', width: '100%' }} defaultValue={value}
        placeholder={placeholder} list={list} maxLength={200}
        onBlur={(e) => { const v = e.target.value.trim(); if (v !== value) onSave(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

/**
 * Who pays and how (Fred, 2026-10-24: "billing hours i can select client name ...
 * how much an hour or fix or blended or per item then there milage ... and what
 * the customer will pay for milage or meals or recite or hotel").
 */
function BillingPanel({ s, wo, customers, onSave }: { s: SheetSettings; wo: EnrichedWorkOrder; customers: Client[]; onSave: (p: Partial<SheetSettings>) => void }) {
  const pickClient = (name: string) => {
    const key = (x: string) => x.trim().toLowerCase();
    const same = key(name) === key(s.client || wo.customer_name || '');
    const c = customers.find((x) => key(x.name) === key(name));
    // Another client never keeps the last one's email: their invoice and photos would go to the wrong company.
    if (!c) { if (!same) onSave({ client: name, customerId: null, email: '' }); return; }
    onSave({
      client: c.name, customerId: c.id,
      email: same ? s.email || c.billing_email || '' : c.billing_email ?? '',
      mileRate: c.default_mileage_rate != null ? Number(c.default_mileage_rate) : s.mileRate,
    });
  };
  const client = customers.find((c) => c.id === s.customerId);
  const setItem = (i: number, p: Partial<BillItem>) => onSave({ items: s.items.map((it, j) => (j === i ? { ...it, ...p } : it)) });
  return (
    <Section title="Who pays and how" subtitle={s.client || wo.customer_name || 'pick the client'}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <TextBox id="fs-client" label="Client" value={s.client || wo.customer_name || ''} onSave={pickClient} placeholder="LDS, Wendy's…" list="fs-clients" />
          <datalist id="fs-clients">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          <TextBox id="fs-email" label="Client's billing email" value={s.email} onSave={(v) => onSave({ email: v })} placeholder="ap@client.com" />
          <TextBox id="fs-site" label="Site location (on the invoice)" value={s.site} onSave={(v) => onSave({ site: v })} placeholder={address(wo)} width={320} />
        </div>
        {client?.payment_terms && <div className="wf-subtle" style={{ fontSize: 12.5 }}>Payment terms: {client.payment_terms}</div>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label htmlFor="fs-labor" style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">Labor billed</span>
            <select id="fs-labor" className="wf-input" style={{ minHeight: 34, padding: '4px 8px' }} value={s.labor} onChange={(e) => onSave({ labor: e.target.value as LaborType })}>
              {LABOR_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          {s.labor === 'hourly' && <>
            <NumBox id="fs-rate" label="$ per hour on site" value={s.rate} onSave={(v) => onSave({ rate: v })} />
            <NumBox id="fs-travel" label="$ per travel hour" value={s.travelRate} onSave={(v) => onSave({ travelRate: v })} placeholder="not billed" />
          </>}
          {s.labor === 'blended' && <NumBox id="fs-rate" label="$ per hour, every hour" value={s.rate} onSave={(v) => onSave({ rate: v })} />}
          {s.labor === 'fixed' && <NumBox id="fs-fixed" label="Fixed price $" value={s.fixed} onSave={(v) => onSave({ fixed: v })} width={140} />}
          <NumBox id="fs-mile" label="$ per mile" value={s.mileRate} onSave={(v) => onSave({ mileRate: v })} />
        </div>
        {s.labor === 'items' && (
          <div style={{ display: 'grid', gap: 6 }}>
            {s.items.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <TextBox id={`fs-item-${i}`} label="Item" value={it.desc} onSave={(v) => setItem(i, { desc: v })} placeholder="Cat6A drop" />
                <NumBox id={`fs-qty-${i}`} label="Qty" value={it.qty} onSave={(v) => setItem(i, { qty: v ?? 0 })} width={80} />
                <NumBox id={`fs-price-${i}`} label="$ each" value={it.price} onSave={(v) => setItem(i, { price: v ?? 0 })} width={100} />
                <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" aria-label="Remove this item" onClick={() => onSave({ items: s.items.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <div><button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onSave({ items: [...s.items, { desc: '', qty: 1, price: 0 }] })}><Plus size={14} /> Add an item</button></div>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label htmlFor="fs-meals" style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">Meals</span>
            <select id="fs-meals" className="wf-input" style={{ minHeight: 34, padding: '4px 8px' }} value={s.mealMode} onChange={(e) => onSave({ mealMode: e.target.value as SheetSettings['mealMode'] })}>
              <option value="receipts">What was spent (receipts)</option>
              <option value="per_day">A flat amount per tech-day</option>
            </select>
          </label>
          <NumBox id="fs-meal-rate" label={s.mealMode === 'per_day' ? '$ per tech-day' : 'Up to $ per tech-day'} value={s.mealRate} onSave={(v) => onSave({ mealRate: v })} placeholder={s.mealMode === 'per_day' ? '–' : 'no cap'} />
          <label htmlFor="fs-hotel" style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">Hotel</span>
            <select id="fs-hotel" className="wf-input" style={{ minHeight: 34, padding: '4px 8px' }} value={s.hotelMode} onChange={(e) => onSave({ hotelMode: e.target.value as SheetSettings['hotelMode'] })}>
              <option value="receipts">The hotel receipts</option>
              <option value="per_night">A flat rate per room-night</option>
            </select>
          </label>
          <NumBox id="fs-hotel-rate" label={s.hotelMode === 'per_night' ? '$ per room-night' : 'Up to $ per room-night'} value={s.hotelRate} onSave={(v) => onSave({ hotelRate: v })} placeholder={s.hotelMode === 'per_night' ? '–' : 'no cap'} />
          <NumBox id="fs-nights" label="Nights" value={s.nights} onSave={(v) => onSave({ nights: v })} width={80} />
          <NumBox id="fs-rooms" label="Rooms" value={s.rooms} onSave={(v) => onSave({ rooms: v })} width={80} />
        </div>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
          <input type="checkbox" checked={s.receiptsAtCost} onChange={(e) => onSave({ receiptsAtCost: e.target.checked })} />
          Bill the other receipts at cost (materials, rental, tolls, equipment, travel, labor and your own categories). Fuel and mileage are in the mileage.
        </label>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
          <input type="checkbox" checked={s.byDay} onChange={(e) => onSave({ byDay: e.target.checked })} />
          Show each tech’s day on the invoice. Off, it has the totals: the hours, the mileage, the meals. The timesheet has the days.
        </label>
      </div>
    </Section>
  );
}

/**
 * Finish the week: the bill line by line, then QuickBooks (Fred, 2026-10-24:
 * "when i finish it then save and uploaded into quickbooks the same way ... and
 * sent off the client"; "thats what the customer gets along with the pictures").
 */
function FinishPanel({ wo, s, totals, from, to, rows, receipts, invoices, allRows, allReceipts, photoCount, flush, onDone }: {
  wo: EnrichedWorkOrder; s: SheetSettings; totals: SheetTotals; from: string; to: string; rows: SheetRow[]; receipts: SheetReceipt[];
  invoices: SheetInvoice[]; allRows: SheetRow[]; allReceipts: SheetReceipt[]; photoCount: number; flush: () => Promise<boolean>; onDone: () => void;
}) {
  const [send, setSend] = useState(true);
  // NetView pays from their own form, one entry per invoice (lib/netview-form.ts).
  const netview = isNetviewJob(wo, s.client);
  const me = useMe(netview);
  const netviewLink = (i: SheetInvoice) => {
    // The invoice's own total, else what the sheet bills for its dates; its own date (an imported file's), else the day it was made.
    const t = sheetTotals(allRows.filter((r) => inDates(r.day, i.from_day, i.to_day)), allReceipts.filter((e) => !!e.date && inDates(e.date, i.from_day, i.to_day)), s);
    return netviewFormUrl(netviewAnswers({
      job: wo,
      invoice: { number: i.qbo_invoice_number ?? '', total: Number(i.total ?? t.bill), date: i.invoice_date ?? dayOf(i.created_at, TZ), from: i.from_day, to: i.to_day },
      vendor: 'FAJ Solutions', enteredBy: me.name, email: me.email,
    }));
  };
  const [photos, setPhotos] = useState(true);
  // The timesheet PDF goes with the invoice (Fred, 2026-10-24: "so i can send it or attached to the quickbooks").
  const [timesheet, setTimesheet] = useState(true);
  const [busy, setBusy] = useState(false);
  const range = billRange(rows, receipts, from, to);
  const f = range?.from ?? '', t = range?.to ?? '';
  // One QuickBooks has, or one being created now; one that was cut off over ten minutes ago can be tried again.
  const already = range ? invoices.find((i) => blocksBilling(i) && overlaps(range, { from: i.from_day, to: i.to_day })) : undefined;
  const client = s.client || wo.customer_name || '';
  const email = s.email.trim();
  const create = async () => {
    setBusy(true);
    try {
      // The invoice is built from what is saved: wait for the last change typed, and stop if one didn't save.
      if (!(await flush())) { toastError("A change didn't save, so nothing was billed. Check the figures and try again."); return; }
      if (!window.confirm(`Create a ${fmtMoney(totals.bill)} invoice for ${client} in QuickBooks${send && email ? ` and email it to ${email}` : ''}?`)) return;
      const res = await fetch('/api/quickbooks/field-sheet-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wo_id: wo.id, from: from || undefined, to: to || undefined, send: send && !!email, photos: photos && photoCount > 0, timesheet }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean; dry_run?: boolean; error?: string; fix?: string; warning?: string; invoice_number?: string; total?: number;
        sent_to?: string | null; send_error?: string | null; write_back_error?: string | null; photos_attached?: number; photo_error?: string | null;
        timesheet_attached?: boolean; timesheet_error?: string | null;
      };
      if (!res.ok || j.error) { toastError([j.error ?? "Couldn't create the invoice.", j.fix].filter(Boolean).join(' ')); return; }
      if (j.dry_run) { toastError(j.warning ?? 'QuickBooks is not connected yet.'); return; }
      toastSuccess(`QuickBooks invoice ${j.invoice_number} for ${fmtMoney(j.total ?? totals.bill)} created${j.timesheet_attached ? ' with the timesheet' : ''}${j.photos_attached ? `${j.timesheet_attached ? ' and' : ' with'} ${j.photos_attached} photos` : ''}${j.sent_to ? ` and emailed to ${j.sent_to}` : ''}.`);
      for (const err of [j.send_error, j.timesheet_error, j.photo_error, j.write_back_error]) if (err) toastError(err);
      onDone();
    } catch {
      toastError("Couldn't reach the app. Check your connection.");
    } finally {
      setBusy(false);
    }
  };
  // The bill in the last file made, while the sheet still bills the same: a figure changed since makes it out of date.
  const [made, setMade] = useState<{ key: string; date: string; bill: QboSheetBill } | null>(null);
  const madeKey = `${totals.bill}|${from}|${to}`;
  const importSheet = async () => {
    setBusy(true);
    try {
      if (!(await flush())) { toastError("A change didn't save, so the file wasn't made. Check the figures and try again."); return; }
      const r = await sheetBill(wo, from, to);
      if ('error' in r) { toastError(r.error); return; }
      const date = dayOf(new Date().toISOString(), TZ);
      setMade({ key: madeKey, date, bill: r.bill });
      downloadImport([r.bill], `QuickBooks import WO ${wo.wo_number}`, date);
      toastSuccess(IMPORT_HOW);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Finish and bill" subtitle={f ? `${fmtDay(f)} – ${fmtDay(t)}` : 'no days yet'}>
      <div style={{ display: 'grid', gap: 12 }}>
        {totals.lines.length === 0 ? (
          <div className="wf-subtle" style={{ fontSize: 13.5 }}>Nothing to bill yet. Set how {client || 'the client'} pays above: the hourly rate, mileage, meals or hotel.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              <thead><tr>{['Description', 'Qty', 'Rate', 'Amount'].map((h) => <th key={h} style={{ ...TH, background: '#F6F1E4', color: 'inherit' }}>{h}</th>)}</tr></thead>
              <tbody>
                {totals.lines.map((l, i) => (
                  <tr key={i}><td style={{ ...TDN, textAlign: 'left', whiteSpace: 'normal' }}>{l.description}</td><td style={TDN}>{l.qty}</td><td style={TDN}>{fmtMoney(l.rate)}</td><td style={TDN}>{fmtMoney(l.amount)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td style={{ ...TDN, textAlign: 'left', fontWeight: 700 }} colSpan={3}>Total for {client || 'the client'}</td><td style={{ ...TDN, fontWeight: 700 }}>{fmtMoney(totals.bill)}</td></tr></tfoot>
            </table>
          </div>
        )}
        {already && <div style={{ fontSize: 13, color: '#B45309' }}>
          {already.qbo_invoice_id ? `These dates are already on QuickBooks invoice ${already.qbo_invoice_number ?? ''}. Pick another week.` : 'An invoice for these dates is being created. Refresh in a minute.'}
        </div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 13.5 }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={timesheet} onChange={(e) => setTimesheet(e.target.checked)} /> Attach the timesheet (PDF)
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={photos && photoCount > 0} onChange={(e) => setPhotos(e.target.checked)} disabled={photoCount === 0} /> {photoCount ? `Attach the ${photoCount} photos` : 'No photos to attach'}
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={send && !!email} onChange={(e) => setSend(e.target.checked)} disabled={!email} />
            {email ? `Email it to ${email}` : 'Add the client’s email above to send it'}
          </label>
          <button className="wf-btn wf-btn-navy" disabled={busy || totals.lines.length === 0 || !client || !!already} onClick={() => void create()}>
            <Send size={16} /> {busy ? 'Creating…' : 'Create the invoice in QuickBooks'}
          </button>
          <button className="wf-btn wf-btn-outline" disabled={busy || totals.lines.length === 0 || !client || !!already} onClick={() => void importSheet()}
            title="A file to import in QuickBooks yourself">
            <FileSpreadsheet size={16} /> QuickBooks import file
          </button>
        </div>
        {made?.key === madeKey && <MadeBills made={[{ wo, bill: made.bill }]} date={made.date} me={me} netview={netview} onMarked={onDone} />}
        {invoices.length > 0 && (
          <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            <div className="wf-label">Invoiced</div>
            {invoices.map((i) => (
              <div key={i.id}>
                {i.qbo_invoice_id ? <>QuickBooks invoice <b>{i.qbo_invoice_number || '—'}</b></> : blocksBilling(i) ? 'Being created in QuickBooks'
                  : i.qbo_invoice_number ? `Marking ${i.qbo_invoice_number} imported was cut off: make the QuickBooks import file again and press Imported`
                  : 'Cut off before QuickBooks answered: check QuickBooks, then create it again'} · {fmtDay(i.from_day)} – {fmtDay(i.to_day)}
                {i.total != null ? ` · ${fmtMoney(Number(i.total))}` : ''} · {i.customer_name}
                {i.qbo_invoice_id ? (i.sent_to ? ` · emailed to ${i.sent_to}` : ' · not emailed') : ''}
                {netview && i.qbo_invoice_id && (
                  <a className="wf-btn wf-btn-outline wf-btn-sm" style={{ marginLeft: 8 }} href={netviewLink(i)} target="_blank" rel="noopener noreferrer"
                    title={`Opens NetView's payment form with this invoice filled in. Check it, answer the last two questions, and Submit. The invoice itself also goes to ${NETVIEW_PAYROLL}.`}>
                    <ExternalLink size={14} /> Fill NetView form
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

const STATUS_WORD: Record<string, string> = { approved: 'Approved', declined: 'Declined', submitted: 'Waiting' };
const CELL = { office: '#FBF0D4', guess: '#E3EEFA', missing: '#FDE8D7', base: 'transparent' };
const TH: React.CSSProperties = { padding: '8px 6px', background: '#13284A', color: '#fff', fontSize: 11.5, fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const TD: React.CSSProperties = { padding: 0, borderTop: '1px solid #ECE8DF', verticalAlign: 'top' };
const TDN: React.CSSProperties = { ...TD, padding: '7px 6px', textAlign: 'right', whiteSpace: 'nowrap' };
const IN: React.CSSProperties = { width: '100%', minWidth: 0, border: 0, background: 'transparent', font: 'inherit', padding: '7px 6px', color: 'inherit' };

const address = (w: EnrichedWorkOrder) => [w.site_address, [w.site_city, [w.site_state, w.site_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');

/** field_sheet_days rows as the sheet keeps them. */
function toSaved(data: unknown): SavedDay[] {
  return ((data as { id: string; day: string; tech: string; edits: unknown; added: boolean; hidden: boolean }[] | null) ?? [])
    .map((d) => ({ ...d, edits: parseEdits(d.edits) }));
}

/** A typed number: '' → null (empty), junk → undefined (ignored). */
const FORM_FIELDS: { f: Exclude<SheetField, 'note' | 'ask'>; label: string; time?: boolean }[] = [
  { f: 'left', label: 'Left hotel / home', time: true }, { f: 'arrived', label: 'Arrived on site', time: true },
  { f: 'leftSite', label: 'Left site', time: true }, { f: 'back', label: 'Back hotel / home', time: true },
  { f: 'lunch', label: 'Lunch (minutes)' }, { f: 'hours', label: 'Hours on site' }, { f: 'travel', label: 'Travel hours' },
  { f: 'odoStart', label: 'Odometer start' }, { f: 'odoEnd', label: 'Odometer end' }, { f: 'miles', label: 'Miles' },
  { f: 'extraMiles', label: 'Extra miles' },
  { f: 'meals', label: 'Meals $' }, { f: 'spend', label: 'Spending $' },
];

/**
 * Enter a day (Fred, 2026-10-24: "i needs the fields to all be edited by me and
 * even if i pull from the app the day and time on site along with the pic").
 * Pick the day and the tech: what the app has fills in, every box can be
 * changed, and Save keeps it. Hours on site, travel and miles work themselves
 * out from the times and the odometer unless typed.
 */
function DayForm({ techs, rows, defaultDay, photos, onZoom, onSave }: {
  techs: string[]; rows: SheetRow[]; defaultDay: string;
  photos: (day: string, tech: string) => Shot[]; onZoom: (s: Shot) => void;
  onSave: (row: SheetRow, edits: SavedDay['edits']) => Promise<boolean>;
}) {
  const [day, setDay] = useState(defaultDay);
  const [tech, setTech] = useState(techs[0] ?? '');
  const key = `${day}|${tech.trim()}`;
  const row = rows.find((r) => r.key === key) ?? null;
  const blank = (): Record<string, string> => Object.fromEntries([...FORM_FIELDS.map(({ f }) => [f, '']), ['note', '']]);
  const fill = (r: SheetRow | null) => {
    const out = blank();
    if (!r) return out;
    for (const { f } of FORM_FIELDS) out[f] = r.values[f] == null ? '' : String(r.values[f]);
    out.note = r.values.note ?? '';
    return out;
  };
  const [vals, setVals] = useState<Record<string, string>>(() => fill(row));
  const [shownKey, setShownKey] = useState(key);
  const [busy, setBusy] = useState(false);
  // Another day or tech picked: show what's there for it.
  if (shownKey !== key) { setShownKey(key); setVals(fill(row)); }
  const c = dayCalc({
    ...(row?.values ?? ({} as SheetRow['values'])),
    ...Object.fromEntries(FORM_FIELDS.map(({ f, time }) => [f, time ? (vals[f] || null) : (num(vals[f]) ?? null)])),
    note: vals.note, ask: row?.values.ask ?? false,
  } as SheetRow['values'], 0);

  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { toastError('Pick the day.'); return; }
    if (!tech.trim()) { toastError('Pick the technician.'); return; }
    const bad = FORM_FIELDS.find(({ f, time }) => !time && num(vals[f]) === undefined);
    if (bad) { toastError(`${bad.label}: type a number, like 12.5`); return; }
    const base: SheetRow = row ?? { key, day, tech: tech.trim(), id: null, added: true, hidden: false, missing: false, app: null, edits: {}, values: {} as SheetRow['values'], source: {} };
    let edits = base.edits;
    for (const { f, time } of FORM_FIELDS) {
      const v = time ? (vals[f] || null) : num(vals[f]) ?? null;
      if (v === (base.values[f] ?? null)) continue;
      edits = nextEdits({ app: base.app, edits }, f, v);
    }
    if (vals.note.trim() !== (base.values.note ?? '')) edits = nextEdits({ app: base.app, edits }, 'note', vals.note.trim() || null);
    setBusy(true);
    const ok = await onSave(base, edits);
    setBusy(false);
    if (ok) toastSuccess(`Saved ${fmtDay(day)} for ${tech.trim()}.`);
  };
  const pics = photos(day, tech.trim());
  const box: React.CSSProperties = { display: 'grid', gap: 3, fontSize: 12, minWidth: 0 };
  return (
    <Section title="Enter a day" subtitle={row?.app ? 'From the app: change anything, then Save.' : row ? 'Saved: change anything, then Save.' : 'Nothing saved for this day yet: type it in, then Save.'}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          <label style={box}><span className="wf-label">Day</span>
            <input type="date" className="wf-input" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" /></label>
          <label style={box}><span className="wf-label">Technician</span>
            <input className="wf-input" list="fs-form-techs" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Technician" />
            <datalist id="fs-form-techs">{techs.map((t) => <option key={t} value={t} />)}</datalist></label>
          {FORM_FIELDS.map(({ f, label, time }) => {
            const auto = f === 'hours' ? c.hoursAuto : f === 'travel' ? c.travelAuto : f === 'miles' ? c.milesAuto : null;
            return (
              <label key={f} style={box}><span className="wf-label">{label}</span>
                <input className="wf-input" type={time ? 'time' : 'text'} inputMode={time ? undefined : 'decimal'} value={vals[f]}
                  placeholder={auto ? `${auto}${f === 'miles' ? ' mi' : ' h'} worked out` : ''} aria-label={label}
                  onChange={(e) => setVals((x) => ({ ...x, [f]: e.target.value }))} /></label>
            );
          })}
        </div>
        <label style={box}><span className="wf-label">Notes for this day</span>
          <textarea className="wf-input" rows={2} value={vals.note} onChange={(e) => setVals((x) => ({ ...x, note: e.target.value }))} aria-label="Notes for this day" /></label>
        {pics.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pics.map((p, i) => (
              <button key={i} type="button" onClick={() => onZoom(p)} style={{ border: 0, padding: 0, background: 'none', cursor: 'zoom-in' }} aria-label={`See photo ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8 }} />
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="wf-btn wf-btn-navy" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save this day'}</button>
          <span className="wf-subtle" style={{ fontSize: 13 }}>
            {hrs(c.hours)} h on site · {hrs(c.travel)} h travel · {mi(c.miles)} mi
          </span>
        </div>
      </div>
    </Section>
  );
}

function num(s: string): number | null | undefined {
  const t = s.replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function Swatch({ bg }: { bg: string }) {
  return <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 2, background: bg, border: '1px solid #D8D2C4', verticalAlign: -1, marginRight: 4 }} />;
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 10, background: strong ? '#F6F1E4' : 'var(--wf-bg-soft, #F7F6F2)', display: 'grid', gap: 2 }}>
      <span className="wf-label" style={{ fontSize: 11 }}>{label}</span>
      <b style={{ fontSize: 18, color: strong ? '#8A6D2F' : undefined, fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </div>
  );
}

function DayLine({ r, s, onSet, onUndo, onHide }: {
  r: SheetRow; s: SheetSettings; onSet: (r: SheetRow, f: SheetField, v: string | number | boolean | null) => void;
  onUndo: (r: SheetRow) => void; onHide: (r: SheetRow) => void;
}) {
  const v = r.values, c = dayCalc(v, s.mileRate ?? 0);
  const bg = (f: SheetField) => (r.source[f] === 'office' ? CELL.office : r.source[f] === 'guess' ? CELL.guess : CELL.base);
  const time = (f: 'left' | 'arrived' | 'leftSite' | 'back') => (
    <td style={{ ...TD, background: bg(f), minWidth: 104 }} title={r.source[f] === 'guess' ? 'Worked out from the drives. Check it.' : undefined}>
      <input key={`${f}:${v[f] ?? ''}`} type="time" style={IN} defaultValue={v[f] ?? ''} aria-label={`${f} ${r.tech} ${r.day}`}
        onBlur={(e) => { if ((e.target.value || null) !== (v[f] ?? null)) onSet(r, f, e.target.value || null); }} />
    </td>
  );
  const number = (f: 'lunch' | 'odoStart' | 'odoEnd' | 'gps' | 'hours' | 'travel' | 'miles' | 'extraMiles' | 'meals' | 'spend', auto?: string, width = 76) => (
    <td style={{ ...TD, background: bg(f), minWidth: width }}>
      <input key={`${f}:${v[f] ?? ''}`} style={{ ...IN, textAlign: 'right' }} inputMode="decimal" defaultValue={v[f] ?? ''} placeholder={auto ?? ''}
        aria-label={`${f} ${r.tech} ${r.day}`}
        onBlur={(e) => { const n = num(e.target.value); if (n === undefined) { e.target.value = String(v[f] ?? ''); toastError('Type a number, like 12.5'); return; } if (n !== v[f]) onSet(r, f, n); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </td>
  );
  const rowBg = r.hidden ? '#F1F1F1' : r.missing || v.ask ? CELL.missing : undefined;
  return (
    <tr style={{ background: rowBg, opacity: r.hidden ? 0.6 : 1 }}>
      <td style={{ ...TDN, textAlign: 'left', fontWeight: 600 }}>{fmtDay(r.day)}</td>
      <td style={{ ...TDN, textAlign: 'left', fontWeight: 600 }}>{r.tech}{r.added && <div className="wf-subtle" style={{ fontWeight: 400, fontSize: 11 }}>added by you</div>}</td>
      {time('left')}{time('arrived')}{time('leftSite')}{time('back')}
      {number('lunch', '0', 64)}
      {number('hours', c.hoursAuto.toFixed(2))}
      {number('travel', c.travelAuto.toFixed(2))}
      <td style={TDN}>{hrs(c.total)}</td>
      {number('odoStart', undefined, 92)}{number('odoEnd', undefined, 92)}{number('gps', undefined, 68)}
      {number('miles', c.milesAuto.toFixed(1), 68)}
      {number('extraMiles', '0', 64)}
      <td style={TDN}>{money(c.mileage)}</td>
      {number('meals', s.mealMode === 'per_day' ? (c.worked && s.mealRate ? String(s.mealRate) : '') : '0.00', 76)}
      {number('spend', '0.00', 76)}
      <td style={{ ...TDN, fontWeight: 600 }}>{money(dayBill(c, s, v))}</td>
      <td style={{ ...TD, minWidth: 280, background: bg('note') }}>
        {r.missing && <div style={{ padding: '6px 6px 0', fontSize: 12, fontWeight: 600, color: '#9A4A12' }}>Nothing in the app for this day.</div>}
        {r.app?.drives && <div className="wf-subtle" style={{ padding: '6px 6px 0', fontSize: 11.5 }}>{r.app.drives}</div>}
        <textarea key={`note:${v.note}`} rows={1} style={{ ...IN, resize: 'vertical', fontSize: 12.5 }} defaultValue={v.note} placeholder="Your note"
          aria-label={`Note ${r.tech} ${r.day}`} onBlur={(e) => { if (e.target.value.trim() !== v.note) onSet(r, 'note', e.target.value.trim() || null); }} />
      </td>
      <td style={{ ...TD, textAlign: 'center', padding: 6 }}>
        <input type="checkbox" checked={v.ask} aria-label={`Ask ${r.tech} about ${r.day}`} onChange={(e) => onSet(r, 'ask', e.target.checked)} />
      </td>
      <td style={{ ...TD, padding: 4, whiteSpace: 'nowrap' }}>
        {r.id && !r.added && Object.keys(r.edits).length > 0 && (
          <button className="wf-btn wf-btn-ghost wf-btn-sm" title="Undo your changes on this line" aria-label="Undo your changes on this line" onClick={() => onUndo(r)}><RotateCcw size={14} /></button>
        )}
        {r.added
          ? <button className="wf-btn wf-btn-ghost wf-btn-sm" title="Delete this line" aria-label="Delete this line" onClick={() => onUndo(r)}><Trash2 size={14} /></button>
          : <button className="wf-btn wf-btn-ghost wf-btn-sm" title={r.hidden ? 'Show this line again' : 'Hide this line from the sheet and the bill'} aria-label={r.hidden ? 'Show this line' : 'Hide this line'} onClick={() => onHide(r)}><EyeOff size={14} /></button>}
      </td>
    </tr>
  );
}

function ReceiptList({ title, list, urls, onZoom, actions, declined = false }: {
  title: string; list: Expense[]; urls: Record<string, string>; onZoom: (s: Shot) => void; actions: (e: Expense) => React.ReactNode; declined?: boolean;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="wf-label" style={{ marginBottom: 6, color: declined ? '#B3261E' : undefined }}>{title} ({list.length})</div>
      {list.length === 0 ? <div className="wf-subtle" style={{ fontSize: 13 }}>None.</div> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {list.map((e) => {
            const src = e.receipt_path ? urls[e.receipt_path] : null;
            return (
              <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px', borderRadius: 8,
                background: declined ? '#F8E1DF' : 'var(--wf-bg-soft, #F7F6F2)' }}>
                {src ? (
                  <button type="button" onClick={() => onZoom({ src, title: `${e.contractor_name ?? 'Office'} · ${fmtDay(e.expense_date)}`, caption: `${expenseCategoryLabel(e.category)}: ${fmtMoney(e.amount)}` })}
                    style={{ border: 0, padding: 0, background: 'none', cursor: 'zoom-in' }} aria-label="See the receipt photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                  </button>
                ) : <span className="wf-subtle" style={{ width: 40, fontSize: 10, textAlign: 'center' }}>no photo</span>}
                <span style={{ flex: '1 1 220px', minWidth: 0, textDecoration: declined ? 'line-through' : undefined }}>
                  <b>{fmtMoney(e.amount)}</b> {expenseCategoryLabel(e.category)}{e.vendor ? `, ${e.vendor}` : ''} · {fmtDay(e.expense_date)} · {e.contractor_name ?? 'Office'}
                  {(e.decline_reason || e.note) && <span className="wf-subtle" style={{ display: 'block', fontSize: 12, textDecoration: 'none' }}>{e.decline_reason ?? e.note}</span>}
                </span>
                <span style={{ display: 'flex', gap: 6 }}>{actions(e)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddDay({ techs, rows, defaultDay, onClose, onAdd }: {
  techs: string[]; rows: SheetRow[]; defaultDay: string; onClose: () => void; onAdd: (day: string, tech: string) => void;
}) {
  const [day, setDay] = useState(defaultDay);
  const [tech, setTech] = useState(techs[0] ?? '');
  const taken = rows.some((r) => r.day === day && r.tech === tech.trim());
  return createPortal(
    <div className="wf wf-overlay" onClick={onClose}>
      <form className="wf-dialog" role="dialog" aria-modal="true" aria-label="Add a day" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (day && tech.trim() && !taken) onAdd(day, tech.trim()); }}>
        <h2 className="wf-title" style={{ marginBottom: 12 }}>Add a day</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label><span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>Day</span>
            <input type="date" className="wf-input" value={day} onChange={(e) => setDay(e.target.value)} required /></label>
          <label><span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>Technician</span>
            <input className="wf-input" list="fs-techs" value={tech} onChange={(e) => setTech(e.target.value)} maxLength={120} required /></label>
          <datalist id="fs-techs">{techs.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        {taken && <div style={{ marginTop: 8, fontSize: 13, color: '#B45309' }}>{tech} already has a line for that day. Type into it on the sheet.</div>}
        <div className="save-bar">
          <button type="button" className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="wf-btn wf-btn-navy" disabled={!day || !tech.trim() || taken}><Plus size={16} /> Add the day</button>
        </div>
      </form>
    </div>, document.body);
}

