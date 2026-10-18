'use client';
// Field Service LIVE's work order screen pieces for the FAJ tech portal (Fred,
// 2026-10-18: FAJ techs get the Field Service tech screens on FAJ's own data).
// Ported from FieldService.app app/components/operations.js (WorkSections,
// NextAction) and field.js (StageAction). The stage buttons send FAJ's own day
// taps (DayActions) through the outbox, so they work with no signal. Styles
// live in app/tech/fs.css under fs- names.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { buildDayLogs, dayState, lastPlace, legLabel, onSiteMs, TRIPS, type DayEvent, type Origin, type Trip } from '@/lib/project-day';
import { FS_STAGE_NAME, type FsStage } from '@/lib/fs-stage';
import { formatDuration } from '@/lib/wf';
import type { DayActions } from './ProjectDay';
import { FsChip, FsIcon } from './FsUi';

const TZ = 'America/New_York';
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

export type FsSection = 'overview' | 'documents' | 'evidence' | 'time' | 'expenses' | 'messages';
export const FS_SECTIONS: [FsSection, string][] = [
  ['overview', 'Overview'],
  ['documents', 'Documents'],
  ['evidence', 'Photos & questions'],
  ['time', 'Time & travel'],
  ['expenses', 'Expenses'],
  ['messages', 'Messages'],
];

/** The work order's tabs. Only the open tab is rendered, so a closed tab doesn't load or mark anything read. */
export function FsWorkSections({ active, onChange, panels }: {
  active: FsSection; onChange: (s: FsSection) => void; panels: Record<FsSection, ReactNode>;
}) {
  const move = (e: KeyboardEvent, index: number) => {
    const n = FS_SECTIONS.length;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1
      : e.key === 'ArrowRight' ? (index + 1) % n : e.key === 'ArrowLeft' ? (index + n - 1) % n : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(FS_SECTIONS[next][0]);
    document.getElementById(`fs-section-tab-${FS_SECTIONS[next][0]}`)?.focus();
  };
  return (
    <div className="fs-work-sections">
      <div className="fs-work-section-tabs" role="tablist" aria-label="Work order sections">
        {FS_SECTIONS.map(([id, label], index) => (
          <button key={id} id={`fs-section-tab-${id}`} type="button" role="tab" aria-controls={`fs-section-panel-${id}`}
            aria-selected={active === id} tabIndex={active === id ? 0 : -1} onClick={() => onChange(id)} onKeyDown={(e) => move(e, index)}>
            {label}
          </button>
        ))}
      </div>
      {FS_SECTIONS.map(([id]) => (
        <section key={id} role="tabpanel" id={`fs-section-panel-${id}`} aria-labelledby={`fs-section-tab-${id}`} hidden={active !== id} tabIndex={0}>
          {active === id && panels[id]}
        </section>
      ))}
    </div>
  );
}

export function FsNextAction({ text, onContinue }: { text: string; onContinue: () => void }) {
  return (
    <div className="fs-next-action">
      <span><small>YOUR NEXT STEP</small><b>{text}</b></span>
      <button type="button" className="fs-btn fs-btn-secondary" onClick={onContinue}>
        Continue <FsIcon name="arrow" size={16} />
      </button>
    </div>
  );
}

/** Re-render every 20 seconds so the timers move. */
function useTick(ms = 20_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const FROM: { key: Origin; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'other', label: 'Somewhere else' },
];
const ARRIVE: Record<string, string> = {
  site: 'Arrive on site', next_site: 'Arrive at the next site', hotel: 'Arrive at the hotel', home: 'Arrive home',
};

/**
 * The one thing to do next, in Field Service's words, sending FAJ's day taps.
 * Every drive is its own leg with its own miles: home → hotel, hotel → site,
 * site → hotel, and the hotel → home on the last day (Fred, 2026-10-18).
 * Stopped work is resolved from the problem bar above it (SiteAccessBar).
 */
