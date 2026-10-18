'use client';
// The project day on a tech's phone (Fred, 2026-10-13). One big next step at
// a time: Start travel → Start job → Lunch / Off site → Travel to the hotel,
// home or the next site → Arrived. The timer at the top shows time on site
// (lunch taken out) with Off site beside it. Every tap carries GPS; the miles
// for each drive are worked out from it. No money on this screen.
import { useEffect, useMemo, useState } from 'react';
import { Car, CheckCircle2, Clock, LogIn, LogOut, MapPin, PlayCircle, Receipt, Utensils } from 'lucide-react';
import {
  buildDayLogs, dayOf, dayState, legLabel, onSiteMs, DEST_LABEL, TRIPS,
  type DayLog, type DayState, type Origin, type Trip,
} from '@/lib/project-day';
import { formatDuration, type WfJob } from '@/lib/wf';
import { Dialog } from './WfUi';

const TZ = 'America/New_York';
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** Re-render every 20 seconds so the timers move. */
function useTick(ms = 20_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const big: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', minHeight: 54,
  borderRadius: 14, border: 'none', font: 'inherit', fontWeight: 700, fontSize: 16.5, cursor: 'pointer',
};
const gold: React.CSSProperties = { ...big, background: 'var(--wf-gold)', color: 'var(--wf-gold-ink)' };
const navy: React.CSSProperties = { ...big, background: 'var(--wf-navy)', color: '#fff' };
const red: React.CSSProperties = { ...big, background: 'var(--wf-danger)', color: '#fff' };
const plain: React.CSSProperties = { ...big, background: 'var(--wf-card)', color: 'var(--wf-text)', border: '1px solid var(--wf-line)' };

export type DayActions = {
  /** Clock in: the start of the day (Fred, 2026-10-13: "it should start with clock-in"). */
  clockIn: () => void;
  /** Check in: pick the drive, the starting mileage, the office's items (components/wf/CheckIn.tsx). Replaces Clock in and Start travel where given. */
  checkIn?: () => void;
  /** Start travel, for the trip picked in the dropdown; `from` when the tech said where they're leaving from. */
  startTrip: (trip: Trip, from?: Origin) => void;
  startJob: () => void;
  lunch: (start: boolean) => void;
  offSite: () => void;
  arrived: () => void;
};

export default function ProjectDayCard({ job, busy, enabled, on, onReceipt }: {
  job: WfJob; busy: boolean;
  /** The job is accepted and still open (or Work done, to drive home after). */
  enabled: boolean;
  on: DayActions;
  /** Gas, a meal or the hotel on the road (shown when not on site). */
  onReceipt?: () => void;
}) {
  const now = useTick();
  const events = job.myDay ?? [];
  const st = dayState(events, now, TZ);
  // The dropdown starts on Site in the morning and on Hotel once off site.
  const [trip, setTrip] = useState<Trip | null>(null);
  const picked: Trip = trip ?? (st.stage === 'offsite' ? 'hotel' : 'site');
  const today = dayOf(now.toISOString(), TZ);
  const todayLog = useMemo(
    () => buildDayLogs(events, now, TZ).find((d) => d.day === today) ?? null,
    [events, now, today],
  );
  const off = !enabled || busy;

  return (
    <div className="wf-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'rgba(201,162,39,0.45)' }}>
      <Header st={st} now={now} onSite={onSiteMs(st, now)} />

      {st.stage === 'ready' && (
        <button style={gold} disabled={off} onClick={on.clockIn}><Clock size={20} /> Clock in</button>
      )}

      {(st.stage === 'clocked' || st.stage === 'offsite') && (
        <>
          {/* Fred, 2026-10-13: "hotel home site between site ... make it a drop down". */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="wf-label">Travel to</span>
            <select className="wf-input" value={picked} onChange={(e) => setTrip(e.target.value as Trip)}
              disabled={st.stage === 'clocked' ? off : busy} style={{ fontSize: 16, minHeight: 48 }}>
              {TRIPS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <button style={gold} disabled={st.stage === 'clocked' ? off : busy}
            onClick={() => { setTrip(null); on.startTrip(picked); }}><Car size={20} /> Start travel</button>
          {st.stage === 'clocked' && (
            <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={off} onClick={on.startJob}>Already on site? Start job</button>
          )}
        </>
      )}

      {st.stage === 'travel' && st.dest === 'site' && (
        <button style={gold} disabled={off} onClick={on.startJob}><PlayCircle size={21} /> Start job</button>
      )}

      {st.stage === 'travel' && st.dest === 'next_site' && (
        <button style={navy} disabled={busy} onClick={on.arrived}><LogIn size={20} /> Arrived at the next site</button>
      )}

      {st.stage === 'travel' && (st.dest === 'fuel' || st.dest === 'materials') && (
        <button style={navy} disabled={busy} onClick={on.arrived}><LogIn size={20} /> Arrived at the {st.dest === 'fuel' ? 'fuel stop' : 'materials pickup'}</button>
      )}

      {st.stage === 'travel' && (st.dest === 'hotel' || st.dest === 'home') && (
        <button style={navy} disabled={busy} onClick={on.arrived}><LogIn size={20} /> Arrived — sign out</button>
      )}

      {(st.stage === 'onsite' || st.stage === 'lunch') && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {st.stage === 'onsite'
            ? <button style={plain} disabled={busy} onClick={() => on.lunch(true)}><Utensils size={19} /> Lunch</button>
            : <button style={gold} disabled={busy} onClick={() => on.lunch(false)}><Utensils size={19} /> Back from lunch</button>}
          <button style={red} disabled={busy} onClick={on.offSite}><LogOut size={19} /> Off site</button>
        </div>
      )}

      {busy && <div className="wf-subtle" style={{ fontSize: 12.5, textAlign: 'center' }}>Getting your location…</div>}
      {onReceipt && st.stage !== 'onsite' && st.stage !== 'lunch' && (
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onReceipt}><Receipt size={15} /> Add a receipt (gas, meal, hotel)</button>
      )}
      {todayLog && <DayLines log={todayLog} />}
    </div>
  );
}

