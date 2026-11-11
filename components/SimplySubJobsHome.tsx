'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';

type SimplySubJob = {
  job_id: string;
  site_number: string;
  title: string;
  source_url: string;
  work_order_id: string | null;
  work_order_number: string | null;
  linked_title: string | null;
  archived: boolean;
};

type SimplySubResponse = {
  error?: string;
  jobs?: SimplySubJob[];
  open?: number;
  linked?: number;
  new_to_faj?: number;
  at?: string;
};

export default function SimplySubJobsHome({
  onOpenJob,
  onOpenImports,
}: {
  onOpenJob: (id: string) => void;
  onOpenImports: () => void;
}) {
  const [jobs, setJobs] = useState<SimplySubJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch('/api/simplysub/jobs', { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as SimplySubResponse;
      if (!response.ok) {
        setError(body.error || 'SimplySub jobs could not be loaded.');
        return;
      }
      setJobs(body.jobs ?? []);
      setSyncedAt(body.at ?? new Date().toISOString());
      setError('');
    } catch {
      setError('SimplySub jobs could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { void load(); }, 5 * 60_000);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const newJobs = useMemo(() => jobs.filter((job) => !job.work_order_id), [jobs]);
  const visible = showAll ? jobs : jobs.slice(0, 6);

  return (
    <section className="glass card" style={{ maxWidth: 1200, margin: '14px auto 0', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17 }}>SimplySub work orders</h2>
          <div style={{ marginTop: 3, fontSize: 12, color: '#667085' }}>
            {loading ? 'Loading open SimplySub jobs…' : `${jobs.length} open · ${newJobs.length} new to FAJ · ${jobs.length - newJobs.length} linked`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {newJobs.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={onOpenImports}>Review new jobs</button>
          )}
          <button type="button" className="btn btn-ghost" disabled={refreshing} onClick={() => void load(true)}>
            <RefreshCw size={14} className={refreshing ? 'spin' : undefined} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div role="alert" style={{ marginTop: 12, color: '#b42318', fontSize: 12 }}>{error}</div>}
      {!loading && !error && jobs.length === 0 && (
        <div style={{ marginTop: 14, color: '#667085', fontSize: 13 }}>No open SimplySub work orders were found.</div>
      )}
      {visible.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginTop: 13 }}>
          {visible.map((job) => (
            <div key={job.job_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center', padding: '10px 11px', border: '1px solid #E5E7EB', borderRadius: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13, overflowWrap: 'anywhere' }}>{job.title || `SimplySub job ${job.job_id}`}</div>
                <div style={{ color: '#667085', fontSize: 11.5, marginTop: 2 }}>
                  Site {job.site_number} · {job.work_order_id ? `FAJ WO ${job.work_order_number || 'linked'}${job.archived ? ' · closed' : ''}` : 'New to FAJ'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {job.work_order_id && !job.archived && (
                  <button type="button" className="btn btn-ghost" onClick={() => onOpenJob(job.work_order_id!)}>Open FAJ</button>
                )}
                <a className="btn btn-ghost" href={job.source_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  SimplySub <ExternalLink size={13} />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
      {jobs.length > 6 && (
        <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer' : `Show all ${jobs.length}`}
        </button>
      )}
      {syncedAt && <div style={{ marginTop: 9, color: '#98A2B3', fontSize: 10.5 }}>Checked {new Date(syncedAt).toLocaleString()}</div>}
    </section>
  );
}
