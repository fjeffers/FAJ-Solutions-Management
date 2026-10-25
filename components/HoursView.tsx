'use client';
// Hours (Fred, 2026-10-24: "build the simpler hours screen one card per day and
// way for me to edit the hours on each work orders"; "i need to edit the hours
// in the app nothing else matters and i need to see it day by day").
//
// Pick a job. Every day each tech worked on it is a card: started, finished,
// lunch, hours on site, travel hours and miles, filled in from what the techs
// tapped. Change any box and Save. It saves to the same day lines the Field
// Sheet and the invoice read (field_sheet_days), so they all agree. A tech still
// clocked in gets a Clock out button on the card (wf_owner_fix_punch).
//
// The same cards sit on the work order's Time Logs tab ("so i change the time
// do it reflest in the work order"), and the bar above them sets how they show
// ("i want to be change they way i view the cards manually"; "weeek view month
// view etc"): day by day, by week or by month with totals, newest or oldest
// first, one tech or all, full cards or a short list. Settings -> Hours screen
// keeps the choice (lib/hours-look.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, LogOut, Plus, Save, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { dayOf, type DayEvent } from '@/lib/project-day';
import type { OdoRow } from '@/lib/weekly-bill';
import { clock, dayCalc, nextEdits, parseEdits, rowsFor, type SavedDay, type SheetField, type SheetRow } from '@/lib/field-sheet';
import { parsePunches, stillOnSite, zonedIso, type Punch } from '@/lib/clock-fix';
import { toastError, toastSuccess } from '@/lib/toast';
import { expenseCategoryLabel } from '@/lib/expenses';
import type { EnrichedWorkOrder, WorkOrder } from '@/lib/types';
import { groupLabel, groupOf, hoursLookNow, HOURS_CARDS, HOURS_CHANGED, HOURS_GROUPS, HOURS_SAVE_ALL, type HoursLook } from '@/lib/hours-look';
import HoursBoard from '@/components/HoursBoard';
import DayPictures, { type DayPic } from '@/components/DayPictures';
import { loadEvents } from '@/components/wf/ProjectOffice';
import { fixPunch } from '@/components/ClockFix';
import { findJob } from '@/components/FieldSheetView';
import TimesheetExport from '@/components/TimesheetExport';

const TZ = 'America/New_York';
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const jobName = (w: WorkOrder) => w.site_name || w.title || `WO ${w.wo_number}`;
type DayReceipt = { contractor_name: string | null; category: string; vendor: string | null; amount: number; expense_date: string; receipt_path: string };

/** The boxes on a card, in the order Fred reads a day. */
const BOXES: { f: Exclude<SheetField, 'note' | 'ask'>; label: string; time?: boolean }[] = [
  { f: 'arrived', label: 'Started', time: true },
  { f: 'leftSite', label: 'Finished', time: true },
  { f: 'lunch', label: 'Lunch (min)' },
  { f: 'hours', label: 'Hours on site' },
  { f: 'travel', label: 'Travel hours' },
  { f: 'odoStart', label: 'Odometer start' },
  { f: 'odoEnd', label: 'Odometer end' },
  { f: 'miles', label: 'Miles' },
  { f: 'meals', label: 'Meals $' },
  { f: 'spend', label: 'Other spending $' },
];