function Header({ st, now, onSite }: { st: DayState; now: Date; onSite: number }) {
  const since = (iso: string) => formatDuration(Math.max(0, now.getTime() - Date.parse(iso)));
  let title = 'Ready to go';
  let line = 'Clock in to start your day.';
  let timer: string | null = null;
  if (st.stage === 'clocked') {
    title = 'Clocked in';
    line = `Since ${timeOf(st.since)}. Where are you going?`;
    timer = since(st.since);
  } else if (st.stage === 'travel') {
    title = st.dest === 'site' ? 'Travelling to the site' : st.dest === 'next_site' ? 'Travelling between sites'
      : `Travelling to ${DEST_LABEL[st.dest].toLowerCase()}`;
    line = `Left at ${timeOf(st.since)}`;
    timer = since(st.since);
  } else if (st.stage === 'onsite') {
    title = 'On site';
    line = `Started at ${timeOf(st.since)}${st.lunchMs ? ` · lunch ${formatDuration(st.lunchMs)}` : ''}`;
    timer = formatDuration(onSite);
  } else if (st.stage === 'lunch') {
    title = 'At lunch';
    line = `Since ${timeOf(st.since)} · on site ${formatDuration(onSite)} so far`;
    timer = since(st.since);
  } else if (st.stage === 'offsite') {
    title = 'Off site';
    line = `Left the site at ${timeOf(st.since)}. Where to now?`;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="wf-label" style={{ color: 'var(--wf-gold)' }}>Project day</div>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{title}</div>
        <div className="wf-subtle" style={{ fontSize: 12.5 }}>{line}</div>
      </div>
      {timer && <div className="wf-display" style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{timer}</div>}
    </div>
  );
}

