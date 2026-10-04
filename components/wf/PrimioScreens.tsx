'use client';
// The office screens copied from Primio, the WorkFlow app on GitHub (Fred,
// 2026-10-04: "i asked for every to mirror primio"). Each is Primio's screen
// with FAJ's real jobs in it:
//   PrimioBar       Primio's app bar: ivory, title centred, actions right
//   DispatchBoard   lib/screens/dispatch_screen.dart — number tiles, search,
//                   a column per stage, a card per job
//   ScheduleBoard   lib/screens/schedule_screen.dart — month / week calendar,
//                   the chosen day's jobs underneath
// The office sees money (the client price) on a card; techs never see these.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, LayoutGrid, List as ListIcon, MapPin, Search, CalendarCheck } from 'lucide-react';
import {
  WF_STATUS_COLOR, WF_WORK_TYPE_LABEL, workTypeFor, matchesWf, parseClockTime, fmtClock12,
  type WfJob, type WfStatus,
} from '@/lib/wf';
import { fmtMoney, todayISO } from '@/lib/utils';
import { Empty, Filters, StatusChip } from './WfUi';

// ── App bar ─────────────────────────────────────────────────────────────────

export function PrimioBar({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="wf-appbar">
      <div className="wf-appbar-side">{left}</div>
      <h1 className="wf-appbar-title">{title}</h1>
      <div className="wf-appbar-side" style={{ justifyContent: 'flex-end' }}>{right}</div>
    </div>
  );
}

// ── Dispatch board ──────────────────────────────────────────────────────────

export type BoardRow = { job: WfJob; payNotSet?: boolean; updatedAt?: string };

/** Primio's columns, with FAJ's own stages (a job can need a tech, and is closed by the office). */
export const DISPATCH_COLUMNS: { key: WfStatus; label: string }[] = [
  { key: 'open', label: 'Needs a tech' },
  { key: 'offered', label: 'Awaiting response' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'workDone', label: 'Work done' },
  { key: 'closed', label: 'Closed' },
  { key: 'declined', label: 'Declined' },
];

export type DispatchView = 'board' | 'grid' | 'list';
export type ListSort = 'number' | 'date' | 'client' | 'price' | 'stage';

const STAGE_ORDER: WfStatus[] = DISPATCH_COLUMNS.map((c) => c.key);

/** The order Grid and List read in. Dates: soonest first; jobs with no date last. */
export function sortBoardRows(rows: BoardRow[], key: ListSort, dir: 'asc' | 'desc'): BoardRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const num = (a: BoardRow, b: BoardRow) => a.job.number.localeCompare(b.job.number, undefined, { numeric: true });
  const cmp = (a: BoardRow, b: BoardRow): number => {
    switch (key) {
      case 'date': {
        if (!a.job.date && !b.job.date) return num(a, b);
        if (!a.job.date) return 1;   // no date stays last either way
        if (!b.job.date) return -1;
        return sign * a.job.date.localeCompare(b.job.date) || num(a, b);
      }
      case 'client': return sign * a.job.client.localeCompare(b.job.client) || num(a, b);
      case 'price': return sign * ((a.job.clientPrice ?? 0) - (b.job.clientPrice ?? 0)) || num(a, b);
      case 'stage': return sign * (STAGE_ORDER.indexOf(a.job.status) - STAGE_ORDER.indexOf(b.job.status)) || num(a, b);
      default: return sign * num(a, b);
    }
  };
  return [...rows].sort(cmp);
}

