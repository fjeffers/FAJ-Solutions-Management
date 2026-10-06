'use client';
// A tech's time & pay log, on their profile (Fred, 2026-10-06: "time log for
// payment, something to keep track of them"). One row per job — date, hours,
// what they earned, paid, still owed — for this week, last week, a month, the
// year or all time, with totals and a spreadsheet download. The rules (hours
// sources, "Pay not set") are in lib/tech-ledger.ts; money is lib/utils.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fmtDate, fmtMoney, todayISO } from '@/lib/utils';
import { downloadCSVText } from '@/lib/export';
import {
  PERIODS, inRange, ledgerTotals, periodRange, techLedger, unmatchedPayments,
  type ClockRecord, type HoursFrom, type Period, type Punch,
} from '@/lib/tech-ledger';
import type { Contractor, EnrichedWorkOrder, Payment } from '@/lib/types';

const FROM_LABEL: Record<HoursFrom, string> = {
  clock: 'From their clock-ins',
  record: 'From their clock-in record',
  job: 'Hours entered on the job',
};

export default function TechTimePay({ contractor, workOrders, payments, onOpenJob }: {
  contractor: Contractor;
  workOrders: EnrichedWorkOrder[];
  payments: Payment[];
  onOpenJob?: (id: string) => void;
}) {
  const [period, setPeriod] = useState<Period>('month');
  const [punches, setPunches] = useState<Punch[]>([]);
  const [records, setRecords] = useState<ClockRecord[]>([]);

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from('job_punches').select('wo_id, contractor_name, kind, at').eq('contractor_name', contractor.name).limit(5000),
      supabase.from('contractor_time_logs').select('wo_id, contractor_name, checked_in_at, checked_out_at, adjusted_hours').eq('contractor_name', contractor.name).limit(5000),
    ]).then(([p, r]) => {
      setPunches((p.data ?? []) as Punch[]);
      setRecords((r.data ?? []) as ClockRecord[]);
    });
  }, [contractor.name]);

  const today = todayISO();
  const range = periodRange(period, today);
  const all = useMemo(() => techLedger(contractor.name, workOrders, payments, punches, records), [contractor.name, workOrders, payments, punches, records]);
  const rows = all.filter((r) => inRange(r.date, range));
  const t = ledgerTotals(rows);
  const stray = unmatchedPayments(contractor.name, workOrders, payments);
  const periodLabel = PERIODS.find((p) => p.key === period)!.label;

  const download = () => {
    const esc = (v: string | number) => {
      const s = String(v);
      return /^[=+\-@]/.test(s) ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ['Date', 'WO #', 'Job', 'Hours', 'Hours from', 'Earned', 'Paid', 'Still owed'].join(','),
      ...rows.map((r) => [
        r.date, r.wo.wo_number, r.wo.title ?? '', r.hours ?? '', r.hoursFrom ? FROM_LABEL[r.hoursFrom] : '',
        r.earned ?? 'Pay not set', r.paid.toFixed(2), r.owed.toFixed(2),
      ].map(esc).join(',')),
      ['Total', '', `${t.jobs} jobs`, t.hours, '', t.earned.toFixed(2), t.paid.toFixed(2), t.owed.toFixed(2)].map(esc).join(','),
    ];
    downloadCSVText(`${contractor.name.replace(/\s+/g, '_')}_time_and_pay_${period}_${today}.csv`, lines.join('\n'));
  };

  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#90a4ae', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '10px 10px', fontSize: 13, borderBottom: '1px solid #f5f5f5', verticalAlign: 'top' };
  const num: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };

  return (
    <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e8ecf0', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '16px 20px', borderBottom: '1px solid #eef0f4' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)} aria-pressed={period === p.key}
              style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: period === p.key ? '1px solid #0E1B2E' : '1px solid #e2e6ec', background: period === p.key ? '#0E1B2E' : 'white', color: period === p.key ? 'white' : '#334' }}>
              {p.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={download} disabled={rows.length === 0} style={{ fontSize: 12 }}>
          <Download size={13} /> Download for {periodLabel.toLowerCase()}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', background: '#f7f9fc', borderBottom: '1px solid #eef0f4' }}>
        {[
          { label: 'Jobs', value: String(t.jobs), color: '#1a1a2e' },
          { label: 'Hours', value: t.hours ? t.hours.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—', color: '#1a1a2e' },
          { label: 'Earned', value: fmtMoney(t.earned), color: '#1a1a2e' },
          { label: 'Paid', value: fmtMoney(t.paid), color: '#047857' },
          { label: 'Still owed', value: fmtMoney(t.owed), color: t.owed > 0 ? '#b91c1c' : '#047857' },
        ].map((k) => (
          <div key={k.label} style={{ padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 3 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {(t.payNotSet > 0 || t.overpaid > 0 || stray.length > 0) && (
        <div style={{ padding: '10px 20px', background: 'rgba(180,83,9,0.06)', borderBottom: '1px solid #f3e3c8', fontSize: 12.5, color: '#7c4a03', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {t.payNotSet > 0 && <span><AlertTriangle size={12} style={{ verticalAlign: -1 }} /> {t.payNotSet} job{t.payNotSet === 1 ? " has" : 's have'} no tech pay set — open the job and enter their pay to count it.</span>}
          {t.overpaid > 0 && <span><AlertTriangle size={12} style={{ verticalAlign: -1 }} /> Paid {fmtMoney(t.overpaid)} more than earned on some jobs in this period.</span>}
          {stray.length > 0 && <span><AlertTriangle size={12} style={{ verticalAlign: -1 }} /> {stray.length} payment{stray.length === 1 ? '' : 's'} ({fmtMoney(stray.reduce((s, p) => s + Number(p.amount), 0))}, all time) don&apos;t match any of {contractor.name}&apos;s jobs by WO number.</span>}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '44px 24px', color: '#90a4ae' }}>
          <Clock size={28} style={{ opacity: 0.35, marginBottom: 8 }} />
          <div style={{ fontWeight: 600 }}>No jobs {period === 'all' ? 'yet' : `in ${periodLabel.toLowerCase()}`}.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr style={{ background: '#fbfcfd', borderBottom: '1px solid #eef0f4' }}>
              <th style={th}>Date</th><th style={th}>Job</th>
              <th style={{ ...th, textAlign: 'right' }}>Hours</th><th style={{ ...th, textAlign: 'right' }}>Earned</th>
              <th style={{ ...th, textAlign: 'right' }}>Paid</th><th style={{ ...th, textAlign: 'right' }}>Still owed</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.wo.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: '#555' }}>{r.date ? fmtDate(r.date) : '—'}</td>
                  <td style={td}>
                    {onOpenJob
                      ? <button onClick={() => onOpenJob(r.wo.id)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: '#0E1B2E', fontWeight: 700, fontFamily: 'monospace' }}>#{r.wo.wo_number}</button>
                      : <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#0E1B2E' }}>#{r.wo.wo_number}</span>}
                    {r.wo.title && <span style={{ color: '#333' }}> · {r.wo.title}</span>}
                    {r.wo.archived_at && <span style={{ fontSize: 10, color: '#999', marginLeft: 6 }}>CLOSED</span>}
                  </td>
                  <td style={num} title={r.hoursFrom ? FROM_LABEL[r.hoursFrom] : 'No hours recorded'}>
                    {r.onTheClock && <span style={{ fontSize: 10, fontWeight: 800, color: '#b45309', marginRight: 6 }}>ON THE CLOCK</span>}
                    {r.hours != null ? r.hours.toLocaleString('en-US', { maximumFractionDigits: 2 }) : <span style={{ color: '#bbb' }}>—</span>}
                  </td>
                  <td style={num}>{r.earned == null ? <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309' }}>Pay not set</span> : fmtMoney(r.earned)}</td>
                  <td style={{ ...num, color: r.paid > 0 ? '#047857' : '#bbb' }}>{r.paid > 0 ? fmtMoney(r.paid) : '—'}</td>
                  <td style={{ ...num, fontWeight: 700, color: r.owed > 0 ? '#b91c1c' : r.overpaid > 0 ? '#b45309' : '#047857' }}>
                    {r.owed > 0 ? fmtMoney(r.owed) : r.overpaid > 0 ? `Over ${fmtMoney(r.overpaid)}` : r.earned == null ? '—' : 'Paid ✓'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: '10px 20px', fontSize: 11.5, color: '#90a4ae', borderTop: '1px solid #f0f2f5' }}>
        Hours come from the tech&apos;s own clock-ins when there are any, otherwise from the hours entered on the job. Point at an hours figure to see where it came from.
        Pay is what the tech earns on each job (their pay, mileage, materials and add-ons) — the same as Pay Techs.
      </div>
    </div>
  );
}