/** A typed number: '' → null (empty), junk → undefined. */
function num(s: string): number | null | undefined {
  const t = s.replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
const toSaved = (data: unknown): SavedDay[] =>
  ((data as { id: string; day: string; tech: string; edits: unknown; added: boolean; hidden: boolean }[] | null) ?? [])
    .map((d) => ({ ...d, edits: parseEdits(d.edits) }));

export default function HoursView({ workOrders, onLook }: { workOrders: EnrichedWorkOrder[]; onLook?: (l: HoursLook) => void }) {
  const [q, setQ] = useState('');
  const [woId, setWoId] = useState<string | null>(null);
  const wo = woId ? workOrders.find((w) => w.id === woId) ?? null : null;
  // The jobs worked lately first: open ones, newest start date first.
  const picks = useMemo(() => workOrders.filter((w) => !w.archived_at)
    .sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? '')).slice(0, 12), [workOrders]);
  const pull = (e?: React.FormEvent) => {
    e?.preventDefault();
    const w = findJob(workOrders, q);
    if (!w) { toastError(`No work order ${q.trim()} found. Type the WO number, or the client's ticket or site number.`); return; }
    setWoId(w.id);
  };
  return (
    <div className="wf" style={{ padding: 16, maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 className="wf-h1" style={{ margin: 0 }}>Hours</h1>
        <div className="wf-subtle">Pick a job. Each day is a card: change the times, hours or miles and press Save.</div>
      </div>
      <form onSubmit={pull} className="wf-card" style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="wf-input" style={{ flex: '1 1 220px', minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Work order number, like 19101413" aria-label="Work order number" inputMode="search" autoComplete="off" />
        <button className="wf-btn wf-btn-navy" type="submit"><Search size={16} /> Show the days</button>
        <div style={{ flexBasis: '100%', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {picks.map((w) => (
            <button type="button" key={w.id} className={`wf-btn wf-btn-sm ${w.id === woId ? 'wf-btn-gold' : 'wf-btn-outline'}`}
              onClick={() => { setQ(w.wo_number); setWoId(w.id); }}>
              WO {w.wo_number} · {jobName(w)}
            </button>
          ))}
        </div>
      </form>
      {wo && <JobDays key={wo.id} wo={wo} onLook={onLook} />}
    </div>
  );
}

type Totals = { days: number; hours: number; travel: number; miles: number; meals: number };
const totalOf = (rows: SheetRow[]): Totals => rows.reduce((t, r) => {
  const c = dayCalc(r.values, 0);
  return { days: t.days + 1, hours: t.hours + c.hours, travel: t.travel + c.travel, miles: t.miles + c.miles, meals: t.meals + (r.values.meals ?? 0) };
}, { days: 0, hours: 0, travel: 0, miles: 0, meals: 0 });
const totalText = (t: Totals) =>
  `${t.days} day${t.days === 1 ? '' : 's'} · ${t.hours.toFixed(2)} h on site · ${t.travel.toFixed(2)} h travel · ${Math.round(t.miles * 10) / 10} mi · $${t.meals.toFixed(2)} meals`;

/**
 * One job's days as cards, with the bar that sets how they show. Also on the
 * work order's Time Logs tab and its Timesheet (inWorkOrder: no job name or
 * export there, the work order shows them). Opens the way Settings -> Hours
 * screen has it; onLook saves a change made on the bar back to Settings.
 */
export function JobDays({ wo, onLook, inWorkOrder = false }: { wo: WorkOrder; onLook?: (l: HoursLook) => void; inWorkOrder?: boolean }) {
  const db = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<DayEvent[]>([]);
  const [readings, setReadings] = useState<OdoRow[]>([]);
  const [saved, setSaved] = useState<SavedDay[]>([]);
  const [punches, setPunches] = useState<Punch[]>([]);
  // The day's pictures are the odometer photos and the approved receipts, nothing
  // else (Fred, 2026-10-25: "time log should only have the receipt and odometer
  // reading"). Both are private files, so signed links.
  const [receipts, setReceipts] = useState<DayReceipt[]>([]);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [look, setLook] = useState<HoursLook>(hoursLookNow);
  const [tech, setTech] = useState('');
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const changeLook = (l: Partial<HoursLook>) => { const n = { ...look, ...l }; setLook(n); onLook?.(n); };
  // What each card would save, so one press saves every changed day (Fred, 2026-10-24: "save all is not working").
  const pendingRef = useRef(new Map<string, { row: SheetRow; edits: SavedDay['edits'] }>());
  const [pendingCount, setPendingCount] = useState(0);
  const onPending = useCallback((key: string, p: { row: SheetRow; edits: SavedDay['edits'] } | null) => {
    if (p) pendingRef.current.set(key, p); else pendingRef.current.delete(key);
    setPendingCount(pendingRef.current.size);
  }, []);
  const [savingAll, setSavingAll] = useState(false);

  const load = useCallback(async () => {
    const [ev, od, days, pu, ex] = await Promise.all([
      loadEvents([wo.id]),
      db.from('job_odometer').select('wo_id, contractor_name, at, moment, reading, ai_reading, photo_path').eq('wo_id', wo.id).order('at'),
      db.from('field_sheet_days').select('id, day, tech, edits, added, hidden').eq('wo_id', wo.id),
      db.from('job_punches').select('id, wo_id, wo_number, contractor_name, kind, at').eq('wo_id', wo.id).order('at'),
      db.from('job_expenses').select('contractor_name, category, vendor, amount, expense_date, status, receipt_path').eq('wo_id', wo.id),
    ]);
    setEvents(ev);
    const odo = ((od.data as OdoRow[] | null) ?? []).map((o) => ({ ...o, reading: Number(o.reading), ai_reading: o.ai_reading == null ? null : Number(o.ai_reading) }));
    setReadings(odo);
    // A declined receipt (a duplicate, say) stays on the job but not on the day.
    const rec = ((ex.data as (DayReceipt & { status: string })[] | null) ?? []).filter((e) => e.status === 'approved' && e.receipt_path);
    setReceipts(rec);
    const paths = [...odo.map((o) => o.photo_path), ...rec.map((e) => e.receipt_path)].filter((x): x is string => !!x);
    if (paths.length) {
      const { data: signed } = await db.storage.from('job-receipts').createSignedUrls(paths, 60 * 60);
      setFileUrls(Object.fromEntries((signed ?? []).filter((x) => x.path && x.signedUrl).map((x) => [x.path!, x.signedUrl as string])));
    }
    if (days.error) toastError("Hours can't be saved yet: the database needs the Field Sheet update (migration 136).");
    setSaved(toSaved(days.data));
    setPunches(parsePunches(pu.data));
    setLoading(false);
  }, [db, wo.id]);
  useEffect(() => { void load(); }, [load]);
  // The work order's Save Changes saves the hours too (HOURS_SAVE_ALL).
  const saveAllRef = useRef<() => Promise<number>>(async () => 0);
  useEffect(() => {
    const on = () => void saveAllRef.current();
    window.addEventListener(HOURS_SAVE_ALL, on);
    return () => window.removeEventListener(HOURS_SAVE_ALL, on);
  }, []);

  const techs = useMemo(() => (wo.contractor_names?.length ? wo.contractor_names : [wo.contractor_name]).filter((t): t is string => !!t), [wo]);
  const rows = useMemo(() => rowsFor({ events, readings, saved, techs, start: wo.start_date, end: wo.end_date, timeZone: TZ })
    .filter((r) => !r.hidden), [events, readings, saved, techs, wo.start_date, wo.end_date]);
  const rowTechs = useMemo(() => [...new Set([...techs, ...rows.map((r) => r.tech)])], [techs, rows]);
  const shown = useMemo(() => rows.filter((r) => !tech || r.tech === tech)
    .sort((a, b) => (look.order === 'new' ? b.day.localeCompare(a.day) : a.day.localeCompare(b.day)) || a.tech.localeCompare(b.tech)),
  [rows, tech, look.order]);
  // Days in the order chosen, cut into weeks or months when asked (each its own totals).
  const groups = useMemo(() => {
    const out: { key: string; rows: SheetRow[] }[] = [];
    for (const r of shown) {
      const key = groupOf(r.day, look.group);
      const last = out[out.length - 1];
      if (last?.key === key) last.rows.push(r); else out.push({ key, rows: [r] });
    }
    return out;
  }, [shown, look.group]);
  const open = stillOnSite(punches);

  /** Save a day's edits; true when the database took them. */
  const saveDay = async (row: SheetRow, edits: SavedDay['edits']): Promise<boolean> => {
    const { data, error } = await db.from('field_sheet_days')
      .upsert({ wo_id: wo.id, day: row.day, tech: row.tech, edits, added: row.added || !row.app, hidden: false, updated_at: new Date().toISOString() },
        { onConflict: 'wo_id,tech,day' })
      .select('id, day, tech, edits, added, hidden').single();
    if (error || !data) { toastError("That day didn't save. Check your connection and try again."); return false; }
    setSaved((list) => [...list.filter((s) => !(s.day === row.day && s.tech === row.tech)), ...toSaved([data])]);
    window.dispatchEvent(new Event(HOURS_CHANGED));
    return true;
  };

  /** A tech's pictures on a day: the odometer photos first, then the receipts. */
  const picsFor = (day: string, tech: string): DayPic[] => [
    ...readings.filter((o) => o.contractor_name === tech && o.photo_path && fileUrls[o.photo_path] && dayOf(o.at, TZ) === day)
      .map((o) => ({ src: fileUrls[o.photo_path!], caption: `Odometer ${o.moment === 'end' ? 'end' : 'start'}: ${o.reading.toLocaleString('en-US')}` })),
    ...receipts.filter((e) => (e.contractor_name ?? '') === tech && e.expense_date === day && fileUrls[e.receipt_path])
      .map((e) => ({ src: fileUrls[e.receipt_path], caption: `Receipt · ${expenseCategoryLabel(e.category)}${e.vendor ? `, ${e.vendor}` : ''}: $${Number(e.amount).toFixed(2)}` })),
  ];
  const pictures = (r: SheetRow) => (
    <DayPictures pics={picsFor(r.day, r.tech)} woId={wo.id} woNumber={wo.wo_number} day={r.day} tech={r.tech}
      onAdded={async (odo) => {
        // The reading fills the day's odometer box, so the miles work out from it.
        if (odo) await saveDay(r, nextEdits({ app: r.app, edits: r.edits }, odo.moment === 'start' ? 'odoStart' : 'odoEnd', odo.reading));
        void load();
      }} />
  );

  /** Save every card with changes; how many saved. */
  const saveAll = async (): Promise<number> => {
    const list = [...pendingRef.current.values()];
    if (!list.length) return 0;
    setSavingAll(true);
    let n = 0;
    for (const p of list) if (await saveDay(p.row, p.edits)) n++;
    setSavingAll(false);
    if (n) toastSuccess(`Saved ${n} day${n === 1 ? '' : 's'}.`);
    return n;
  };
  useEffect(() => { saveAllRef.current = saveAll; });

  if (loading) return <div className="wf-card" style={{ padding: 16 }}>Loading WO {wo.wo_number}…</div>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {inWorkOrder ? (
        <div><button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => setAdding(true)}><Plus size={15} /> Add a day</button></div>
      ) : (
        <div className="wf-card" style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div className="wf-title" style={{ fontSize: 17 }}>{jobName(wo)}</div>
            <div className="wf-subtle" style={{ fontSize: 13 }}>WO {wo.wo_number}{wo.external_wo_id ? ` · ${wo.external_wo_id}` : ''} · {techs.join(', ') || 'no tech yet'}</div>
          </div>
          <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => setAdding(true)}><Plus size={15} /> Add a day</button>
          <div style={{ flexBasis: '100%' }}><TimesheetExport key={rows.length} wo={wo} rows={rows} /></div>
        </div>
      )}
      {adding && <AddDayCard techs={techs} defaultDay={wo.start_date ?? dayOf(new Date().toISOString(), TZ)} onCancel={() => setAdding(false)}
        onAdd={async (day, tech) => {
          const row: SheetRow = { key: `${day}|${tech}`, day, tech, id: null, added: true, hidden: false, missing: false, app: null, edits: {}, values: {} as SheetRow['values'], source: {} };
          if (await saveDay(row, {})) { setAdding(false); toastSuccess(`Added ${fmtDay(day)} for ${tech}. Fill in the times and Save.`); }
        }} />}
      {rows.length === 0 && !adding && (
        <div className="wf-card" style={{ padding: 16 }}>Nothing in the app for this job yet. Press <b>Add a day</b> to type one in.</div>
      )}
      {rows.length > 0 && (
        <div className="wf-card" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }} role="group" aria-label="How the days show">
          <div style={{ display: 'grid', gap: 3 }}><span className="wf-label">View</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {HOURS_GROUPS.map((g) => (
                <button key={g.value} type="button" className={`wf-btn wf-btn-sm ${look.group === g.value ? 'wf-btn-navy' : 'wf-btn-outline'}`}
                  aria-pressed={look.group === g.value} onClick={() => changeLook({ group: g.value })}>{g.label}</button>
              ))}
            </div>
          </div>
          <label style={{ display: 'grid', gap: 3 }}><span className="wf-label">Order</span>
            <select className="wf-input" value={look.order} onChange={(e) => changeLook({ order: e.target.value as HoursLook['order'] })} aria-label="Order">
              <option value="new">Newest day first</option>
              <option value="old">Oldest day first</option>
            </select></label>
          {rowTechs.length > 1 && (
            <label style={{ display: 'grid', gap: 3 }}><span className="wf-label">Technician</span>
              <select className="wf-input" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Technician">
                <option value="">All techs</option>
                {rowTechs.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></label>
          )}
          <div style={{ display: 'grid', gap: 3 }}><span className="wf-label">Cards</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {HOURS_CARDS.map((k) => (
                <button key={k.value} type="button" className={`wf-btn wf-btn-sm ${look.cards === k.value ? 'wf-btn-navy' : 'wf-btn-outline'}`}
                  aria-pressed={look.cards === k.value} title={k.hint} onClick={() => changeLook({ cards: k.value })}>{k.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 13, textAlign: 'right' }}>
            <div className="wf-label">All shown</div>
            <b>{totalText(totalOf(shown))}</b>
          </div>
        </div>
      )}
      {look.cards === 'board' && (
        <HoursBoard onSave={saveDay} pictures={pictures} picCount={(r) => picsFor(r.day, r.tech).length}
          groups={groups.map((g) => ({ key: g.key, label: look.group === 'day' ? `WO ${wo.wo_number} · every day` : groupLabel(g.key, look.group), rows: g.rows }))} />
      )}
      {look.cards !== 'board' && groups.map((g) => (
        <div key={g.key} style={{ display: 'grid', gap: 10 }}>
          {look.group !== 'day' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', padding: '6px 2px 0', borderBottom: '2px solid #C9A24B' }}>
              <b style={{ fontSize: 16 }}>{groupLabel(g.key, look.group)}</b>
              <span style={{ marginLeft: 'auto', fontSize: 13 }}>{totalText(totalOf(g.rows))}</span>
            </div>
          )}
          {g.rows.map((r) => {
            const card = (
              <DayCard key={`${r.key}:${JSON.stringify(r.edits)}`} row={r} woId={wo.id} pictures={pictures(r)} onPending={onPending}
                openPunch={open.find((p) => p.contractor_name === r.tech && dayOf(p.at, TZ) === r.day) ?? null}
                onSave={saveDay} onClocked={() => void load()} />
            );
            if (look.cards === 'full') return card;
            const isOpen = opened.has(r.key);
            const c = dayCalc(r.values, 0);
            const times = [clock(r.values.arrived), clock(r.values.leftSite)].filter(Boolean).join(' – ');
            return (
              <div key={r.key} style={{ display: 'grid', gap: 6 }}>
                <button type="button" className="wf-card wf-card-click" aria-expanded={isOpen}
                  style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
                  onClick={() => setOpened((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}>
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <b>{fmtDay(r.day)}</b><span>{r.tech}</span>
                  <span className="wf-subtle">{times || 'no times'}</span>
                  <span style={{ marginLeft: 'auto' }}><b>{c.hours.toFixed(2)} h</b> · {c.travel.toFixed(2)} h travel · {c.miles} mi{r.values.meals ? ` · $${r.values.meals.toFixed(2)} meals` : ''}</span>
                </button>
                {isOpen && card}
              </div>
            );
          })}
        </div>
      ))}
      {pendingCount > 0 && (
        <div style={{ position: 'sticky', bottom: 12, zIndex: 5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          background: '#0E1B2E', color: '#fff', borderRadius: 12, padding: '10px 14px', boxShadow: '0 6px 20px rgba(14,27,46,0.25)' }}>
          <span style={{ fontSize: 14 }}>Changes on {pendingCount} day{pendingCount === 1 ? '' : 's'} not saved yet.</span>
          <button className="wf-btn wf-btn-gold wf-btn-sm" style={{ marginLeft: 'auto' }} disabled={savingAll} onClick={() => void saveAll()}>
            <Save size={15} /> {savingAll ? 'Saving…' : 'Save all changes'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The edits a card's boxes make, or undefined while a number box holds something that isn't a number. */
function cardEdits(row: SheetRow, vals: Record<string, string>): SavedDay['edits'] | undefined {
  if (BOXES.some(({ f, time }) => !time && num(vals[f]) === undefined)) return undefined;
  let edits = row.edits;
  for (const { f, time } of BOXES) {
    const v = time ? (vals[f] || null) : num(vals[f]) ?? null;
    if (v === (row.values[f] ?? null)) continue;
    edits = nextEdits({ app: row.app, edits }, f, v);
  }
  if (vals.note.trim() !== (row.values.note ?? '')) edits = nextEdits({ app: row.app, edits }, 'note', vals.note.trim() || null);
  return edits;
}

function DayCard({ row, woId, openPunch, onSave, onClocked, pictures, onPending }: {
  row: SheetRow; woId: string; openPunch: Punch | null; pictures?: React.ReactNode;
  onSave: (row: SheetRow, edits: SavedDay['edits']) => Promise<boolean>; onClocked: () => void;
  /** Tells the day list what this card would save, so Save all can (null: nothing to save). */
  onPending?: (key: string, p: { row: SheetRow; edits: SavedDay['edits'] } | null) => void;
}) {
  const start = () => Object.fromEntries([...BOXES.map(({ f }) => [f, row.values[f] == null ? '' : String(row.values[f])]), ['note', row.values.note ?? '']]);
  const [vals, setVals] = useState<Record<string, string>>(start);
  const [busy, setBusy] = useState(false);
  const typed = { ...row.values, ...Object.fromEntries(BOXES.map(({ f, time }) => [f, time ? (vals[f] || null) : (num(vals[f]) ?? null)])) } as SheetRow['values'];
  const c = dayCalc(typed, 0);
  const changed = BOXES.some(({ f }) => vals[f] !== (row.values[f] == null ? '' : String(row.values[f]))) || vals.note.trim() !== (row.values.note ?? '');
  const edited = Object.keys(row.edits).length > 0;
  const pending = changed ? cardEdits(row, vals) : undefined;
  const pendingKey = pending ? JSON.stringify(pending) : '';
  useEffect(() => {
    onPending?.(row.key, pending ? { row, edits: pending } : null);
    // Only when what would be saved changes; the row object is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, row.key]);
  useEffect(() => () => onPending?.(row.key, null), [onPending, row.key]);

  const save = async () => {
    const bad = BOXES.find(({ f, time }) => !time && num(vals[f]) === undefined);
    if (bad) { toastError(`${bad.label}: type a number, like 7.5`); return; }
    const edits = cardEdits(row, vals)!;
    setBusy(true);
    const ok = await onSave(row, edits);
    setBusy(false);
    if (ok) toastSuccess(`Saved ${fmtDay(row.day)} for ${row.tech}.`);
  };
  // A day on the road and no work on site, like the Sunday drive home (Fred,
  // 2026-10-24: "like sunday needs it just the travel"). The travel hours are
  // kept as typed numbers, since without the site times they can't be worked out.
  const travelOnly = () => setVals((x) => ({
    ...x, arrived: '', leftSite: '', lunch: '', hours: '0', travel: x.travel || (c.travel ? String(c.travel) : ''),
  }));
  const isTravelOnly = typed.hours === 0 && !typed.arrived && !typed.leftSite;
  const clockOut = async () => {
    if (!openPunch) return;
    const iso = zonedIso(row.day, vals.leftSite, TZ);
    if (!iso) { toastError('Type the Finished time first.'); return; }
    if (Date.parse(iso) < Date.parse(openPunch.at)) { toastError('Finished is before they clocked in.'); return; }
    setBusy(true);
    const ok = await fixPunch({ p_op: 'add', p_wo_id: woId, p_tech: row.tech, p_kind: 'out', p_at: iso, p_note: 'Clocked out by the office (Hours)' });
    setBusy(false);
    if (ok) { toastSuccess(`${row.tech} clocked out at ${clock(vals.leftSite)}.`); onClocked(); }
  };

  const box: React.CSSProperties = { display: 'grid', gap: 3, fontSize: 12, minWidth: 0 };
  return (
    <section className="wf-card" style={{ padding: 14, display: 'grid', gap: 10, borderLeft: `4px solid ${edited ? '#C9A24B' : row.app ? '#13284A' : '#B45309'}` }}
      aria-label={`${row.tech} ${row.day}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 16 }}>{fmtDay(row.day)}</b>
        <span>{row.tech}</span>
        <span className="wf-subtle" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {edited ? 'Changed by you' : row.app ? 'From the app' : 'Typed in by you'}
        </span>
      </div>
      {openPunch && (
        <div style={{ background: '#FDF3E1', borderRadius: 8, padding: '6px 10px', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Clock size={14} /> Still clocked in since {clock(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(openPunch.at)))}.
          <button className="wf-btn wf-btn-navy wf-btn-sm" disabled={busy || !vals.leftSite} onClick={() => void clockOut()}>
            <LogOut size={14} /> Clock out at {vals.leftSite ? clock(vals.leftSite) : 'Finished'}
          </button>
        </div>
      )}
      {(row.source.arrived === 'guess' || row.source.leftSite === 'guess') && (
        <div style={{ background: '#FDF3E1', color: '#7A4B00', borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>
          No clock-in on site this day: Started and Finished are worked out from the drives, and they count as shown. If either is wrong, correct it and Save.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
        {BOXES.map(({ f, label, time }) => {
          const auto = f === 'hours' ? c.hoursAuto : f === 'travel' ? c.travelAuto : f === 'miles' ? c.milesAuto : null;
          return (
            <label key={f} style={box}><span className="wf-label">{label}</span>
              <input className="wf-input" type={time ? 'time' : 'text'} inputMode={time ? undefined : 'decimal'} value={vals[f]}
                placeholder={auto ? String(auto) : ''} aria-label={`${label} ${row.tech} ${row.day}`}
                onChange={(e) => setVals((x) => ({ ...x, [f]: e.target.value }))} />
            </label>
          );
        })}
      </div>
      <label style={box}><span className="wf-label">Note</span>
        <input className="wf-input" value={vals.note} onChange={(e) => setVals((x) => ({ ...x, note: e.target.value }))} aria-label={`Note ${row.tech} ${row.day}`} />
      </label>
      {pictures}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="wf-btn wf-btn-navy" disabled={busy || !changed} onClick={() => void save()}>
          <Save size={15} /> {busy ? 'Saving…' : changed ? 'Save' : 'Saved'}
        </button>
        <button className="wf-btn wf-btn-outline wf-btn-sm" disabled={busy || isTravelOnly} onClick={travelOnly}
          title="No hours on site: bill only the travel">Travel only</button>
        <span style={{ fontSize: 14 }}>{isTravelOnly ? <b>Travel day</b> : <><b>{c.hours.toFixed(2)} h</b> on site</>} · {c.travel.toFixed(2)} h travel · {c.miles} mi</span>
      </div>
    </section>
  );
}

function AddDayCard({ techs, defaultDay, onAdd, onCancel }: {
  techs: string[]; defaultDay: string; onAdd: (day: string, tech: string) => void; onCancel: () => void;
}) {
  const [day, setDay] = useState(defaultDay);
  const [tech, setTech] = useState(techs[0] ?? '');
  return (
    <section className="wf-card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">Day</span>
        <input type="date" className="wf-input" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day to add" /></label>
      <label style={{ display: 'grid', gap: 3, fontSize: 12 }}><span className="wf-label">Technician</span>
        <input className="wf-input" list="hours-techs" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Technician to add" />
        <datalist id="hours-techs">{techs.map((t) => <option key={t} value={t} />)}</datalist></label>
      <button className="wf-btn wf-btn-navy" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(day) || !tech.trim()} onClick={() => onAdd(day, tech.trim())}>Add</button>
      <button className="wf-btn wf-btn-ghost" onClick={onCancel}>Cancel</button>
    </section>
  );
}
