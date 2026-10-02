'use client';
import { useState } from 'react';
import { MapPin, Calendar, Clock, Check, X, Inbox, Loader2 } from 'lucide-react';
import { respondToOpenJob } from '@/lib/tech-portal';
import { fmtDate } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import type { TechOpenJob } from '@/lib/types';

/**
 * Jobs Fred sent this tech that they have not answered yet.
 *
 * NOT a job board. Nothing appears here until their name is on the work order —
 * a tech never browses unclaimed work or anyone else's. Answering either way
 * removes it from this list; accepted work lives on in My Jobs.
 *
 * No money on any of these cards, same as everywhere else in the portal.
 */
export default function TechOpenWork({
  jobs, onChanged,
}: {
  jobs: TechOpenJob[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const respond = async (job: TechOpenJob, response: 'accepted' | 'declined') => {
    const wo = job.wo_number;
    if (!wo) return;
    if (response === 'declined' && !confirm(`Decline WO ${wo}? Fred will be told you can't take it.`)) return;

    setBusy(job.id);
    const { ok, reason } = await respondToOpenJob(wo, response);
    setBusy(null);

    if (ok) {
      toastSuccess(response === 'accepted'
        ? `Accepted WO ${wo} — it's in My Jobs`
        : `Declined WO ${wo} — Fred has been told`);
    } else if (reason === 'not_your_job') {
      toastError(`WO ${wo} is no longer assigned to you.`);
    } else {
      toastError(`Couldn't respond to WO ${wo}.`);
    }
    onChanged();
  };

  if (jobs.length === 0) {
    return (
      <div className="glass card" style={{ textAlign: 'center', padding: '30px 20px', color: '#aaa', fontSize: 13 }}>
        <Inbox size={22} color="#ddd" style={{ marginBottom: 7 }} />
        <div>Nothing waiting on you.</div>
        <div style={{ fontSize: 12, marginTop: 5 }}>New jobs Fred sends you will show up here to accept.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {jobs.map((j) => {
        const where = [j.site_name, [j.site_city, j.site_state].filter(Boolean).join(', ')]
          .filter((p) => p && p.trim()).join(' · ');
        const when = j.scheduled_date || j.start_date;
        const working = busy === j.id;

        return (
          <div key={j.id} className="glass card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--teal)' }}>WO {j.wo_number}</span>
              {j.priority && j.priority !== 'Normal' && (
                <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#92400e' }}>
                  {j.priority}
                </span>
              )}
              {j.service_type && (
                <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'rgba(14,27,46,0.10)', color: 'var(--teal)' }}>
                  {j.service_type}
                </span>
              )}
            </div>

            <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>
              {j.title || j.customer_name || 'Work order'}
            </div>
            {j.customer_name && j.title && (
              <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>{j.customer_name}</div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 9, fontSize: 12, color: '#777' }}>
              {where && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} />{where}</span>}
              {when && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Calendar size={12} />{fmtDate(when)}</span>}
              {j.start_time && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={12} />{j.start_time}</span>}
            </div>

            {(j.description || j.scope_of_work) && (
              <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid #eee', fontSize: 12.5, color: '#666', lineHeight: 1.5 }}>
                {j.description || j.scope_of_work}
              </div>
            )}

            {j.required_skills && (
              <div style={{ marginTop: 7, fontSize: 11.5, color: '#888' }}>
                <strong style={{ color: '#666' }}>Needs:</strong> {j.required_skills}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                className="btn btn-primary" disabled={working}
                onClick={() => respond(j, 'accepted')}
                style={{ flex: 1, justifyContent: 'center', padding: '11px 0' }}
              >
                {working ? <Loader2 size={15} /> : <Check size={15} />} Accept
              </button>
              <button
                className="btn btn-ghost" disabled={working}
                onClick={() => respond(j, 'declined')}
                style={{ justifyContent: 'center', padding: '11px 18px', color: '#999' }}
              >
                <X size={15} /> Decline
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
