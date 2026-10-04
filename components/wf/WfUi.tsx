'use client';
// WorkFlow's building blocks, in the FAJ app (Fred, 2026-10-02: "I like it,
// keep it"). Shared by the WorkFlow screen in management and the tech portal.
// Styles live in app/wf.css under the .wf scope.
import type { ReactNode } from 'react';
import { AlertTriangle, CalendarClock, ChevronRight, Clock, Inbox, UserX, Users, X } from 'lucide-react';
import {
  WF_STATUS_COLOR, WF_BUCKETS, wfStatusLabel, whenText, place, tasksDone, isClockedIn, jobImage, requestWhen,
  type WfBucket, type WfJob, type WfStatus,
} from '@/lib/wf';
import { waitingRequests } from '@/lib/closeout';
import { fmtMoney } from '@/lib/utils';
import { backdropClose } from '@/lib/backdrop';

export function StatusChip({ status, ownerView = false }: { status: WfStatus; ownerView?: boolean }) {
  const c = WF_STATUS_COLOR[status];
  return (
    <span className="wf-chip" style={{ color: c, background: `${c}1F` }}>
      {wfStatusLabel(status, ownerView)}
    </span>
  );
}

/** "Good morning" / "Good afternoon" / "Good evening". */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function todayLong(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export type HeroStat = { value: string; label: string; onClick?: () => void };

/** The greeting and the numbers that start the day, over the night photo. */
export function Hero({ eyebrow, title, stats, actions }: {
  eyebrow?: string; title: string; stats: HeroStat[]; actions?: ReactNode;
}) {
  return (
    <div className="wf-hero wf-rise">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="wf-hero-date">{eyebrow ?? todayLong()}</div>
          <h1 className="wf-hero-greet">{title}</h1>
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
      <div className="wf-stats">
        {stats.map((s) => {
          const inner = (
            <>
              <div className="wf-stat-value">{s.value}</div>
              <div className="wf-stat-label">{s.label}</div>
            </>
          );
          return s.onClick
            ? <button key={s.label} className="wf-stat" onClick={s.onClick}>{inner}</button>
            : <div key={s.label} className="wf-stat">{inner}</div>;
        })}
      </div>
    </div>
  );
}

/** Tech: "Offers — 2 jobs waiting for your answer". Office: "Needs a tech — 3 jobs". */
export function Banner({ title, subtitle, onClick, tone = 'gold' }: {
  title: string; subtitle: string; onClick: () => void; tone?: 'gold' | 'red';
}) {
  return (
    <button className="wf-card wf-card-click wf-rise" onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16 }}>
      <span style={{
        width: 46, height: 46, borderRadius: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: tone === 'red' ? 'var(--wf-danger)' : 'var(--wf-gold)', color: tone === 'red' ? '#fff' : 'var(--wf-gold-ink)',
      }}>
        {tone === 'red' ? <UserX size={22} /> : <Inbox size={22} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{title}</span>
        <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</span>
      </span>
      <ChevronRight size={20} />
    </button>
  );
}

/** "All jobs" plus a chip for each stage that has jobs in it. */
export function Filters<T extends string>({ value, options, onChange, allLabel = 'All jobs', ariaLabel = 'Show jobs by stage' }: {
  value: T | 'all';
  options: { key: T; label: string; count: number }[];
  onChange: (v: T | 'all') => void;
  allLabel?: string;
  ariaLabel?: string;
}) {
  const total = options.reduce((n, o) => n + o.count, 0);
  return (
    <div className="wf-filters" role="group" aria-label={ariaLabel}>
      <button className="wf-filter" aria-pressed={value === 'all'} onClick={() => onChange('all')}>
        {allLabel}<span className="wf-count">{total}</span>
      </button>
      {options.map((o) => (
        <button key={o.key} className="wf-filter" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}<span className="wf-count">{o.count}</span>
        </button>
      ))}
    </div>
  );
}

