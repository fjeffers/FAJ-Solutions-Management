'use client';
// WorkFlow's job screen, in the FAJ app. The same layout for the office and for
// a tech; what differs is passed in — the office adds Techs, Money and its own
// buttons, a tech gets the time clock and Accept / Work done. A tech's job never
// carries money (lib/wf.ts), so there is nothing here to hide from them.
import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft, CalendarDays, CheckCircle2, Circle, FileCheck2, Info, KeyRound,
  Mail, MapPin, Navigation, ParkingSquare, Phone, PlayCircle, RefreshCw, StopCircle, Timer, TriangleAlert, Wrench,
} from 'lucide-react';
import {
  WF_WORK_TYPE_LABEL, workTypeFor, whenText, place, fullAddress, tasksDone, isClockedIn, workedMs, wfStatusLabel,
  formatClock, formatDuration, parseClockTime, fmtClock12, type WfJob, type WfTask,
} from '@/lib/wf';
import { Section } from './WfUi';
import { PrimioBar } from './PrimioScreens';
import { fmtMoney } from '@/lib/utils';

export const mapsSearch = (j: WfJob) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress(j))}`;
export const mapsDirections = (j: WfJob) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress(j))}`;

function InfoItem({ icon, title, lines }: { icon: ReactNode; title: string; lines: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
      <span style={{ color: 'var(--wf-gold)', flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
        {lines.filter(Boolean).map((l) => <div key={l} className="wf-subtle" style={{ fontSize: 12.5 }}>{l}</div>)}
      </div>
    </div>
  );
}

/**
 * Primio's work order header (widgets/detail/wo_header.dart): the stage badge
 * and #number, "City - title", the company, then four key facts. The office
 * also sees who is on it and what the client pays; a tech sees no money.
 */
export function DetailHeader({ job, ownerView }: { job: WfJob; ownerView: boolean }) {
  const logged = workedMs(job);
  const type = workTypeFor(job.serviceType, job.title);
  const city = place(job);
  const times = [job.startTime, job.endTime].filter(Boolean).map(fmtTime).join(' – ');
  return (
    <div className="wf-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ background: 'var(--wf-navy)', color: '#fff', borderRadius: 8, padding: '3px 8px', fontSize: 12, fontWeight: 500 }}>
          {wfStatusLabel(job.status, ownerView)}
        </span>
        <h2 className="wf-title" style={{ fontSize: 20 }}>#{job.number}</h2>
        {ownerView && job.officeStatus && <span className="wf-subtle" style={{ fontSize: 12 }}>Office stage: {job.officeStatus}</span>}
      </div>
      <div className="wf-p-title" style={{ marginTop: 8 }}>{city ? `${city} - ${job.title}` : job.title}</div>
      {job.client && <div className="wf-p-small wf-subtle">Company: {job.client}</div>}
      {ownerView && (
        <div style={{ fontSize: 13, marginTop: 4, color: job.techs.length ? 'var(--wf-subtle)' : 'var(--wf-danger)', fontWeight: job.techs.length ? 400 : 700 }}>
          {job.techs.length ? `Tech: ${job.techs.join(', ')}` : 'No tech yet'}
        </div>
      )}
      <hr style={{ border: 'none', borderTop: '1px solid var(--wf-line)', margin: '12px 0' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 16px' }}>
        <InfoItem icon={<Info size={16} />} title={`Status: ${wfStatusLabel(job.status, ownerView)}`}
          lines={[`Time logged: ${logged ? formatDuration(logged) : '0m'}`, whenText(job)]} />
        <InfoItem icon={<MapPin size={16} />} title={`Location: ${(ownerView ? city || job.siteName : job.siteName || city) || 'not set'}`} lines={[fullAddress(job)]} />
        <InfoItem icon={<Wrench size={16} />} title="Work type" lines={[job.serviceType || WF_WORK_TYPE_LABEL[type], `${job.priorityLabel} priority`]} />
        <InfoItem icon={<CalendarDays size={16} />} title="Schedule"
          lines={[times || 'No set time', ownerView && (job.clientPrice ?? 0) > 0 ? `Client pays: ${fmtMoney(job.clientPrice)}` : '']} />
      </div>
    </div>
  );
}

/** Primio's InfoListCard: "Label: value" lines under a section title. Empty values are left out. */
export function InfoListCard({ title, rows }: { title: string; rows: [string, string][] }) {
  const shown = rows.filter(([, v]) => v);
  if (shown.length === 0) return null;
  return (
    <Section title={title}>
      {shown.map(([k, v]) => (
        <div key={k} style={{ marginBottom: 4, fontSize: 13.5, overflowWrap: 'anywhere' }}>
          <b>{k}:</b> {v}
        </div>
      ))}
    </Section>
  );
}

function fmtTime(raw: string): string {
  const t = parseClockTime(raw);
  return t ? fmtClock12(t) : raw;
}

/** Clock in / out with a live running time. */
export function TimeClockCard({ job, enabled, busy, onToggle, showButton = true }: {
  job: WfJob; enabled: boolean; busy?: boolean; onToggle: () => void;
  /** False when the quick-action row carries the clock button. */
  showButton?: boolean;
}) {
  const on = isClockedIn(job);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [on]);
  const total = workedMs(job, now);
  const since = job.checkedInAt ? new Date(job.checkedInAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  // Fred, 2026-10-02: "timer is too big … make it readable and manageable".
  // One compact row: the time and what it means on the left, the button on the
  // right. On a narrow phone the button drops underneath, full width.
  return (
    <div className="wf-card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <Timer size={22} color={on ? 'var(--wf-gold)' : 'var(--wf-subtle)'} style={{ flexShrink: 0 }} />
      <div style={{ flex: '1 1 150px', minWidth: 0 }}>
        <div className="wf-display" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: on ? 'var(--wf-navy)' : 'var(--wf-text)' }}>
          {formatClock(total)}
        </div>
        <div className="wf-subtle" style={{ fontSize: 12.5 }}>
          {on ? `On the clock since ${since}` : job.checkedInAt ? 'Time logged on this job' : 'Not started yet'}
        </div>
      </div>
      {showButton && (
        <button
          className={`wf-btn ${on ? 'wf-btn-danger' : 'wf-btn-gold'}`}
          style={{ flex: '1 1 140px', maxWidth: 220 }}
          disabled={!enabled || busy}
          onClick={onToggle}
        >
          {on ? <StopCircle size={18} /> : <PlayCircle size={18} />} {on ? 'Clock out' : 'Clock in'}
        </button>
      )}
    </div>
  );
}

/** Everything a tech needs at the door. */
export function SiteInfoCard({ job }: { job: WfJob }) {
  const rows: [ReactNode, string, string][] = [];
  if (job.access) rows.push([<KeyRound key="a" size={16} />, 'How to get in', job.access]);
  if (job.parking) rows.push([<ParkingSquare key="p" size={16} />, 'Parking', job.parking]);
  if (job.special) rows.push([<TriangleAlert key="s" size={16} color="var(--wf-warning)" />, 'Special instructions', job.special]);
  if (job.deliverables) rows.push([<FileCheck2 key="d" size={16} />, 'Deliverables', job.deliverables]);
  const hasContact = !!(job.pocName || job.pocPhone || job.pocEmail);
  if (!rows.length && !hasContact) return null;
  return (
    <Section title="On site">
      {hasContact && (
        <div style={{ marginBottom: rows.length ? 14 : 0, paddingBottom: rows.length ? 14 : 0, borderBottom: rows.length ? '1px solid var(--wf-line)' : 'none' }}>
          <div style={{ fontWeight: 600 }}>Site contact</div>
          {job.pocName && <div>{job.pocName}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {job.pocPhone && (
              <a className="wf-btn wf-btn-outline wf-btn-sm" href={`tel:${job.pocPhone.replace(/[^0-9+]/g, '')}`}><Phone size={15} /> {job.pocPhone}</a>
            )}
            {job.pocEmail && (
              <a className="wf-btn wf-btn-outline wf-btn-sm" href={`mailto:${job.pocEmail}`}><Mail size={15} /> {job.pocEmail}</a>
            )}
          </div>
        </div>
      )}
      {rows.map(([icon, label, text]) => (
        <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <span style={{ color: 'var(--wf-gold)', flexShrink: 0, marginTop: 1 }}>{icon}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{label}</div>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</div>
          </div>
        </div>
      ))}
    </Section>
  );
}

/** The job's checklist, as set in the office. Tap an item to tick it off. */
export function ChecklistCard({ job, onToggle }: { job: WfJob; onToggle?: (task: WfTask, done: boolean) => void }) {
  if (job.tasks.length === 0) return null;
  return (
    <Section title="Checklist" subtitle={`${tasksDone(job)} of ${job.tasks.length} done`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '-6px -6px' }}>
        {job.tasks.map((t) => (
          <button
            key={t.id}
            onClick={onToggle ? () => onToggle(t, !t.done) : undefined}
            disabled={!onToggle}
            aria-pressed={t.done}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 6px', borderRadius: 8, border: 'none',
              background: 'transparent', font: 'inherit', textAlign: 'left', cursor: onToggle ? 'pointer' : 'default', color: 'inherit',
            }}
          >
            {t.done ? <CheckCircle2 size={22} color="var(--wf-success)" style={{ flexShrink: 0 }} /> : <Circle size={22} color="var(--wf-subtle)" style={{ flexShrink: 0 }} />}
            <span style={{ flex: 1, paddingTop: 1, textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'var(--wf-subtle)' : undefined }}>{t.label}</span>
            {t.category && <span className="wf-subtle" style={{ fontSize: 11, paddingTop: 3 }}>{t.category}</span>}
          </button>
        ))}
      </div>
      {!onToggle && <div className="wf-subtle" style={{ fontSize: 12, marginTop: 8 }}>Ticking opens once the job is accepted.</div>}
    </Section>
  );
}