export function FsStageAction({ stage, events, busy, enabled, on, onReceipt }: {
  stage: FsStage;
  /** The tech's own taps on this job (job.myDay). */
  events: DayEvent[];
  busy: boolean;
  /** The job is accepted and still open. Driving home and lunch still work after Work done. */
  enabled: boolean;
  on: DayActions;
  /** Gas, a meal or the hotel on the road (shown when not on site). */
  onReceipt?: () => void;
}) {
  const now = useTick();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [from, setFrom] = useState<Origin>('home');
  const st = dayState(events, now, TZ);
  const picked: Trip = trip ?? (stage === 'offsite' ? 'hotel' : 'site');
  // The first drive on a job: nothing says where they're leaving from, so ask.
  const askFrom = stage === 'clocked' && picked !== 'between' && lastPlace(events, now, TZ) === null;
  const off = !enabled || busy;
  const since = 'since' in st ? st.since : null;
  const line = stage === 'onsite' || stage === 'lunch' ? `On site ${formatDuration(onSiteMs(st, now))}${'lunchMs' in st && st.lunchMs ? ` · lunch ${formatDuration(st.lunchMs)}` : ''}`
    : since && stage !== 'done' ? `Since ${timeOf(since)}` : null;
  const travel = (
    <form className="fs-card fs-form" onSubmit={(e) => { e.preventDefault(); setTrip(null); on.startTrip(picked, askFrom ? from : undefined); }}>
      <h3>{stage === 'offsite' ? 'Where to now?' : 'Start travel'}</h3>
      {askFrom && (
        <label>
          Leaving from
          <select value={from} onChange={(e) => setFrom(e.target.value as Origin)} disabled={off}>
            {FROM.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
      )}
      <label>
        Travel to
        <select value={picked} onChange={(e) => setTrip(e.target.value as Trip)} disabled={stage === 'clocked' ? off : busy}>
          {TRIPS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </label>
      <button className="fs-btn fs-btn-primary" disabled={stage === 'clocked' ? off : busy}>
        <FsIcon name="travel" size={18} /> {picked === 'site' ? 'Start travel to site' : 'Start travel'}
      </button>
      {stage === 'clocked' && (
        <button type="button" className="fs-text-button" disabled={off} onClick={on.startJob}>Already on site? Confirm arrival</button>
      )}
    </form>
  );
  let action: ReactNode = null;
  switch (stage) {
    case 'ready':
      action = <button type="button" className="fs-btn fs-btn-primary fs-btn-big" disabled={off} onClick={on.clockIn}><FsIcon name="clock" /> Clock in</button>;
      break;
    case 'clocked':
    case 'offsite':
      action = travel;
      break;
    case 'outbound':
    case 'returning': {
      // Arriving on site starts the job; anywhere else ends the drive (and at
      // the hotel or home, signs out for the day).
      const dest = st.stage === 'travel' ? st.dest : 'site';
      action = (
        <div className="fs-card fs-form">
          <h3>{ARRIVE[dest]}</h3>
          <p className="fs-muted">
            Your miles for this drive are worked out from your location when you tap.
            {dest === 'hotel' || dest === 'home' ? ' This signs you out for the day.' : ''}
          </p>
          <button type="button" className="fs-btn fs-btn-primary" disabled={dest === 'site' ? off : busy}
            onClick={dest === 'site' ? on.startJob : on.arrived}>Confirm arrival</button>
        </div>
      );
      break;
    }
    case 'onsite':
      action = (
        <div className="fs-stack">
          <button type="button" className="fs-btn fs-btn-secondary" disabled={busy} onClick={() => on.lunch(true)}>Start lunch</button>
          <div className="fs-card fs-form">
            <h3>Finish on site</h3>
            <p className="fs-muted">Send today&apos;s report when you&apos;re coming back, or finish the site.</p>
            <button type="button" className="fs-btn fs-btn-primary" disabled={busy} onClick={on.offSite}>Off site</button>
          </div>
        </div>
      );
      break;
    case 'lunch':
      action = <button type="button" className="fs-btn fs-btn-primary fs-btn-big" disabled={busy} onClick={() => on.lunch(false)}>Back from lunch</button>;
      break;
    case 'stopped':
      action = (
        <div className="fs-card fs-stop">
          <b>Work stopped</b>
          <p>Your project manager has been told. Tap the button above when you&apos;re back to work.</p>
        </div>
      );
      break;
    case 'done':
      // Signed out at the hotel, and still driving on today (the hotel to the site).
      action = (
        <div className="fs-card fs-form">
          <h3>Signed out for the day</h3>
          <p className="fs-muted">Heading out again today? Clock in, then start the drive.</p>
          <button type="button" className="fs-btn fs-btn-secondary" disabled={off} onClick={on.clockIn}><FsIcon name="clock" size={18} /> Clock in again</button>
        </div>
      );
      break;
  }
  return (
    <div className="fs-stack">
      <div className="fs-stage-line">
        <FsChip tone={stage === 'stopped' ? 'red' : stage === 'ready' || stage === 'done' ? 'grey' : 'green'} dot={stage !== 'ready' && stage !== 'done'}>
          {FS_STAGE_NAME[stage]}
        </FsChip>
        {line && <span>{line}</span>}
      </div>
      {action}
      {busy && <p className="fs-muted">Getting your location…</p>}
      {onReceipt && stage !== 'onsite' && stage !== 'lunch' && stage !== 'stopped' && (
        <button type="button" className="fs-text-button" onClick={onReceipt}>
          <FsIcon name="receipt" size={16} /> Add a receipt (gas, meal, hotel)
        </button>
      )}
    </div>
  );
}

/** Time & travel: each day's clock in, drives and time on site, newest day first. */
export function FsDayLog({ events }: { events: DayEvent[] }) {
  const now = useTick(60_000);
  const logs = buildDayLogs(events, now, TZ).reverse();
  if (logs.length === 0) return <p className="fs-muted">Nothing recorded yet. Your clock in, drives and time on site show here.</p>;
  return (
    <div className="fs-stack">
      {logs.map((log) => {
        const rows = [
          ...(log.clockIn ? [{ at: log.clockIn, title: 'Clocked in', detail: timeOf(log.clockIn) }] : []),
          ...log.legs.map((l) => ({
            at: l.start, title: legLabel(l),
            detail: `${timeOf(l.start)}–${l.end ? timeOf(l.end) : 'now'} · ${formatDuration(l.ms)}${l.miles != null ? ` · ${l.miles} mi` : ''}`,
          })),
          ...log.spans.map((s) => ({
            at: s.in, title: 'On site',
            detail: `${timeOf(s.in)}–${s.out ? timeOf(s.out) : 'now'} · ${formatDuration(s.ms)}${s.lunchMs ? ` (lunch ${formatDuration(s.lunchMs)})` : ''}`,
          })),
        ].sort((a, b) => a.at.localeCompare(b.at));
        const day = new Date(`${log.day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
        return (
          <div key={log.day + log.tech}>
            <h4 className="fs-day-title">{day}</h4>
            <ul className="fs-timeline">
              {rows.map((r) => <li key={r.at + r.title}><i /><div><b>{r.title}</b><small>{r.detail}</small></div></li>)}
            </ul>
            <p className="fs-muted">
              On site {formatDuration(log.onSiteMs)} · travel {formatDuration(log.travelMs)}{log.miles > 0 ? ` · ${log.miles} mi (from GPS — the office can correct it)` : ''}
            </p>
          </div>
        );
      })}
    </div>
  );
}
