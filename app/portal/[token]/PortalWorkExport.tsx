'use client';
// A tech's own record of work done, as a spreadsheet.
//
// Deliberately money-free — same rule as the shared client site report. The
// portal payload already has every pay, banking and tax field stripped by
// get_portal_data (migration 047), and this builds only from that payload, so
// there is no second path that could reintroduce them.
//
// Rows are what the tech actually did: when, where, how long, and what they
// wrote at closeout.
import { useState } from 'react';
import { Download } from 'lucide-react';
import { toCSV, UTF8_BOM } from '@/lib/csv';
import type { WorkOrder } from '@/lib/types';

type Props = {
  workOrders: (WorkOrder & { is_lead: boolean })[];
  contractorName: string;
};

const HEADERS = [
  'Date', 'Job #', 'Site #', 'Site', 'Address', 'Checked in', 'Checked out',
  'Hours on site', 'Miles', 'Status', 'What was done',
];

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d.length <= 10 ? d + 'T12:00:00' : d)
    .toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

function fmtTime(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** Only this tech's own miles. mileage_logs survives get_portal_data because
 *  miles are not pay — but another tech's rows still must not appear. */
function milesFor(w: WorkOrder, name: string): string {
  const logs = w.mileage_logs ?? [];
  const mine = logs.filter((l) => l.contractor_name === name)
    .reduce((s, l) => s + (Number(l.miles) || 0), 0);
  return mine > 0 ? String(mine) : '';
}

/** Blank rather than 0.0 when a stint is still open — an unfinished job has no total yet. */
function hoursBetween(a: string | null | undefined, b: string | null | undefined): string {
  if (!a || !b) return '';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!isFinite(ms) || ms <= 0) return '';
  return (ms / 3600000).toFixed(2);
}

export default function PortalWorkExport({ workOrders, contractorName }: Props) {
  const [busy, setBusy] = useState(false);

  const download = () => {
    setBusy(true);
    try {
      const rows = [...workOrders]
        .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
        .map((w) => [
          fmtDate(w.start_date),
          w.wo_number ?? '',
          // The client's own site id, when the job carries one — it is what
          // Fred's spreadsheets and the client both call the location.
          w.external_wo_id ?? w.client_reference ?? '',
          w.site_name ?? w.title ?? '',
          [w.site_address, w.site_city, w.site_state, w.site_zip].filter(Boolean).join(', '),
          fmtTime(w.checked_in_at),
          fmtTime(w.checked_out_at),
          hoursBetween(w.checked_in_at, w.checked_out_at),
          milesFor(w, contractorName),
          w.wo_status ?? '',
          w.closeout_notes ?? '',
        ]);

      // toCSV guards against Excel formula injection — a site note beginning
      // '=' or '-' must not become a live formula in a downloaded file.
      const csv = toCSV([HEADERS, ...rows]);
      const stamp = new Date().toISOString().slice(0, 10);
      const safe = `${contractorName} work record ${stamp}`.replace(/[\\/:*?"<>|]/g, '-');

      const blob = new Blob([UTF8_BOM + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  if (workOrders.length === 0) return null;

  return (
    <div style={{
      background: '#fff', border: '1px solid #eee', borderRadius: 12,
      padding: '15px 17px', marginBottom: 12,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Your work record</div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
        A spreadsheet of your {workOrders.length} current job{workOrders.length !== 1 ? 's' : ''} —
        dates, sites, hours and what you did. Opens in Excel or Google Sheets.
      </div>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        style={{
          background: '#0D7377', color: '#fff', border: 'none', borderRadius: 8,
          padding: '10px 16px', fontSize: 13, fontWeight: 700,
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        <Download size={13} /> {busy ? 'Preparing…' : 'Download my work record'}
      </button>
    </div>
  );
}