export function DescriptionCard({ job }: { job: WfJob }) {
  if (!job.description) return null;
  return (
    <Section title="Job description">
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{job.description}</div>
    </Section>
  );
}

export function ScheduleCard({ job }: { job: WfJob }) {
  const day = job.date
    ? new Date(`${job.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : 'Not scheduled yet';
  const times = [job.startTime, job.endTime].filter(Boolean).map(fmtTime).join(' – ');
  return (
    <Section title="Schedule">
      <div style={{ display: 'flex', gap: 8 }}>
        <CalendarDays size={16} color="var(--wf-navy)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 600 }}>{day}</div>
          <div>{times || 'No set time'}</div>
          {!job.date && <div className="wf-subtle" style={{ fontSize: 12 }}>The date will be set soon.</div>}
        </div>
      </div>
    </Section>
  );
}

export function LocationCard({ job }: { job: WfJob }) {
  const address = fullAddress(job);
  return (
    <Section title="Location">
      <div style={{ fontWeight: 600 }}>{job.siteName || job.client || 'Work order site'}</div>
      <div style={{ color: 'var(--wf-navy)' }}>{address || 'Address not on file'}</div>
      {address && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <a className="wf-btn wf-btn-outline wf-btn-sm" href={mapsSearch(job)} target="_blank" rel="noopener noreferrer"><MapPin size={15} /> Map</a>
          <a className="wf-btn wf-btn-outline wf-btn-sm" href={mapsDirections(job)} target="_blank" rel="noopener noreferrer"><Navigation size={15} /> Directions</a>
        </div>
      )}
    </Section>
  );
}

/**
 * The whole job screen. On a wide screen: the work on the left, the clock /
 * techs / money on the right. On a phone: one column, clock first.
 */
export default function WfJobDetail({
  job, ownerView, hideBar, onBack, onRefresh, refreshing, actions, clock, side, onToggleTask, bottom, below, simple = false,
}: {
  job: WfJob;
  ownerView: boolean;
  /** The page's own top bar already has Back and Refresh (the tech portal). */
  hideBar?: boolean;
  onBack: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Buttons under the header (Messages, Directions, Edit…). */
  actions?: ReactNode;
  /** The time clock (tech only). */
  clock?: ReactNode;
  /** Right-hand cards (Techs, Money for the office). */
  side?: ReactNode;
  onToggleTask?: (task: WfTask, done: boolean) => void;
  /** Accept / Decline, or Work done — pinned at the bottom on a phone. */
  bottom?: ReactNode;
  /** Anything else under the main column (messages, photos…). */
  below?: ReactNode;
  /**
   * A project site before Start job and after Off site (Fred, 2026-10-13: "all
   * i want to see is the date time and description and start travel"): the
   * header, the project day card and the description — nothing else.
   */
  simple?: boolean;
}) {
  if (simple) {
    return (
      <div className="wf-rise">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
          <DetailHeader job={job} ownerView={ownerView} />
          {clock}
          <DescriptionCard job={job} />
        </div>
        {bottom && (
          <div className="wf-sticky-bottom" style={{
            position: 'sticky', bottom: 0, marginTop: 16, padding: '12px 0 calc(12px + env(safe-area-inset-bottom))',
            background: 'linear-gradient(180deg, rgba(246,244,239,0) 0%, var(--wf-surface) 30%)',
          }}>
            {bottom}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="wf-rise">
      {!hideBar && <div style={{ marginBottom: 12 }}>
        <PrimioBar
          title="Work order"
          left={<button className="wf-back-round" onClick={onBack} aria-label="Back to the list" title="Back"><ArrowLeft size={20} /></button>}
          right={onRefresh && (
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onRefresh} disabled={refreshing} aria-label="Refresh">
              <RefreshCw size={17} className={refreshing ? 'spin' : undefined} />
            </button>
          )}
        />
      </div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <DetailHeader job={job} ownerView={ownerView} />
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
        <div className="wf-detail-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            {clock && <div className="wf-only-narrow">{clock}</div>}
            {ownerView ? (
              <>
                <InfoListCard title="Overview" rows={[
                  ['Company', job.client], ['Work order ID', job.number], ['Site', job.siteName], ['Priority', job.priorityLabel],
                ]} />
                <InfoListCard title="Work Experience" rows={[
                  ['Type of work', job.serviceType || WF_WORK_TYPE_LABEL[workTypeFor(job.serviceType, job.title)]],
                  ['Skills needed', job.skills], ['Tools to bring', job.tools],
                ]} />
              </>
            ) : (
              <InfoListCard title="Skills & tools" rows={[['Skills needed', job.skills], ['Tools to bring', job.tools]]} />
            )}
            <DescriptionCard job={job} />
            <SiteInfoCard job={job} />
            <ChecklistCard job={job} onToggle={onToggleTask} />
            {below}
            {ownerView && <LocationCard job={job} />}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            {side}
            {ownerView && <ScheduleCard job={job} />}
            {clock && <div className="wf-only-wide">{clock}</div>}
          </div>
        </div>
      </div>

      {bottom && (
        <div className="wf-sticky-bottom" style={{
          position: 'sticky', bottom: 0, marginTop: 16, padding: '12px 0 calc(12px + env(safe-area-inset-bottom))',
          background: 'linear-gradient(180deg, rgba(246,244,239,0) 0%, var(--wf-surface) 30%)',
        }}>
          {bottom}
        </div>
      )}
    </div>
  );
}
