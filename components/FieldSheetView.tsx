'use client';
// Office → Field Sheet (Fred, 2026-10-24: "add it under office and i can pull
// it by the app work order number and edit whats needed"). Type a WO number
// (or the client's ticket or site number) and the job's week comes up, one line
// per tech per day from the techs' taps, with the office's own figures on top
// (lib/field-sheet.ts, migration 136). Every figure can be typed over. Receipts
// are approved or declined here the same way as in WorkFlow, a declined one
// moves to its own list and leaves the bill, and the odometer, receipt and job
// photos are at the bottom. Excel for the client or Smartsheet.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, EyeOff, FileSpreadsheet, Plus, Receipt, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { buildDayLogs, dayOf } from '@/lib/project-day';
import { matchOdometer, type OdoRow } from '@/lib/weekly-bill';
import {
  appDays, dayCalc, fieldSheetRows, jobDays, nextEdits, parseEdits, parseSettings, sheetRows, sheetTotals, SETTING_KEYS,
  type SavedDay, type SheetField, type SheetRow, type SheetSettings,
} from '@/lib/field-sheet';
import { expenseCategoryLabel, expenseReasonText } from '@/lib/expenses';
import { downloadXLSXBook } from '@/lib/export';
import { fmtMoney } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import type { EnrichedWorkOrder } from '@/lib/types';
import { Section } from '@/components/wf/WfUi';
import { loadEvents, OfficeReceiptDialog } from '@/components/wf/ProjectOffice';

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

export default function FieldSheetView({ workOrders }: { workOrders: EnrichedWorkOrder[] }) {
  const [q, setQ] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('sheet') ?? ''));
  const [woId, setWoId] = useState<string | null>(null);
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
        <h1 className="wf-h1" style={{ margin: 0 }}>Field Sheet</h1>
        <div className="wf-subtle">Pull a job by its work order number: each tech&apos;s days, miles and receipts from the app, ready to fix and bill.</div>
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
                onClick={() => { setQ(w.wo_number); setWoId(w.id); }}>
                WO {w.wo_number}{w.external_wo_id ? ` · ${w.external_wo_id}` : ''} · {jobName(w)}
              </button>
            ))}
          </div>
        )}
      </form>
      {wo ? <Sheet key={wo.id} wo={wo} onOpened={() => setOpened((o) => (o.includes(wo.id) ? o : [wo.id, ...o]))} /> : (
        <Section title="Pick a job">
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            Type the work order number above. The sheet comes up with every day the techs logged in the app. Fix any time,
            mile or hour by typing over it, add a day the app missed, and approve or decline the receipts. Your changes are
            kept here; what the techs tapped is never changed.
          </div>
        </Section>
      )}
    </div>
  );
}

type Expense = {
  id: string; contractor_name: string | null; category: string; vendor: string | null; amount: number; expense_date: string;
  note: string | null; receipt_path: string | null; status: string; decline_reason: string | null;
};
type Photo = { id: string; url: string; taken_at: string; contractor_name: string | null };
type Shot = { src: string; title: string; caption: string };

