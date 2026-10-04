'use client';
// Closeout checklists (migration-106) — the deliverables a tech ticks off at
// the end of a job, by job type. Fred, 2026-10-04: "build it as mentioned, but
// in admin so i can make changes". A job gets the first list with one of its
// words in the job's title or description, or else the list with no words.
import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { parseCloseoutLists, type CloseoutList } from '@/lib/closeout';
import { toastError, toastSuccess } from '@/lib/toast';

type Draft = { id: string | null; name: string; keywords: string; items: string; sort: number };

const toDraft = (l: CloseoutList): Draft => ({ id: l.id, name: l.name, keywords: l.keywords.join(', '), items: l.items.join('\n'), sort: l.sort });
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const words = (s: string) => s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

const input: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid #d6d3cc', font: 'inherit', fontSize: 16, boxSizing: 'border-box' };
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 };

export default function CloseoutListsEditor() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = async () => {
    const { data, error } = await createClient().from('closeout_lists').select('id, name, keywords, items, sort').order('sort');
    if (error) { toastError(`Couldn't load the checklists: ${error.message}`); setDrafts([]); return; }
    setDrafts(parseCloseoutLists(data).map(toDraft));
  };
  useEffect(() => { void load(); }, []);

  const set = (i: number, patch: Partial<Draft>) => setDrafts((d) => d && d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async (i: number) => {
    const d = drafts?.[i];
    if (!d) return;
    const row = { name: d.name.trim() || 'Checklist', keywords: words(d.keywords), items: lines(d.items), sort: Number(d.sort) || 0, updated_at: new Date().toISOString() };
    if (row.items.length === 0) { toastError('Add at least one item, one per line.'); return; }
    setBusy(i);
    const sb = createClient();
    const { error } = d.id ? await sb.from('closeout_lists').update(row).eq('id', d.id) : await sb.from('closeout_lists').insert(row);
    setBusy(null);
    if (error) { toastError(`Couldn't save: ${error.message}`); return; }
    toastSuccess(`"${row.name}" saved. Techs see it the next time their jobs load.`);
    await load();
  };

  const remove = async (i: number) => {
    const d = drafts?.[i];
    if (!d) return;
    if (!d.id) { setDrafts((x) => x && x.filter((_, j) => j !== i)); return; }
    if (!confirm(`Delete the "${d.name}" checklist? Jobs it covered fall back to the list with no words.`)) return;
    setBusy(i);
    const { error } = await createClient().from('closeout_lists').delete().eq('id', d.id);
    setBusy(null);
    if (error) { toastError(`Couldn't delete: ${error.message}`); return; }
    await load();
  };

  if (!drafts) return <div style={{ padding: 20, color: '#888' }}>Loading…</div>;
  const hasDefault = drafts.some((d) => words(d.keywords).length === 0);

  return (
    <div style={{ padding: '16px 28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 13, color: '#666' }}>
        A job uses the first list (lowest order number) with one of its words in the job&apos;s title or description,
        otherwise the list with no words. Techs must tick every item before they can press Work done.
        {!hasDefault && <b style={{ color: '#b45309' }}> No list has empty words yet, so other jobs use the built-in standard list.</b>}
      </div>
      {drafts.map((d, i) => (
        <div key={d.id ?? `new-${i}`} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 2fr) 90px', gap: 10 }}>
            <div>
              <label style={label} htmlFor={`cl-name-${i}`}>Name</label>
              <input id={`cl-name-${i}`} style={input} value={d.name} onChange={(e) => set(i, { name: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor={`cl-words-${i}`}>Words that pick it (commas)</label>
              <input id={`cl-words-${i}`} style={input} value={d.keywords} placeholder="Empty: every other job"
                onChange={(e) => set(i, { keywords: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor={`cl-sort-${i}`}>Order</label>
              <input id={`cl-sort-${i}`} style={input} type="number" value={d.sort} onChange={(e) => set(i, { sort: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <label style={label} htmlFor={`cl-items-${i}`}>Items, one per line ({lines(d.items).length})</label>
            <textarea id={`cl-items-${i}`} style={{ ...input, minHeight: 140, resize: 'vertical' }} value={d.items}
              onChange={(e) => set(i, { items: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn-ghost" onClick={() => void remove(i)} disabled={busy !== null}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Trash2 size={14} /> Delete
            </button>
            <button className="btn-primary" onClick={() => void save(i)} disabled={busy !== null}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Save size={14} /> {busy === i ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ))}
      <button className="btn-ghost" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        onClick={() => setDrafts((x) => [...(x ?? []), { id: null, name: '', keywords: '', items: '', sort: (x?.length ?? 0) + 1 }])}>
        <Plus size={14} /> Add a checklist
      </button>
    </div>
  );
}
