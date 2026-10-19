'use client';
import { useState } from 'react';
import { FileSpreadsheet, CheckCircle2, AlertTriangle, Upload } from 'lucide-react';
import { toastError, toastSuccess } from '@/lib/toast';
import {
  dayLabel, parseSchedule, timeLabel, type ScheduleCell, type SchedulePreviewRow, type ScheduleRow,
} from '@/lib/client-schedule';

// The client's weekly schedule on the Import screen (lib/client-schedule.ts):
// pick the file, see what each row will fill or make, then one button does it.

/** The sheet's rows of cells: the first sheet with a Site ID column. */
async function readSchedule(file: File) {
  const XLSX = await import('xlsx');
  const csv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  // A CSV is read as typed, so a code like 0123 keeps its leading zero.
  const wb = csv
    ? XLSX.read(await file.text(), { type: 'string', raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  let first: ReturnType<typeof parseSchedule> | null = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    // A cell that shows "Folder" but links to it: the link is what's wanted.
    for (const [addr, cell] of Object.entries(ws)) {
      if (addr.startsWith('!')) continue;
      const c = cell as { l?: { Target?: string }; v?: unknown; t?: string; w?: string };
      if (c.l?.Target && /^https?:\/\//i.test(c.l.Target) && !/^https?:\/\//i.test(String(c.v ?? ''))) {
        c.v = c.l.Target; c.t = 's'; delete c.w;
      }
    }
    const table = XLSX.utils.sheet_to_json<ScheduleCell[]>(ws, { header: 1, raw: true, defval: null });
    const parsed = parseSchedule(table);
    if (!parsed.error) return parsed;
    first ??= parsed;
  }
  return first ?? { rows: [], error: 'That file has no sheets.' };
}

async function send(rows: ScheduleRow[], apply: boolean) {
  const res = await fetch('/api/import-queue/from-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, apply }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The schedule could not be read');
  return data as { rows: SchedulePreviewRow[]; filled?: number; failed?: string[]; queued?: string[]; alreadyQueued?: number };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function ScheduleUpload({
  onApprove,
  onImported,
}: {
  onApprove: (id: string, opts?: { silent?: boolean }) => Promise<boolean | void>;
  onImported?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [preview, setPreview] = useState<SchedulePreviewRow[] | null>(null);

  const reset = () => { setRows([]); setPreview(null); setFileName(''); };

  const pick = async (file: File) => {
    setBusy('Reading…');
    try {
      const { rows: read, error } = await readSchedule(file);
      if (error) { toastError(error); return; }
      const data = await send(read, false);
      setRows(read);
      setPreview(data.rows);
      setFileName(file.name);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'The schedule could not be read');
    } finally {
      setBusy(null);
    }
  };

  const toFill = preview?.filter((p) => p.job && p.filled.length > 0).length ?? 0;
  const toMake = preview?.filter((p) => !p.job && !p.cancelled).length ?? 0;
  const upToDate = preview?.filter((p) => p.job && !p.cancelled && p.filled.length === 0).length ?? 0;

  const apply = async () => {
    setBusy('Saving…');
    try {
      const data = await send(rows, true);
      // New jobs one at a time: each takes the next WO number.
      const queued = data.queued ?? [];
      let made = 0;
      for (const [i, id] of queued.entries()) {
        setBusy(`Making job ${i + 1} of ${queued.length}…`);
        if (await onApprove(id, { silent: true }).catch(() => false)) made++;
      }
      const parts = [
        data.filled ? `Filled ${plural(data.filled, 'job')}` : '',
        made ? `made ${plural(made, 'new job')} to assign in Work orders` : '',
        data.alreadyQueued ? `${data.alreadyQueued} already waiting below` : '',
      ].filter(Boolean);
      if (data.failed?.length || made < queued.length) {
        toastError([
          ...parts,
          data.failed?.length ? `couldn't save WO ${data.failed.join(', ')}` : '',
          made < queued.length ? `${queued.length - made} new job(s) are waiting below to approve` : '',
        ].filter(Boolean).join('; '));
      } else {
        toastSuccess(parts.length ? `${parts.join('; ')}.` : 'Nothing to change — every job already had it.');
      }
      reset();
      onImported?.();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Saving failed — try again');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="glass card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <FileSpreadsheet size={18} color="#047857" />
        <div style={{ fontWeight: 700, fontSize: 13 }}>Client&apos;s weekly schedule</div>
      </div>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 10, lineHeight: 1.5 }}>
        Upload the client&apos;s schedule (Excel or CSV). Each row fills its job by Site ID: the ticket, date and
        start time, address, lockbox, deliverables folder and checkout form. Only empty fields are filled. A row
        with no job becomes a new job for you to assign. You see what changes before anything does.
      </div>

      {!preview ? (
        <label className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          <Upload size={13} /> {busy ?? 'Upload schedule'}
          <input
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            disabled={!!busy}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
              e.target.value = '';
            }}
          />
        </label>
      ) : (
        <>
          <div style={{ fontSize: 12.5, marginBottom: 8 }}>
            <b>{fileName}</b>: {plural(preview.length, 'row')}
            {' · '}{plural(toFill, 'job')} to fill
            {upToDate ? ` · ${upToDate} already up to date` : ''}
            {' · '}{plural(toMake, 'new job')}
          </div>
          <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
            {preview.map((p) => (
              <div key={`${p.line}-${p.siteId}`} style={{ padding: '8px 12px', borderBottom: '1px solid #f3f3f3', fontSize: 12.5 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span style={{ color: '#666', minWidth: 130 }}>
                    {p.date ? dayLabel(p.date) : 'No date'}{p.time ? ` · ${timeLabel(p.time)}` : ''}
                  </span>
                  <span style={{ fontWeight: 700 }}>Site {p.siteId}</span>
                  {p.ticket && <span style={{ color: '#888' }}>{p.ticket}</span>}
                  <span style={{ flex: 1 }} />
                  {p.job && p.cancelled ? (
                    <span style={{ color: '#b45309', fontWeight: 700 }}>WO {p.job.wo_number} — called off on the sheet; nothing filled</span>
                  ) : p.job ? (
                    <span style={{ color: p.filled.length ? '#047857' : '#888' }}>
                      WO {p.job.wo_number}
                      {p.filled.length ? ` — adds ${p.filled.join(', ')}` : ' — already up to date'}
                    </span>
                  ) : p.cancelled ? (
                    <span style={{ color: '#888' }}>No job, and called off on the sheet — skipped</span>
                  ) : (
                    <span style={{ color: '#b45309', fontWeight: 700 }}>New job</span>
                  )}
                </div>
                {p.differs.map((d) => (
                  <div key={d} style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#b45309', fontSize: 11.5, marginTop: 3 }}>
                    <AlertTriangle size={12} /> {d} Not changed.
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={apply}
              disabled={!!busy || toFill + toMake === 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: busy || toFill + toMake === 0 ? 0.6 : 1 }}
            >
              <CheckCircle2 size={13} />
              {busy ?? (toFill + toMake === 0
                ? 'Nothing to change'
                : [toFill ? `Fill ${plural(toFill, 'job')}` : '', toMake ? `make ${plural(toMake, 'new job')}` : ''].filter(Boolean).join(' and '))}
            </button>
            <button className="btn btn-ghost" onClick={reset} disabled={!!busy}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
