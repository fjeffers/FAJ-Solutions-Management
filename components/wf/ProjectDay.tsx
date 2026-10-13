'use client';
// The project day on a tech's phone (Fred, 2026-10-13). One big next step at
// a time: Start travel → Start job → Lunch / Off site → Travel to the hotel,
// home or the next site → Arrived. The timer at the top shows time on site
// (lunch taken out) with Off site beside it. Every tap carries GPS; the miles
// for each drive are worked out from it. No money on this screen.
import { useEffect, useMemo, useState } from 'react';
import { BedDouble, Car, CheckCircle2, Home, LogIn, LogOut, MapPin, Navigation, PlayCircle, Utensils } from 'lucide-react';
import {
  buildDayLogs, dayOf, dayState, legLabel, onSiteMs, DEST_LABEL,
  type DayLog, type DayState, type Dest, type Origin,
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
  startTravel: (origin: Origin) => void;
  startJob: () => void;
  lunch: (start: boolean) => void;
  offSite: () => void;
  travelAfter: (dest: Dest) => void;
  arrived: () => void;
};

export default function ProjectDayCard({ job, busy, enabled, on }: {
  job: WfJob; busy: boolean;
  /** The job is accepted and still open (or Work done, to drive home after). */
  enabled: boolean;
  on: DayActions;
}) {
  const now = useTick();
  const events = job.myDay ?? [];
  const st = dayState(events, now, TZ);
  const [picking, setPicking] = useState(false);
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
        picking ? (
          <>
            <div className="wf-subtle" style={{ fontSize: 13 }}>Where are you leaving from?</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button style={gold} disabled={off} onClick={() => { setPicking(false); on.startTravel('home'); }}><Home size={19} /> Home</button>
              <button style={gold} disabled={off} onClick={() => { setPicking(false); on.startTravel('hotel'); }}><BedDouble size={19} /> Hotel</button>
            </div>
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setPicking(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button style={gold} disabled={off} onClick={() => setPicking(true)}><Car size={20} /> Start travel</button>
            <button className="wf-btn wf-btn-ghost wf-btn-sm" disabled={off} onClick={on.startJob}>Already on site? Start job</button>
          </>
        )
      )}

      {st.stage === 'travel' && st.dest === 'site' && (
        <button style={gold} disabled={off} onClick={on.startJob}><PlayCircle size={21} /> Start job</button>
      )}

      {st.stage === 'travel' && st.dest !== 'site' && (
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

      {st.stage === 'offsite' && (
        <>
          <div className="wf-subtle" style={{ fontSize: 13 }}>Off site. Where are you heading?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <button style={{ ...navy, fontSize: 14.5, flexDirection: 'column', gap: 4, minHeight: 70 }} disabled={busy} onClick={() => on.travelAfter('hotel')}><BedDouble size={20} /> Hotel</button>
            <button style={{ ...navy, fontSize: 14.5, flexDirection: 'column', gap: 4, minHeight: 70 }} disabled={busy} onClick={() => on.travelAfter('home')}><Home size={20} /> Home</button>
            <button style={{ ...navy, fontSize: 14.5, flexDirection: 'column', gap: 4, minHeight: 70 }} disabled={busy} onClick={() => on.travelAfter('next_site')}><Navigation size={20} /> Next site</button>
          </div>
        </>
      )}

      {busy && <div className="wf-subtle" style={{ fontSize: 12.5, textAlign: 'center' }}>Getting your location…</div>}
      {todayLog && <DayLines log={todayLog} />}
    </div>
  );
}

function Header({ st, now, onSite }: { st: DayState; now: Date; onSite: number }) {
  const since = (iso: string) => formatDuration(Math.max(0, now.getTime() - Date.parse(iso)));
  let title = 'Ready to go';
  let line = 'Tap Start travel when you leave.';
  let timer: string | null = null;
  if (st.stage === 'travel') {
    title = st.dest === 'site' ? 'Travelling to the site' : `Travelling to ${DEST_LABEL[st.dest].toLowerCase()}`;
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
    line = `Left the site at ${timeOf(st.since)}`;
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
export function OffSiteDialog({ missing, onClose, onBack, onFinished }: {
  missing: string[];
  onClose: () => void;
  onBack: () => void;
  onFinished: () => void;
}) {
  const [finish, setFinish] = useState(false);
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
          <button style={plain} onClick={onBack}><LogOut size={19} /> Coming back to this site</button>
          <button style={navy} onClick={() => setFinish(true)}><CheckCircle2 size={19} /> This site is finished</button>
          <div className="wf-subtle" style={{ fontSize: 12.5 }}>
            Finished sends the job to the office. Every photo, the checklist and the signature need to be done first.
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
