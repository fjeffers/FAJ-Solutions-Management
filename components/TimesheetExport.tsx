'use client';
// Pull a job's hours as a timesheet: a PDF with the pictures, or a
// spreadsheet, for the dates picked (Fred, 2026-10-24: "add it as a export
// spread sheet when i pull they hours ti show up as a PDF or doc or some thing
// so i can send it or attached to the quickbooks"; "with the picture's").
// Send opens the phone's share sheet (text, email) where it has one.
import { useMemo, useState } from 'react';
import { FileDown, FileSpreadsheet, Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { inDates, type SheetRow } from '@/lib/field-sheet';
import { timesheetFile, timesheetLines, timesheetPdf, timesheetTable, TIMESHEET_WIDTHS, type TimesheetHead } from '@/lib/timesheet';
import { photoSources, timesheetPhotos } from '@/lib/timesheet-photos';
import { downloadXLSXBook } from '@/lib/export';
import { toastError, toastSuccess } from '@/lib/toast';
import type { WorkOrder } from '@/lib/types';

const address = (w: WorkOrder) => [w.site_address, [w.site_city, [w.site_state, w.site_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function TimesheetExport({ wo, rows }: { wo: WorkOrder; rows: SheetRow[] }) {
  const days = useMemo(() => rows.filter((r) => !r.hidden && !r.missing).map((r) => r.day).sort(), [rows]);
  const [from, setFrom] = useState(days[0] ?? '');
  const [to, setTo] = useState(days.at(-1) ?? '');
  const [pictures, setPictures] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  const head = (): TimesheetHead => ({
    woNumber: wo.wo_number, clientWo: wo.external_wo_id, site: wo.site_name || wo.title || '', address: address(wo),
    client: wo.customer_name ?? '', from: from || days[0] || '', to: to || days.at(-1) || '',
  });
  const picked = () => timesheetLines(rows.filter((r) => inDates(r.day, from, to)));
  const bad = () => {
    if (!from || !to) { toastError('Pick the dates first.'); return true; }
    if (from > to) { toastError('The first date is after the last one.'); return true; }
    return false;
  };

  /** The PDF, with the pictures when asked. */
  const pdf = async (): Promise<File | null> => {
    const h = head();
    let photos: Awaited<ReturnType<typeof timesheetPhotos>> = { photos: [], skipped: 0 };
    if (pictures) {
      setBusy('Finding the pictures…');
      const sources = await photoSources(createClient(), wo.id, h.from, h.to);
      photos = await timesheetPhotos(sources, (done, of) => setBusy(`Adding pictures ${done} of ${of}…`));
    }
    setBusy('Making the PDF…');
    const bytes = await timesheetPdf(h, picked(), photos.photos);
    if (photos.skipped) toastError(`${photos.skipped} picture${photos.skipped === 1 ? '' : 's'} left out (not a photo, or too many). The hours are all there.`);
    return new File([bytes as BlobPart], timesheetFile(h, 'pdf'), { type: 'application/pdf' });
  };

  const run = async (what: () => Promise<void>) => {
    if (bad() || busy) return;
    try { await what(); } catch (e) { toastError(e instanceof Error ? e.message : "Couldn't make the timesheet."); }
    setBusy(null);
  };
  const downloadPdf = () => run(async () => {
    const f = await pdf();
    if (f) { save(f, f.name); toastSuccess(`Saved ${f.name}`); }
  });
  const excel = () => run(async () => {
    setBusy('Making the spreadsheet…');
    const h = head();
    await downloadXLSXBook(timesheetFile(h, 'xlsx'), [{ name: 'Timesheet', rows: timesheetTable(h, picked()), colWidths: TIMESHEET_WIDTHS }]);
  });
  const send = () => run(async () => {
    const f = await pdf();
    if (!f) return;
    if (navigator.canShare?.({ files: [f] })) {
      try { await navigator.share({ files: [f], title: f.name.replace(/\.pdf$/, '') }); } catch { /* closed the share sheet */ }
    } else {
      save(f, f.name);
      toastSuccess('Saved the PDF. Attach it to your email or the QuickBooks invoice.');
    }
  });

  if (!days.length) return null;
  const field: React.CSSProperties = { display: 'grid', gap: 3, fontSize: 12 };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} role="group" aria-label="Export the timesheet">
      <label style={field}><span className="wf-label">From</span>
        <input type="date" className="wf-input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Timesheet from" /></label>
      <label style={field}><span className="wf-label">To</span>
        <input type="date" className="wf-input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Timesheet to" /></label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, paddingBottom: 8 }}>
        <input type="checkbox" checked={pictures} onChange={(e) => setPictures(e.target.checked)} /> With the receipts and odometer photos
      </label>
      <button type="button" className="wf-btn wf-btn-navy wf-btn-sm" disabled={!!busy} onClick={() => void downloadPdf()}><FileDown size={15} /> PDF</button>
      <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={!!busy} onClick={() => void excel()}><FileSpreadsheet size={15} /> Excel</button>
      {canShare && <button type="button" className="wf-btn wf-btn-gold wf-btn-sm" disabled={!!busy} onClick={() => void send()}><Send size={15} /> Send</button>}
      {busy && <span className="wf-subtle" style={{ fontSize: 12.5, paddingBottom: 8 }}>{busy}</span>}
    </div>
  );
}
