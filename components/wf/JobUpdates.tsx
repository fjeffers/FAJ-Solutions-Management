'use client';
// Updates (Fred, 2026-10-31, the Monday.com updates feed): who changed what on a job and
// when, newest first: edits from the job form and the Sheet, automations, check-in/out.
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Section } from './WfUi';

type Entry = { at: string; what: string; lines: string[] };

const WHAT: Record<string, string> = {
  create: 'Job created', update: 'Changed', archive: 'Closed', unarchive: 'Reopened', delete: 'Deleted', auto: 'Automation',
};
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function JobUpdates({ woId, createdAt, checkedInAt, checkedOutAt }: {
  woId: string; createdAt?: string | null; checkedInAt?: string | null; checkedOutAt?: string | null;
}) {
  const [logged, setLogged] = useState<Entry[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let gone = false;
    void createClient().from('audit_log').select('action, details, created_at')
      .eq('entity_type', 'work_order').eq('entity_id', woId).order('created_at', { ascending: false }).limit(60)
      .then(({ data, error }) => {
        if (gone) return;
        if (error) { setLogged([]); return; }
        setLogged((data ?? []).map((r) => {
          const d = (r.details ?? {}) as { label?: string; changes?: unknown };
          const extra = String(d.label ?? '').replace(/^WO#\S*\s*/, '');
          const lines = Array.isArray(d.changes) ? d.changes.map(String) : [];
          return { at: String(r.created_at), what: [WHAT[String(r.action)] ?? String(r.action), extra].filter(Boolean).join(' · '), lines };
        }));
      });
    return () => { gone = true; };
  }, [woId]);

  const entries = [...(logged ?? [])];
  if (createdAt && !entries.some((e) => e.what.startsWith('Job created'))) entries.push({ at: createdAt, what: 'Job created', lines: [] });
  if (checkedInAt) entries.push({ at: checkedInAt, what: 'Tech checked in', lines: [] });
  if (checkedOutAt) entries.push({ at: checkedOutAt, what: 'Tech checked out', lines: [] });
  entries.sort((a, b) => b.at.localeCompare(a.at));
  const list = all ? entries : entries.slice(0, 8);

  return (
    <Section title="Updates" subtitle="Who changed what, newest first">
      {logged === null ? <div className="wf-subtle" style={{ fontSize: 13 }}>Loading…</div>
        : entries.length === 0 ? <div className="wf-subtle" style={{ fontSize: 13 }}>Nothing recorded yet. Changes from now on show here.</div>
        : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map((e, i) => (
              <li key={`${e.at}-${i}`} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, fontSize: 13.5 }}>
                <span className="wf-subtle" style={{ fontSize: 12.5 }}>{when(e.at)}</span>
                <span>
                  <b style={{ fontWeight: 600 }}>{e.what}</b>
                  {e.lines.map((l) => <span key={l} style={{ display: 'block', color: 'var(--wf-subtle)' }}>{l}</span>)}
                </span>
              </li>
            ))}
          </ol>
        )}
      {entries.length > 8 && (
        <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" style={{ marginTop: 8 }} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${entries.length}`}
        </button>
      )}
    </Section>
  );
}