function Sheet({ wo, onOpened }: { wo: EnrichedWorkOrder; onOpened: () => void }) {
  const db = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof loadEvents>>>([]);
  const [readings, setReadings] = useState<(OdoRow & { id: string })[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<SavedDay[]>([]);
  const [settings, setSettings] = useState<SheetSettings>(parseSettings({}));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [zoom, setZoom] = useState<Shot | null>(null);

  const loadExpenses = useCallback(async () => {
    const { data } = await db.from('job_expenses')
      .select('id, contractor_name, category, vendor, amount, expense_date, note, receipt_path, status, decline_reason')
      .eq('wo_id', wo.id).order('expense_date');
    const list = ((data as Expense[] | null) ?? []).map((e) => ({ ...e, amount: Number(e.amount) }));
    setExpenses(list);
    return list;
  }, [db, wo.id]);

  useEffect(() => {
    void (async () => {
      const [ev, od, ex, ph, fs, days, us] = await Promise.all([
        loadEvents([wo.id]),
        db.from('job_odometer').select('id, wo_id, contractor_name, at, moment, reading, ai_reading, photo_path').eq('wo_id', wo.id).order('at'),
        loadExpenses(),
        db.from('wo_photos').select('id, url, taken_at, contractor_name').eq('wo_id', wo.id).order('taken_at'),
        db.from('field_sheets').select('settings').eq('wo_id', wo.id).maybeSingle(),
        db.from('field_sheet_days').select('id, day, tech, edits, added, hidden').eq('wo_id', wo.id),
        db.from('user_settings').select('mileage_rate').maybeSingle(),
      ]);
      setEvents(ev);
      const odo = ((od.data as (OdoRow & { id: string })[] | null) ?? []).map((o) => ({ ...o, reading: Number(o.reading), ai_reading: o.ai_reading == null ? null : Number(o.ai_reading) }));
      setReadings(odo);
      setPhotos((ph.data as Photo[] | null) ?? []);
      const s = parseSettings((fs.data as { settings?: unknown } | null)?.settings);
      const rate = Number((us.data as { mileage_rate?: unknown } | null)?.mileage_rate);
      setSettings(s.mileRate == null && Number.isFinite(rate) ? { ...s, mileRate: rate } : s);
      if (days.error) toastError("The field sheet isn't set up in the database yet (migration 136). Your changes won't save until it is.");
      setSaved(((days.data as { id: string; day: string; tech: string; edits: unknown; added: boolean; hidden: boolean }[] | null) ?? [])
        .map((d) => ({ ...d, edits: parseEdits(d.edits) })));
      const paths = [...ex.map((e) => e.receipt_path), ...odo.map((o) => o.photo_path)].filter((p): p is string => !!p);
      if (paths.length) {
        const { data: signed } = await db.storage.from('job-receipts').createSignedUrls(paths, 60 * 60);
        const m: Record<string, string> = {};
        for (const x of signed ?? []) if (x.path && x.signedUrl) m[x.path] = x.signedUrl;
        setUrls(m);
      }
      setLoading(false);
    })();
  }, [db, wo.id, loadExpenses]);

  const techs = useMemo(() => (wo.contractor_names?.length ? wo.contractor_names : [wo.contractor_name]).filter((t): t is string => !!t), [wo]);
  const rows = useMemo(() => {
    const logs = buildDayLogs(events, new Date(), TZ);
    const legs = matchOdometer(logs.flatMap((d) => d.legs), readings);
    return sheetRows({ app: appDays(logs, legs, TZ), saved, techs, days: jobDays(wo.start_date, wo.end_date) })
      .filter((r) => (!from || r.day >= from) && (!to || r.day <= to));
  }, [events, readings, saved, techs, wo.start_date, wo.end_date, from, to]);
  const visible = rows.filter((r) => showHidden || !r.hidden);
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  const receipts = expenses.filter((e) => inRange(e.expense_date));
  const totals = sheetTotals(rows, receipts.map((e) => ({ id: e.id, category: e.category, amount: e.amount, status: e.status })), settings);
  const allTechs = [...new Set([...techs, ...rows.map((r) => r.tech)])];

  // ── saving ────────────────────────────────────────────────────────────────
  const store = async (row: SheetRow, patch: { edits?: SavedDay['edits']; hidden?: boolean }) => {
    const next: SavedDay = {
      id: row.id ?? `new-${row.key}`, day: row.day, tech: row.tech,
      edits: patch.edits ?? row.edits, added: row.added || !row.app, hidden: patch.hidden ?? row.hidden,
    };
    const before = saved;
    setSaved((list) => [...list.filter((s) => !(s.day === row.day && s.tech === row.tech)), next]);
    const { data, error } = await db.from('field_sheet_days')
      .upsert({ wo_id: wo.id, day: next.day, tech: next.tech, edits: next.edits, added: next.added, hidden: next.hidden, updated_at: new Date().toISOString() },
        { onConflict: 'wo_id,tech,day' })
      .select('id').single();
    if (error) { setSaved(before); toastError("That change didn't save. Check your connection and try again."); return; }
    setSaved((list) => list.map((s) => (s.day === next.day && s.tech === next.tech ? { ...s, id: (data as { id: string }).id } : s)));
    onOpened();
  };
  const setField = (row: SheetRow, field: SheetField, value: string | number | boolean | null) => {
    const edits = nextEdits(row, field, value);
    if (JSON.stringify(edits) === JSON.stringify(row.edits)) return;
    void store(row, { edits });
  };
  const undo = async (row: SheetRow) => {
    if (!row.id) return;
    const before = saved;
    setSaved((list) => list.filter((s) => s.id !== row.id));
    const { error } = await db.from('field_sheet_days').delete().eq('id', row.id);
    if (error) { setSaved(before); toastError("Couldn't undo that. Check your connection."); }
  };
  const saveSetting = async (k: (typeof SETTING_KEYS)[number], v: number | null) => {
    const next = { ...settings, [k]: v };
    setSettings(next);
    const { error } = await db.from('field_sheets').upsert({ wo_id: wo.id, settings: next, updated_at: new Date().toISOString() }, { onConflict: 'wo_id' });
    if (error) toastError("That rate didn't save. Check your connection.");
    else onOpened();
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
    const head = { title: `${jobName(wo)} — ${[wo.site_city, wo.site_state].filter(Boolean).join(', ')}`, wo: wo.wo_number, clientWo: wo.external_wo_id, address: address(wo) };
    const rec: (string | number)[][] = [['Date', 'Technician', 'For', 'Store', 'Amount', 'Status', 'Note']];
    for (const e of receipts) rec.push([e.expense_date, e.contractor_name ?? '', expenseCategoryLabel(e.category), e.vendor ?? '', e.amount, STATUS_WORD[e.status] ?? e.status, e.decline_reason ?? e.note ?? '']);
    await downloadXLSXBook(`${fileSafe(`WO ${wo.wo_number} ${wo.external_wo_id ?? ''} ${jobName(wo)}`)}.xlsx`, [
      { name: 'Field sheet', rows: fieldSheetRows(head, rows, totals, settings), colWidths: [11, 18, 12, 12, 11, 12, 8, 9, 9, 9, 11, 11, 9, 9, 11, 50] },
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
              WO {wo.wo_number}{wo.external_wo_id ? ` · Client # ${wo.external_wo_id}` : ''}{wo.client_reference ? ` · Site ${wo.client_reference}` : ''} · {address(wo)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => void excel()}><FileSpreadsheet size={16} /> Excel (Smartsheet)</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {([['mileRate', 'Mileage $/mi'], ['mealRate', 'Meals $/day'], ['hotelRate', 'Hotel $/night'], ['nights', 'Hotel nights'], ['rooms', 'Hotel rooms']] as const).map(([k, label]) => (
            <label key={k} style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              <span className="wf-label">{label}</span>
              <input key={`${k}:${settings[k] ?? ''}`} className="wf-input" style={{ width: 110, minHeight: 34, padding: '4px 8px' }} inputMode="decimal"
                defaultValue={settings[k] ?? ''} placeholder="–"
                onBlur={(e) => { const v = num(e.target.value); if (v !== undefined && v !== settings[k]) void saveSetting(k, v); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            </label>
          ))}
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">From</span>
            <input type="date" className="wf-input" style={{ width: 150, minHeight: 34, padding: '4px 8px' }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">To</span>
            <input type="date" className="wf-input" style={{ width: 150, minHeight: 34, padding: '4px 8px' }} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          <Stat label="Hours on site" value={hrs(totals.hours)} />
          <Stat label="Travel hours" value={hrs(totals.travel)} />
          <Stat label="Miles" value={mi(totals.miles)} />
          <Stat label="Mileage" value={money(totals.mileage)} />
          <Stat label="Meals" value={money(totals.meals.claim)} />
          <Stat label="Hotel" value={money(totals.hotel.claim)} />
          <Stat label="Bill the client" value={money(totals.bill)} strong />
        </div>
      </section>

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
                'Odometer start', 'Odometer end', 'GPS mi', 'Miles', 'Mileage $', 'From the app / notes', 'Ask', ''].map((h) => <th key={h} style={TH}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map((r) => <DayLine key={r.key} r={r} rate={settings.mileRate ?? 0} onSet={setField} onUndo={undo}
                onHide={(row) => void store(row, { hidden: !row.hidden })} />)}
              {visible.length === 0 && <tr><td colSpan={18} style={{ ...TD, padding: 14 }}>Nothing in the app for these dates yet. Press <b>Add a day</b> to type one.</td></tr>}
            </tbody>
            <tfoot>
              <tr style={{ background: '#F6F1E4', fontWeight: 700 }}>
                <td style={TD} colSpan={7}>Total · {totals.techDays} tech-days</td>
                <td style={TDN}>{hrs(totals.hours)}</td><td style={TDN}>{hrs(totals.travel)}</td><td style={TDN}>{hrs(totals.total)}</td>
                <td style={TD} colSpan={3} /><td style={TDN}>{mi(totals.miles)}</td><td style={TDN}>{money(totals.mileage)}</td><td style={TD} colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section title="Receipts" subtitle={`${approved.length} approved${waiting.length ? ` · ${waiting.length} waiting for you` : ''}`} right={
        <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setReceiptOpen(true)}><Receipt size={16} /> Add a receipt</button>
      }>
        {waiting.length > 0 && <ReceiptList title="Waiting for you" list={waiting} urls={urls} onZoom={setZoom}
          actions={(e) => <><button className="wf-btn wf-btn-navy wf-btn-sm" onClick={() => void decide(e, true)}>Approve</button>
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void decide(e, false)}>Decline</button></>} />}
        <ReceiptList title="Approved: on the bill" list={approved} urls={urls} onZoom={setZoom}
          actions={(e) => <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void decide(e, false)}>Decline</button>} />
        <ReceiptList title="Declined: off the bill" list={declined} urls={urls} onZoom={setZoom} declined
          actions={(e) => <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => void decide(e, true)}>Approve</button>} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12, fontSize: 13 }}>
          <div>Meals: {money(totals.meals.receipts)} in receipts{totals.meals.allowed != null ? `, up to ${money(totals.meals.allowed)} (${totals.techDays} tech-days)` : ''} → <b>{money(totals.meals.claim)}</b></div>
          <div>Hotel: {money(totals.hotel.receipts)} in receipts{totals.hotel.allowed != null ? `, up to ${money(totals.hotel.allowed)}` : ''} → <b>{money(totals.hotel.claim)}</b></div>
          <div className="wf-subtle">Not on the bill: fuel {money(totals.byCategory.fuel ?? 0)}, materials {money(totals.byCategory.materials ?? 0)}, declined {money(totals.declined)}</div>
        </div>
      </Section>

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

const STATUS_WORD: Record<string, string> = { approved: 'Approved', declined: 'Declined', submitted: 'Waiting' };
const CELL = { office: '#FBF0D4', guess: '#E3EEFA', missing: '#FDE8D7', base: 'transparent' };
const TH: React.CSSProperties = { padding: '8px 6px', background: '#13284A', color: '#fff', fontSize: 11.5, fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const TD: React.CSSProperties = { padding: 0, borderTop: '1px solid #ECE8DF', verticalAlign: 'top' };
const TDN: React.CSSProperties = { ...TD, padding: '7px 6px', textAlign: 'right', whiteSpace: 'nowrap' };
const IN: React.CSSProperties = { width: '100%', minWidth: 0, border: 0, background: 'transparent', font: 'inherit', padding: '7px 6px', color: 'inherit' };

const address = (w: EnrichedWorkOrder) => [w.site_address, [w.site_city, [w.site_state, w.site_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');

/** A typed number: '' → null (empty), junk → undefined (ignored). */
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

function DayLine({ r, rate, onSet, onUndo, onHide }: {
  r: SheetRow; rate: number; onSet: (r: SheetRow, f: SheetField, v: string | number | boolean | null) => void;
  onUndo: (r: SheetRow) => void; onHide: (r: SheetRow) => void;
}) {
  const v = r.values, c = dayCalc(v, rate);
  const bg = (f: SheetField) => (r.source[f] === 'office' ? CELL.office : r.source[f] === 'guess' ? CELL.guess : CELL.base);
  const time = (f: 'left' | 'arrived' | 'leftSite' | 'back') => (
    <td style={{ ...TD, background: bg(f), minWidth: 104 }} title={r.source[f] === 'guess' ? 'Worked out from the drives. Check it.' : undefined}>
      <input key={`${f}:${v[f] ?? ''}`} type="time" style={IN} defaultValue={v[f] ?? ''} aria-label={`${f} ${r.tech} ${r.day}`}
        onBlur={(e) => { if ((e.target.value || null) !== (v[f] ?? null)) onSet(r, f, e.target.value || null); }} />
    </td>
  );
  const number = (f: 'lunch' | 'odoStart' | 'odoEnd' | 'gps' | 'hours' | 'travel' | 'miles', auto?: string, width = 76) => (
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
      <td style={TDN}>{money(c.mileage)}</td>
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