/** Today's drives and time on site, under the buttons. */
function DayLines({ log }: { log: DayLog }) {
  const rows: { at: string; icon: React.ReactNode; text: string }[] = [
    ...(log.clockIn ? [{ at: log.clockIn, icon: <Clock size={14} />, text: `Clocked in · ${timeOf(log.clockIn)}` }] : []),
    ...log.legs.map((l) => ({
      at: l.start, icon: <Car size={14} />,
      text: `${legLabel(l)} · ${timeOf(l.start)}–${l.end ? timeOf(l.end) : 'now'} · ${formatDuration(l.ms)}${l.miles != null ? ` · ${l.miles} mi` : ''}`,
    })),
    ...log.spans.map((s) => ({
      at: s.in, icon: <MapPin size={14} />,
      text: `On site · ${timeOf(s.in)}–${s.out ? timeOf(s.out) : 'now'} · ${formatDuration(s.ms)}${s.lunchMs ? ` (lunch ${formatDuration(s.lunchMs)})` : ''}`,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (rows.length === 0) return null;
  return (
    <div style={{ borderTop: '1px solid var(--wf-line)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="wf-label">Today</div>
      {rows.map((r) => (
        <div key={r.at + r.text} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <span style={{ color: 'var(--wf-subtle)', display: 'inline-flex' }}>{r.icon}</span>{r.text}
        </div>
      ))}
      {log.miles > 0 && <div className="wf-subtle" style={{ fontSize: 12 }}>{log.miles} miles today (from GPS — the office can correct it)</div>}
    </div>
  );
}

/**
 * Leaving the site: coming back another day, or the site is finished. A
 * finished site needs everything the job asks for first — each photo taken or
 * a reason why not, the signature or a reason why not.
 */
export function OffSiteDialog({ missing, needs, signature = true, clientCheckout = false, onClose, onBack, onFinished }: {
  missing: string[];
  /**
   * What this job needs before it can be finished, in words ("the photos", "the
   * signature"). Nothing listed says nothing (Fred, 2026-10-18: "Check list not
   * needed"). Left out, the old wording stays.
   */
  needs?: string[];
  /** Whether finishing needs the customer's sign-off (always on a project site). */
  signature?: boolean;
  /**
   * The job has the client's own checkout form (migration 133): no report of
   * ours for the day; their form opens next (Fred, 2026-10-18: "when they're
   * checking out, it's supposed to go to the LDS checkout form, not to our form").
   */
  clientCheckout?: boolean;
  onClose: () => void;
  /** Coming back: what got done today and what's still left (Fred, 2026-10-14). */
  onBack: (report: { done: string; left: string }) => void;
  onFinished: () => void;
}) {
  const [finish, setFinish] = useState(false);
  const [back, setBack] = useState(false);
  const [done, setDone] = useState('');
  const [left, setLeft] = useState('');
  if (back) {
    return (
      <Dialog title="Before you go: today's report" onClose={onClose}
        footer={<>
          <button className="wf-btn wf-btn-ghost" onClick={() => setBack(false)}>Back</button>
          <button className="wf-btn wf-btn-navy" disabled={!done.trim()} onClick={() => onBack({ done: done.trim(), left: left.trim() })}>
            <LogOut size={17} /> Send and go off site
          </button>
        </>}>
        <label className="wf-label" htmlFor="eod-done">What got done today?</label>
        <textarea id="eod-done" className="wf-input" rows={3} autoFocus value={done} maxLength={900} onChange={(e) => setDone(e.target.value)}
          style={{ fontSize: 16, marginBottom: 10 }} placeholder="e.g. Ran 12 drops on the 2nd floor, mounted the rack, tested 8 lines" />
        <label className="wf-label" htmlFor="eod-left">What's still left?</label>
        <textarea id="eod-left" className="wf-input" rows={3} value={left} maxLength={900} onChange={(e) => setLeft(e.target.value)}
          style={{ fontSize: 16 }} placeholder="e.g. Terminate and test the last 4 drops, label the patch panel" />
        <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: 6 }}>
          This goes on the project sheet for the project manager. Next, pick where you&apos;re heading and the drive is timed.
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title="Leaving the site" onClose={onClose}
      footer={finish ? <>
        <button className="wf-btn wf-btn-ghost" onClick={() => setFinish(false)}>Back</button>
        <button className="wf-btn wf-btn-navy" disabled={missing.length > 0} onClick={onFinished}>
          <CheckCircle2 size={17} /> Site finished — off site
        </button>
      </> : <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>}>
      {!finish ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button style={plain} onClick={() => (clientCheckout ? onBack({ done: '', left: '' }) : setBack(true))}><LogOut size={19} /> Coming back to this site</button>
          <button style={navy} onClick={() => setFinish(true)}><CheckCircle2 size={19} /> This site is finished</button>
          <div className="wf-subtle" style={{ fontSize: 12.5 }}>
            Finished sends the job to the office.
            {needs
              ? (needs.length ? ` First finish ${needs.length > 1 ? `${needs.slice(0, -1).join(', ')} and ${needs.at(-1)}` : needs[0]}.` : '')
              : ` Every photo${signature ? ', the checklist and the signature need' : ' and the checklist need'} to be done first.`}
          </div>
        </div>
      ) : missing.length > 0 ? (
        <div>
          <p style={{ marginTop: 0, fontWeight: 600 }}>Before you can leave a finished site:</p>
          <ul style={{ margin: '0 0 10px', paddingLeft: 20 }}>
            {missing.map((m) => <li key={m} style={{ marginBottom: 4 }}>{m}</li>)}
          </ul>
          <div className="wf-subtle" style={{ fontSize: 12.5 }}>
            Can&apos;t get a photo or the signature? Tap <b>Can&apos;t do it</b>{' '}next to it under Closeout and say why
            (for example &quot;Contact not on site&quot;).
          </div>
        </div>
      ) : (
        <p style={{ margin: 0 }}>Everything is in. This sends the job to the office and stops your time on site.</p>
      )}
    </Dialog>
  );
}
