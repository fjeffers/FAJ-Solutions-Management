'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download } from 'lucide-react';
import { toCSV } from '@/lib/csv';
import { downloadCSVText } from '@/lib/export';
import { QBO_IMPORT_BATCH_SIZE, prepareQboCompletedJobs, qboInvoiceImportRows } from '@/lib/qbo-work-order-export';
import type { WorkOrder } from '@/lib/types';

export default function QuickBooksCompletedJobsExport({ workOrders }: { workOrders: WorkOrder[] }) {
  const plan = useMemo(() => prepareQboCompletedJobs(workOrders), [workOrders]);
  const exportKey = plan.jobs.map((job) => job.id).join(',');
  const [batchIndex, setBatchIndex] = useState(0);
  const [downloadNote, setDownloadNote] = useState('');
  const batchCount = Math.max(1, Math.ceil(plan.jobs.length / QBO_IMPORT_BATCH_SIZE));
  const batchDone = plan.jobs.length > QBO_IMPORT_BATCH_SIZE && batchIndex >= batchCount;
  const activeBatch = Math.min(batchIndex, batchCount - 1);
  const start = activeBatch * QBO_IMPORT_BATCH_SIZE;
  const batchJobs = plan.jobs.slice(start, start + QBO_IMPORT_BATCH_SIZE);

  useEffect(() => {
    setBatchIndex(0);
    setDownloadNote('');
  }, [exportKey]);

  const downloadBatch = () => {
    if (batchJobs.length === 0 || batchDone) return;
    const date = new Date().toISOString().slice(0, 10);
    const suffix = batchCount > 1 ? `-batch-${activeBatch + 1}-of-${batchCount}` : '';
    downloadCSVText(
      `quickbooks-completed-jobs-${date}${suffix}.csv`,
      toCSV(qboInvoiceImportRows(batchJobs)),
    );
    setDownloadNote(batchCount > 1
      ? `Downloaded batch ${activeBatch + 1} of ${batchCount} (${batchJobs.length} invoices).`
      : `Downloaded ${batchJobs.length} invoice${batchJobs.length === 1 ? '' : 's'}.`);
    setBatchIndex(activeBatch + 1);
  };

  return (
    <section className="glass card no-print" style={{ marginBottom: 24 }} aria-labelledby="qbo-completed-jobs-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 340px' }}>
          <div id="qbo-completed-jobs-title" style={{ fontWeight: 700, fontSize: 15 }}>Completed jobs → QuickBooks</div>
          <p style={{ margin: '5px 0 0', color: '#666', fontSize: 13 }}>
            Download an invoice-import CSV for jobs marked Work Done, Approved, or Paid. This creates a file; it does not post invoices automatically.
          </p>
        </div>
        <button
          className="btn btn-primary"
          disabled={plan.jobs.length === 0 || batchDone}
          onClick={downloadBatch}
          aria-label={`Download QuickBooks invoice import batch ${activeBatch + 1} of ${batchCount}`}
        >
          <Download size={14} />
          {batchDone ? 'All batches downloaded' : batchCount > 1 ? `Download batch ${activeBatch + 1} of ${batchCount}` : `Download CSV (${plan.jobs.length})`}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 18, fontSize: 12 }}>
        <span><strong>{plan.completedCount}</strong> completed</span>
        <span><strong>{plan.jobs.length}</strong> ready to import</span>
        {plan.skipped.length > 0 && <span><strong>{plan.skipped.length}</strong> need attention</span>}
      </div>

      <p style={{ margin: '12px 0 0', color: '#777', fontSize: 11 }}>
        The file uses one invoice per job, Net 30 terms, and a “Field Services” item. Import each file only once; QuickBooks allows up to 100 invoices per import.
      </p>

      {plan.skipped.length > 0 && (
        <details style={{ marginTop: 10, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: '#9a5b00', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={14} /> Review {plan.skipped.length} completed job{plan.skipped.length === 1 ? '' : 's'} not included
          </summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 22, color: '#666' }}>
            {plan.skipped.slice(0, 8).map((job) => (
              <li key={job.id}>WO #{job.workOrderNumber}: {job.reason}</li>
            ))}
            {plan.skipped.length > 8 && <li>And {plan.skipped.length - 8} more.</li>}
          </ul>
        </details>
      )}

      {downloadNote && <p aria-live="polite" style={{ margin: '10px 0 0', color: 'var(--teal)', fontSize: 12 }}>{downloadNote}</p>}
      {batchDone && (
        <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => { setBatchIndex(0); setDownloadNote(''); }}>
          Start batch downloads again
        </button>
      )}
    </section>
  );
}
