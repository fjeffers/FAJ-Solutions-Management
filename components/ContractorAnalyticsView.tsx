'use client';
import { useMemo, useState } from 'react';
import { Award, Clock, CheckCircle, TrendingUp } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import type { Contractor, EnrichedWorkOrder } from '@/lib/types';

type SortKey = 'name' | 'jobCount' | 'onTimeRate' | 'approvalRate' | 'avgHours' | 'totalValue' | 'rating';

function daysBetween(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function ratingTier(score: number): { label: string; color: string; bg: string } {
  if (score >= 90) return { label: 'Excellent', color: '#047857', bg: 'rgba(16,185,129,0.12)' };
  if (score >= 75) return { label: 'Good', color: '#0E1B2E', bg: 'rgba(14,27,46,0.12)' };
  if (score >= 60) return { label: 'Fair', color: '#b45309', bg: 'rgba(245,158,11,0.12)' };
  return { label: 'Needs Improvement', color: '#b91c1c', bg: 'rgba(239,68,68,0.12)' };
}

export default function ContractorAnalyticsView({
  contractors,
  workOrders,
}: {
  contractors: Contractor[];
  workOrders: EnrichedWorkOrder[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>('rating');
  const [sortDesc, setSortDesc] = useState(true);

  const rows = useMemo(() => {
    return contractors.map((c) => {
      const wos = workOrders.filter((w) => w.contractor_name === c.name);
      const jobCount = wos.length;

      // On-time rate: checked in on or before the scheduled start date
      const scheduledWOs = wos.filter((w) => w.start_date && w.checked_in_at);
      const onTimeCount = scheduledWOs.filter((w) => {
        const checkedInDate = w.checked_in_at!.split('T')[0];
        return checkedInDate <= w.start_date!;
      }).length;
      const onTimeRate = scheduledWOs.length > 0 ? (onTimeCount / scheduledWOs.length) * 100 : null;

      // Approval rate: of jobs that moved past Open, how many reached Approved/Paid
      const workedWOs = wos.filter((w) => w.wo_status !== 'Open');
      const approvedCount = wos.filter((w) => w.wo_status === 'Approved' || w.wo_status === 'Paid').length;
      const approvalRate = workedWOs.length > 0 ? (approvedCount / workedWOs.length) * 100 : null;

      // Response time: created_at -> acknowledged_at
      const ackWOs = wos.filter((w) => w.acknowledged_at);
      const avgResponseDays = ackWOs.length > 0
        ? ackWOs.reduce((s, w) => s + daysBetween(w.created_at, w.acknowledged_at!), 0) / ackWOs.length
        : null;

      // Avg hours per job
      const timedWOs = wos.filter((w) => w.checked_in_at && w.checked_out_at);
      const avgHours = timedWOs.length > 0
        ? timedWOs.reduce((s, w) => s + (new Date(w.checked_out_at!).getTime() - new Date(w.checked_in_at!).getTime()) / 3600000, 0) / timedWOs.length
        : null;

      const totalValue = wos.reduce((s, w) => s + Number(w.total_amount), 0);

      const ratingInputs = [onTimeRate, approvalRate].filter((v): v is number => v != null);
      const rating = ratingInputs.length > 0 ? ratingInputs.reduce((s, v) => s + v, 0) / ratingInputs.length : null;

      return { contractor: c, jobCount, onTimeRate, approvalRate, avgResponseDays, avgHours, totalValue, rating };
    }).filter((r) => r.jobCount > 0);
  }, [contractors, workOrders]);

  const sorted = useMemo(() => {
    const dir = sortDesc ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') return dir * b.contractor.name.localeCompare(a.contractor.name);
      const av = a[sortKey === 'rating' ? 'rating' : sortKey] ?? -1;
      const bv = b[sortKey === 'rating' ? 'rating' : sortKey] ?? -1;
      return dir * ((av as number) - (bv as number));
    });
  }, [rows, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(true); }
  };

  const TH = ({ k, label, align = 'right' }: { k: SortKey; label: string; align?: 'left' | 'right' }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{
        padding: '10px 14px', textAlign: align, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
        color: sortKey === k ? 'var(--teal)' : '#888', textTransform: 'uppercase', cursor: 'pointer',
        whiteSpace: 'nowrap', userSelect: 'none',
      }}
    >
      {label} {sortKey === k ? (sortDesc ? '↓' : '↑') : ''}
    </th>
  );

  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>PERFORMANCE</div>
        <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Contractor Analytics</h1>
        <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>On-time rate, approval rate, and job history by contractor</p>
      </div>

      {sorted.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          No contractor activity yet.
        </div>
      ) : (
        <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                <TH k="name" label="Contractor" align="left" />
                <TH k="jobCount" label="Jobs" />
                <TH k="onTimeRate" label="On-Time" />
                <TH k="approvalRate" label="Approval" />
                <TH k="avgHours" label="Avg Hrs/Job" />
                <TH k="totalValue" label="Total Value" />
                <TH k="rating" label="Rating" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const tier = r.rating != null ? ratingTier(r.rating) : null;
                return (
                  <tr key={r.contractor.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 700 }}>{r.contractor.name}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', color: '#666' }}>{r.jobCount}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      {r.onTimeRate != null ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: r.onTimeRate >= 80 ? '#047857' : '#b45309', fontWeight: 600 }}>
                          <Clock size={12} /> {r.onTimeRate.toFixed(0)}%
                        </span>
                      ) : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      {r.approvalRate != null ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: r.approvalRate >= 80 ? '#047857' : '#b45309', fontWeight: 600 }}>
                          <CheckCircle size={12} /> {r.approvalRate.toFixed(0)}%
                        </span>
                      ) : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', color: '#666' }}>
                      {r.avgHours != null ? `${r.avgHours.toFixed(1)}h` : '—'}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <TrendingUp size={12} color="var(--teal)" /> {fmtMoney(r.totalValue)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      {tier ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: tier.bg, color: tier.color, whiteSpace: 'nowrap' }}>
                          <Award size={11} /> {tier.label}
                        </span>
                      ) : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