/** Grid and List show one stage at a time, or every open job ("All jobs" leaves out Closed). */
export function rowsForStage(rows: BoardRow[], stage: WfStatus | 'all'): BoardRow[] {
  return stage === 'all' ? rows.filter((r) => r.job.status !== 'closed') : rows.filter((r) => r.job.status === stage);
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="wf-card" style={{ width: 148, flexShrink: 0, padding: 16 }}>
      <div className="wf-p-label" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div className="wf-p-headline" style={{ color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

/** One job on the board or under a calendar day (Primio's DispatchCard). */
export function DispatchCard({ row, onOpen }: { row: BoardRow; onOpen: () => void }) {
  const { job } = row;
  const price = job.clientPrice ?? 0;
  return (
    <button className="wf-card wf-card-click" onClick={onOpen} aria-label={`WO ${job.number}: ${job.title}`}
      style={{ display: 'block', width: '100%', padding: 16, textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, color: 'var(--wf-gold)', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {job.number}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: job.highPriority ? 'var(--wf-danger)' : 'var(--wf-subtle)' }}>{job.priorityLabel}</span>
      </div>
      <div className="wf-p-title" style={{ marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{job.title}</div>
      {job.client && <div className="wf-p-small wf-subtle" style={{ marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.client}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }} className="wf-p-small">
        <MapPin size={15} color="var(--wf-subtle)" style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {[job.city, job.state].filter(Boolean).join(', ') || job.siteName || 'No address'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span className="wf-p-title" style={{ flex: 1 }}>{price > 0 ? fmtMoney(price) : <span className="wf-subtle" style={{ fontWeight: 500 }}>No price</span>}</span>
        <span className="wf-p-label" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%' }}>
          {job.serviceType || WF_WORK_TYPE_LABEL[workTypeFor(job.serviceType, job.title)]}
        </span>
      </div>
      {row.payNotSet && (
        <div style={{ marginTop: 8 }}>
          <span className="wf-chip" style={{ color: 'var(--wf-warning)', background: 'rgba(180,83,9,0.1)', padding: '1px 8px' }}>Tech pay not set</span>
        </div>
      )}
    </button>
  );
}

export function DispatchBoard({ rows, onOpen, right, between }: {
  rows: BoardRow[];
  onOpen: (job: WfJob) => void;
  /** App bar buttons (New order). */
  right?: ReactNode;
  /** Anything that needs Fred, between the numbers and the search (expenses, time asks). */
  between?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  // Board (Primio's columns), Grid (cards) or List (a table) — Fred, 2026-10-04:
  // "i need a grid, list view". The choice is remembered on this device.
  const [view, setView] = useState<DispatchView>('board');
  useEffect(() => {
    try { const v = localStorage.getItem('dispatch-view'); if (v === 'grid' || v === 'list') setView(v); } catch { /* private window */ }
  }, []);
  const chooseView = (v: DispatchView) => { setView(v); try { localStorage.setItem('dispatch-view', v); } catch { /* private window */ } };
  const [stage, setStage] = useState<WfStatus | 'all'>('all');
  const [sort, setSort] = useState<{ key: ListSort; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'asc' });
  const live = rows.filter((r) => r.job.status !== 'closed');
  const count = (s: WfStatus) => live.filter((r) => r.job.status === s).length;
  const urgent = live.filter((r) => r.job.highPriority).length;
  const shown = rows.filter((r) => matchesWf(r.job, query));
  const stageOptions = DISPATCH_COLUMNS
    .map((c) => ({ key: c.key, label: c.label, count: shown.filter((r) => r.job.status === c.key).length }))
    .filter((o) => o.count > 0);
  const flat = sortBoardRows(rowsForStage(shown, stage), sort.key, sort.dir);
  const sortBy = (key: ListSort) => setSort((sv) => ({ key, dir: sv.key === key && sv.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <div className="wf" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PrimioBar title="Dispatch board" right={right} />
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        <StatTile label="Total jobs" value={live.length} color="var(--wf-navy)" />
        <StatTile label="Needs a tech" value={count('open')} color={WF_STATUS_COLOR.open} />
        <StatTile label="Awaiting response" value={count('offered')} color={WF_STATUS_COLOR.offered} />
        <StatTile label="In progress" value={count('inProgress')} color={WF_STATUS_COLOR.inProgress} />
        <StatTile label="Work done" value={count('workDone')} color="var(--wf-success)" />
        <StatTile label="High priority" value={urgent} color="var(--wf-danger)" />
      </div>
      {between}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={18} color="var(--wf-subtle)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input className="wf-input" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ID, client, location or title" aria-label="Search the dispatch board" style={{ paddingLeft: 40 }} />
        </div>
        <div className="wf-filters" role="group" aria-label="How to show jobs" style={{ flexWrap: 'nowrap' }}>
          {([['board', 'Board', <Columns3 key="b" size={15} />], ['grid', 'Grid', <LayoutGrid key="g" size={15} />], ['list', 'List', <ListIcon key="l" size={15} />]] as const).map(([v, label, icon]) => (
            <button key={v} className="wf-filter" aria-pressed={view === v} onClick={() => chooseView(v)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{icon}{label}</button>
          ))}
        </div>
      </div>
      {view !== 'board' && (
        <Filters value={stage} options={stageOptions} onChange={setStage} total={rowsForStage(shown, 'all').length} />
      )}
      {view === 'grid' && (
        flat.length === 0
          ? <Empty title="No jobs here" message={query ? 'Nothing matches your search.' : 'Nothing in this stage right now.'} />
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 10, paddingBottom: 16 }}>
              {flat.map((r) => (
                <div key={r.job.id}>
                  <div style={{ marginBottom: 4 }}><StatusChip status={r.job.status} ownerView /></div>
                  <DispatchCard row={r} onOpen={() => onOpen(r.job)} />
                </div>
              ))}
            </div>
          )
      )}
      {view === 'list' && (
        flat.length === 0
          ? <Empty title="No jobs here" message={query ? 'Nothing matches your search.' : 'Nothing in this stage right now.'} />
          : <DispatchTable rows={flat} sort={sort} onSort={sortBy} onOpen={onOpen} />
      )}
      <div style={{ display: view === 'board' ? 'flex' : 'none', gap: 8, overflowX: 'auto', paddingBottom: 16, alignItems: 'stretch' }}>
        {DISPATCH_COLUMNS.map((col) => {
          let list = shown.filter((r) => r.job.status === col.key);
          // Closed reads newest first; the rest soonest first.
          list = col.key === 'closed'
            ? [...list].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
            : [...list].sort((a, b) => (a.job.date ?? '9999').localeCompare(b.job.date ?? '9999') || a.job.number.localeCompare(b.job.number, undefined, { numeric: true }));
          const color = col.key === 'workDone' ? 'var(--wf-success)' : WF_STATUS_COLOR[col.key];
          return (
            <section key={col.key} className="wf-dispatch-col">
              <div style={{ display: 'flex', alignItems: 'center', padding: 16, borderBottom: `2px solid ${color}` }}>
                <span className="wf-p-title" style={{ flex: 1, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{list.length}</span>
              </div>
              <div className="wf-dispatch-list">
                {list.length === 0
                  ? <div className="wf-p-small wf-subtle" style={{ textAlign: 'center', padding: '40px 0' }}>No jobs</div>
                  : list.map((r) => <DispatchCard key={r.job.id} row={r} onOpen={() => onOpen(r.job)} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** List view: one row per job. Tap a row to open it; tap a heading to sort. */
function DispatchTable({ rows, sort, onSort, onOpen }: {
  rows: BoardRow[];
  sort: { key: ListSort; dir: 'asc' | 'desc' };
  onSort: (k: ListSort) => void;
  onOpen: (job: WfJob) => void;
}) {
  const head = (label: string, key: ListSort | null, align: 'left' | 'right' = 'left') => (
    <th style={{ textAlign: align, padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--wf-subtle)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--wf-line)' }}>
      {key ? (
        <button onClick={() => onSort(key)} style={{ border: 'none', background: 'transparent', font: 'inherit', color: sort.key === key ? 'var(--wf-navy)' : 'inherit', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {label}{sort.key === key && (sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
        </button>
      ) : label}
    </th>
  );
  const cell: React.CSSProperties = { padding: '10px 12px', fontSize: 13.5, borderBottom: '1px solid var(--wf-line)', verticalAlign: 'top' };
  const day = (d: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
  return (
    <div className="wf-card" style={{ overflowX: 'auto', marginBottom: 16 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
        <thead>
          <tr>
            {head('WO #', 'number')}
            {head('Job', null)}
            {head('Client', 'client')}
            {head('City', null)}
            {head('Date', 'date')}
            {head('Tech', null)}
            {head('Stage', 'stage')}
            {head('Client pays', 'price', 'right')}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const j = r.job;
            const t = parseClockTime(j.startTime);
            return (
              <tr key={j.id} onClick={() => onOpen(j)} className="wf-row-click" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpen(j); }} aria-label={`Open WO ${j.number}`}>
                <td style={{ ...cell, fontWeight: 700, color: 'var(--wf-gold)', whiteSpace: 'nowrap' }}>
                  {j.number}{j.highPriority && <span style={{ color: 'var(--wf-danger)', marginLeft: 6 }} title="High priority">!</span>}
                </td>
                <td style={{ ...cell, fontWeight: 600, maxWidth: 320 }}>{j.title}</td>
                <td style={{ ...cell, maxWidth: 180 }}>{j.client || '—'}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{[j.city, j.state].filter(Boolean).join(', ') || '—'}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{day(j.date)}{t && <div className="wf-subtle" style={{ fontSize: 12 }}>{fmtClock12(t)}</div>}</td>
                <td style={{ ...cell, maxWidth: 160 }}>
                  {j.techs.length ? j.techs.join(', ') : <span style={{ color: 'var(--wf-danger)', fontWeight: 600 }}>No tech</span>}
                  {r.payNotSet && <div style={{ color: 'var(--wf-warning)', fontSize: 12, fontWeight: 600 }}>Pay not set</div>}
                </td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}><StatusChip status={j.status} ownerView /></td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{(j.clientPrice ?? 0) > 0 ? fmtMoney(j.clientPrice) : <span className="wf-subtle" style={{ fontWeight: 400 }}>—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Schedule ────────────────────────────────────────────────────────────────

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => addDays(d, -d.getDay());

/** The days a calendar page shows: whole weeks for a month, or one week. */
export function calendarDays(focused: Date, format: 'month' | 'week'): Date[] {
  if (format === 'week') {
    const s = startOfWeek(focused);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  const first = new Date(focused.getFullYear(), focused.getMonth(), 1);
  const last = new Date(focused.getFullYear(), focused.getMonth() + 1, 0);
  const s = startOfWeek(first);
  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(s, i));
}

const startMinutes = (j: WfJob) => { const t = parseClockTime(j.startTime); return t ? t[0] * 60 + t[1] : 24 * 60; };

export function ScheduleBoard({ rows, onOpen, right }: {
  rows: BoardRow[];
  onOpen: (job: WfJob) => void;
  right?: ReactNode;
}) {
  const today = todayISO();
  const [selected, setSelected] = useState(today);
  const [focused, setFocused] = useState(() => fromYmd(today));
  const [format, setFormat] = useState<'month' | 'week'>('month');

  // Every job with a date, except ones every tech turned down (as in Primio).
  const byDay = useMemo(() => {
    const m = new Map<string, BoardRow[]>();
    for (const r of rows) {
      if (!r.job.date || r.job.status === 'declined') continue;
      const list = m.get(r.job.date) ?? [];
      list.push(r);
      m.set(r.job.date, list);
    }
    for (const list of m.values()) list.sort((a, b) => startMinutes(a.job) - startMinutes(b.job));
    return m;
  }, [rows]);

  const days = calendarDays(focused, format);
  const dayRows = byDay.get(selected) ?? [];
  const sel = fromYmd(selected);
  const page = (dir: 1 | -1) => setFocused((f) => format === 'week' ? addDays(f, 7 * dir) : new Date(f.getFullYear(), f.getMonth() + dir, 1));
  const title = format === 'week'
    ? (() => { const s = days[0], e = days[6]; return s.getMonth() === e.getMonth() ? `${MONTHS[s.getMonth()]} ${s.getFullYear()}` : `${MONTHS[s.getMonth()].slice(0, 3)} – ${MONTHS[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`; })()
    : `${MONTHS[focused.getMonth()]} ${focused.getFullYear()}`;

  return (
    <div className="wf" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PrimioBar title="Schedule" right={right} />
      <div className="wf-card" style={{ padding: '12px 12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => page(-1)} aria-label="Previous"><ChevronLeft size={20} /></button>
          <div className="wf-p-title" style={{ flex: 1, textAlign: 'center', fontSize: 16 }}>{title}</div>
          <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setFormat((f) => (f === 'month' ? 'week' : 'month'))}
            aria-label="Switch between month and week" style={{ borderRadius: 12 }}>
            {format === 'month' ? 'Month' : 'Week'}
          </button>
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => page(1)} aria-label="Next"><ChevronRight size={20} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 4 }}>
          {DOW.map((d) => <div key={d} className="wf-p-small wf-subtle" style={{ textAlign: 'center', padding: '6px 0' }}>{d}</div>)}
          {days.map((d) => {
            const key = ymd(d);
            const isSel = key === selected;
            const isToday = key === today;
            const outside = format === 'month' && d.getMonth() !== focused.getMonth();
            const n = byDay.get(key)?.length ?? 0;
            return (
              <button key={key} onClick={() => { setSelected(key); if (outside) setFocused(new Date(d.getFullYear(), d.getMonth(), 1)); }}
                aria-label={`${d.toDateString()}${n ? `, ${n} job${n === 1 ? '' : 's'}` : ''}`} aria-pressed={isSel}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, font: 'inherit' }}>
                <span style={{
                  width: 36, height: 36, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                  background: isSel ? 'var(--wf-navy)' : isToday ? 'var(--wf-gold)' : 'transparent',
                  color: isSel ? '#fff' : isToday ? 'var(--wf-gold-ink)' : outside ? '#B9B4AA' : 'var(--wf-text)',
                  fontWeight: isSel || isToday ? 700 : 500,
                }}>{d.getDate()}</span>
                <span style={{ display: 'flex', gap: 2, height: 6 }}>
                  {Array.from({ length: Math.min(n, 4) }, (_, i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--wf-gold)' }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="wf-p-title" style={{ fontSize: 16 }}>
        {dayRows.length} job{dayRows.length === 1 ? '' : 's'} on {sel.getMonth() + 1}/{sel.getDate()}/{sel.getFullYear()}
      </div>
      {dayRows.length === 0 ? (
        <Empty icon={<CalendarCheck size={34} />} title="Nothing scheduled" message="No jobs on this day. Create one from New order." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dayRows.map((r) => {
            const t = parseClockTime(r.job.startTime);
            return (
              <div key={r.job.id}>
                {t && <div className="wf-p-label" style={{ margin: '0 0 4px 4px' }}>{fmtClock12(t)}</div>}
                <DispatchCard row={r} onOpen={() => onOpen(r.job)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