/** A job in a list: photo, number, stage, title, where and when — and, for the office, who and how much. */
export function JobCard({ job, ownerView = false, onOpen, index = 0, payNotSet = false }: {
  job: WfJob; ownerView?: boolean; onOpen: () => void; index?: number;
  /** Office only: techs are on it but nobody has set what they get. */
  payNotSet?: boolean;
}) {
  const accent = WF_STATUS_COLOR[job.status];
  const done = tasksDone(job);
  const where = [job.client, place(job)].filter(Boolean).join(' · ');
  return (
    <button
      className="wf-card wf-card-click wf-rise"
      onClick={onOpen}
      style={{ display: 'block', overflow: 'hidden', animationDelay: `${Math.min(index, 12) * 45}ms` }}
      aria-label={`WO ${job.number}: ${job.title}`}
    >
      <div style={{ display: 'flex', gap: 12, padding: 12, borderLeft: `4px solid ${accent}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={jobImage(job)} alt="" width={76} height={76} loading="lazy"
          style={{ width: 76, height: 76, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="wf-label" style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              WO {job.number}
              {job.highPriority && <AlertTriangle size={13} color="var(--wf-danger)" aria-label="High priority" style={{ display: 'inline-block', verticalAlign: '-2px', marginLeft: 5 }} />}
            </span>
            <StatusChip status={job.status} ownerView={ownerView} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, marginTop: 3, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {job.title}
          </div>
          {where && <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{where}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: 12.5, fontWeight: 500 }}>
            <Clock size={14} color="var(--wf-gold)" style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{whenText(job)}</span>
          </div>
          {ownerView && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: 12.5 }}>
              {job.techs.length === 0
                ? <><UserX size={14} color="var(--wf-danger)" /><span style={{ color: 'var(--wf-danger)', fontWeight: 700, flex: 1 }}>No tech yet</span></>
                : <><Users size={14} color="var(--wf-subtle)" /><span className="wf-subtle" style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.techs.join(', ')}</span></>}
              {payNotSet && <span className="wf-chip" style={{ color: 'var(--wf-warning)', background: 'rgba(180,83,9,0.1)', padding: '1px 8px' }}>Pay not set</span>}
              {(job.clientPrice ?? 0) > 0 && <span style={{ fontWeight: 600 }}>{fmtMoney(job.clientPrice)}</span>}
            </div>
          )}
          {job.tasks.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="wf-progress"><span style={{ width: `${(done / job.tasks.length) * 100}%`, background: accent }} /></div>
              <div className="wf-subtle" style={{ fontSize: 11.5, marginTop: 2 }}>{done} of {job.tasks.length} checklist items</div>
            </div>
          )}
          {isClockedIn(job) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, fontWeight: 500 }}>
              <span className="wf-dot" /> On the clock
            </div>
          )}
          <TimeRequestLine job={job} ownerView={ownerView} />
        </div>
      </div>
    </button>
  );
}

/**
 * "Asked for another time" on a job card (migration-105). A tech sees where
 * their own ask stands; the office sees who is waiting on an answer.
 */
export function TimeRequestLine({ job, ownerView }: { job: WfJob; ownerView: boolean }) {
  const line = (text: string, tone: 'gold' | 'green' | 'grey') => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12.5, fontWeight: 600,
      color: tone === 'green' ? 'var(--wf-success)' : tone === 'gold' ? 'var(--wf-warning)' : 'var(--wf-subtle)',
    }}>
      <CalendarClock size={14} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    </div>
  );
  if (ownerView) {
    const waiting = waitingRequests(job.timeRequests, job.techs);
    if (waiting.length === 0 || job.status !== 'offered') return null;
    const [name, r] = waiting[0];
    return line(waiting.length === 1 ? `${name.split(' ')[0]} asks for ${requestWhen(r)}` : `${waiting.length} techs ask for another time`, 'gold');
  }
  const r = job.myTimeRequest;
  if (!r || job.status !== 'offered') return null;
  if (r.state === 'waiting') return line(`You asked for ${requestWhen(r)} · waiting on Fred`, 'gold');
  if (r.state === 'kept') return line('Fred kept the original time', 'grey');
  return null;
}

/** A titled card, as on the job screen ("On site", "Checklist", "Techs"…). */
export function Section({ title, subtitle, right, children }: {
  title: string; subtitle?: string; right?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="wf-card">
      <div className="wf-section-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="wf-title" style={{ fontSize: 16 }}>{title}</h3>
          {subtitle && <div className="wf-subtle" style={{ fontSize: 12 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

export function Empty({ icon, title, message, action }: {
  icon?: ReactNode; title: string; message?: string; action?: ReactNode;
}) {
  return (
    <div className="wf-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ color: 'var(--wf-subtle)', marginBottom: 8, display: 'flex', justifyContent: 'center' }}>{icon ?? <Inbox size={34} />}</div>
      <div className="wf-title" style={{ fontSize: 17 }}>{title}</div>
      {message && <div className="wf-subtle" style={{ marginTop: 4 }}>{message}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/** A WorkFlow dialog. Closes on the backdrop only when the press starts and ends there. */
export function Dialog({ title, onClose, children, footer, wide = false }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <div className="wf wf-overlay" {...backdropClose(onClose)}>
      <div className="wf-dialog" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 640 } : undefined}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <h2 className="wf-title" style={{ flex: 1 }}>{title}</h2>
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
        {footer && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18, flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Available · Current · Pending · Closed — the four lists a job list is
 * split into (Fred, 2026-10-02). No "All jobs": one list at a time.
 */
export function BucketTabs({ value, counts, onChange, ownerView = false }: {
  value: WfBucket;
  counts: Record<WfBucket, number>;
  onChange: (b: WfBucket) => void;
  ownerView?: boolean;
}) {
  return (
    <div>
      <div role="tablist" aria-label="Which jobs to show" style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4, padding: 4,
        background: '#ECE8DF', borderRadius: 14,
      }}>
        {WF_BUCKETS.map((b) => {
          const on = value === b.key;
          return (
            <button
              key={b.key} role="tab" aria-selected={on} onClick={() => onChange(b.key)} className="wf-bucket-tab"
              style={{
                border: 'none', borderRadius: 10, padding: '9px 6px', cursor: 'pointer', font: 'inherit',
                fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: on ? 'var(--wf-navy)' : 'transparent', color: on ? '#fff' : 'var(--wf-text)',
                boxShadow: on ? '0 2px 6px rgba(14,27,46,0.2)' : 'none',
              }}
            >
              {b.label}
              <span style={{
                fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '1px 7px',
                background: on ? 'rgba(255,255,255,0.18)' : 'rgba(14,27,46,0.08)',
              }}>{counts[b.key]}</span>
            </button>
          );
        })}
      </div>
      <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: 6 }}>
        {WF_BUCKETS.find((b) => b.key === value)?.hint[ownerView ? 'office' : 'tech']}
      </div>
    </div>
  );
}
