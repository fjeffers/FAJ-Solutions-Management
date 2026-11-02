'use client';
// Timeline (Fred, 2026-10-31, the Monday.com timeline): a lane per tech, each job a
// bar across its days, in the Day, Week or Month on Home. Tap a bar to open the job.
import { Fragment } from 'react';
import { WF_STATUS_COLOR, type WfJob } from '@/lib/wf';
import { spanOf } from '@/lib/week-view';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Timeline({ rows, days, today, onOpen }: {
  rows: { job: WfJob }[]; days: string[]; today: string; onOpen: (job: WfJob) => void;
}) {
  const n = days.length;
  const first = days[0];
  const last = days[n - 1];
  const lanes = new Map<string, WfJob[]>();
  for (const { job } of rows) {
    for (const t of job.techs.length ? job.techs : ['']) {
      const l = lanes.get(t);
      if (l) l.push(job); else lanes.set(t, [job]);
    }
  }
  const techs = [...lanes.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  const at = (d: string) => (d <= first ? 0 : d >= last ? n - 1 : Math.max(0, days.indexOf(d)));
  const colW = n > 14 ? 34 : n > 1 ? 96 : 260;
  const cols = `170px repeat(${n}, minmax(${colW}px, 1fr))`;
  const minWidth = 170 + n * colW;
  return (
    <div className="wf-card" style={{ padding: 0, overflowX: 'auto' }}>
      <div style={{ minWidth }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols }}>
          <div className="wf-tl-head wf-tl-name">Tech</div>
          {days.map((d) => (
            <div key={d} className={`wf-tl-head${d === today ? ' is-today' : ''}`}>
              <span>{n > 14 ? DOW[new Date(`${d}T12:00:00Z`).getUTCDay()][0] : DOW[new Date(`${d}T12:00:00Z`).getUTCDay()]}</span>
              <b>{Number(d.slice(8, 10))}</b>
            </div>
          ))}
        </div>
        {techs.map((t) => (
          <Fragment key={t || '-'}>
            {lanes.get(t)!.map((job, i) => {
              const s = spanOf(job);
              if (!s) return null;
              const a = at(s.start);
              const b = at(s.end);
              return (
                <div key={job.id} style={{ display: 'grid', gridTemplateColumns: cols, borderTop: i === 0 ? '1px solid var(--wf-line)' : undefined }}>
                  <div className="wf-tl-name" style={{ gridRow: 1, gridColumn: 1, color: t ? undefined : 'var(--wf-danger)' }}>{i === 0 ? (t || 'No tech') : ''}</div>
                  {days.map((d, k) => <div key={d} className={`wf-tl-cell${d === today ? ' is-today' : ''}`} style={{ gridRow: 1, gridColumn: k + 2 }} />)}
                  <button type="button" onClick={() => onOpen(job)} title={`WO ${job.number} · ${job.title}`}
                    className="wf-tl-bar" style={{ gridRow: 1, gridColumn: `${a + 2} / ${b + 3}`, background: WF_STATUS_COLOR[job.status], opacity: job.status === 'closed' ? 0.6 : 1 }}>
                    WO {job.number} · {job.title}
                  </button>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
