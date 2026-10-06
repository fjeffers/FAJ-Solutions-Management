'use client';
// A list of sketches with their pictures, and the sketch pad to make or open
// one (Fred, 2026-10-06: "I want to be able to sketch my own layout"). Shown on
// a job, on a survey, and on its own under Sales › Sketches. Sketches are kept
// in the `sketches` table and their pictures and photos in the private
// 'sketches' storage folder (migration 112). Office only.
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { Download, FileText, PencilRuler, Plus, Printer, Trash2 } from 'lucide-react';
import BlankSketchForm from './BlankSketchForm';
import SketchReport, { downloadFromUrl, fileSafe } from './SketchReport';
import { createClient } from '@/lib/supabase/client';
import { newId, newSketch, normalizeSketch, summarize, summaryLine, type Sketch } from '@/lib/sketch';
import { shrinkPhoto } from '@/lib/photo-stamp';
import { toastError, toastSuccess } from '@/lib/toast';

// The editor is big; load it only when a sketch is opened.
const SketchEditor = dynamic(() => import('./SketchEditor'), { ssr: false });

type Row = {
  id: string; title: string; data: unknown; image_path: string | null; updated_at: string;
  wo_id: string | null; survey_id: string | null;
};

export default function SketchesPanel({ woId, surveyId, defaultTitle, compact = false, labelFor }: {
  /** Show and make sketches for this job… */
  woId?: string | null;
  /** …or this survey. Neither: every sketch. */
  surveyId?: string | null;
  defaultTitle?: string;
  compact?: boolean;
  /** "On WO 19101393" etc., when listing every sketch. */
  labelFor?: (row: { wo_id: string | null; survey_id: string | null }) => string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<{ id: string | null; title: string; sketch: Sketch } | null>(null);
  // The printable report (Fred, 2026-10-06: "downloadable forms").
  const [report, setReport] = useState<Row | null>(null);
  const [blankForm, setBlankForm] = useState(false);

  const load = useCallback(async () => {
    let q = supabase.from('sketches').select('id, title, data, image_path, updated_at, wo_id, survey_id').order('updated_at', { ascending: false });
    if (woId) q = q.eq('wo_id', woId);
    if (surveyId) q = q.eq('survey_id', surveyId);
    const { data, error } = await q.limit(200);
    if (error) { toastError(`Couldn't load sketches: ${error.message}`); setRows([]); return; }
    const list = (data ?? []) as Row[];
    setRows(list);
    const paths = list.map((r) => r.image_path).filter((p): p is string => !!p);
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('sketches').createSignedUrls(paths, 3600);
      const map: Record<string, string> = {};
      for (const s of signed ?? []) if (s.path && s.signedUrl) map[s.path] = s.signedUrl;
      setThumbs(map);
    }
  }, [supabase, woId, surveyId]);

  useEffect(() => { void load(); }, [load]);

  const ownerFolder = async (): Promise<string | null> => (await supabase.auth.getUser()).data.user?.id ?? null;

  const uploadFile = useCallback(async (file: Blob, kind: 'photo' | 'bg'): Promise<string | null> => {
    const uid = await ownerFolder();
    if (!uid) return null;
    let body: Blob = file;
    try { body = await shrinkPhoto(file, kind === 'bg' ? 2400 : 1600); } catch { /* keep the original */ }
    const path = `${uid}/${kind === 'bg' ? 'bg' : 'photos'}/${newId()}.jpg`;
    const { error } = await supabase.storage.from('sketches').upload(path, body, { contentType: 'image/jpeg', upsert: false });
    return error ? null : path;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const fileUrl = useCallback(async (path: string): Promise<string | null> => {
    const { data } = await supabase.storage.from('sketches').createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }, [supabase]);

  const save = async (sketch: Sketch, title: string, png: Blob | null): Promise<string | null> => {
    if (!open) return 'Nothing open';
    const uid = await ownerFolder();
    if (!uid) return 'You were signed out. Sign in again, then save.';
    let id = open.id;
    const now = new Date().toISOString();
    if (!id) {
      const { data, error } = await supabase.from('sketches')
        .insert({ user_id: uid, wo_id: woId ?? null, survey_id: surveyId ?? null, title, data: sketch, updated_at: now })
        .select('id').single();
      if (error || !data) return `Couldn't save: ${error?.message ?? 'no reply'}`;
      id = data.id as string;
      setOpen((o) => (o ? { ...o, id } : o));
    } else {
      const { error } = await supabase.from('sketches').update({ title, data: sketch, updated_at: now }).eq('id', id);
      if (error) return `Couldn't save: ${error.message}`;
    }
    // The picture of the plan, for this list, the job and reports.
    if (png) {
      const path = `${uid}/${id}.png`;
      const { error: upErr } = await supabase.storage.from('sketches').upload(path, png, { contentType: 'image/png', upsert: true });
      if (!upErr) await supabase.from('sketches').update({ image_path: path }).eq('id', id);
    }
    toastSuccess('Sketch saved');
    void load();
    return null;
  };

  const remove = async (r: Row) => {
    if (!window.confirm(`Delete the sketch "${r.title}"? This can't be undone.`)) return;
    const { error } = await supabase.from('sketches').delete().eq('id', r.id);
    if (error) { toastError(`Couldn't delete: ${error.message}`); return; }
    if (r.image_path) await supabase.storage.from('sketches').remove([r.image_path]);
    void load();
  };

  const startNew = () => setOpen({ id: null, title: defaultTitle ?? 'Site sketch', sketch: newSketch() });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="wf-btn wf-btn-gold wf-btn-sm" onClick={startNew}><Plus size={15} /> New sketch</button>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setBlankForm(true)} title="Grid paper with the symbols, to draw by hand"><Printer size={15} /> Blank sketch form</button>
        {!compact && <span className="wf-p-small wf-subtle">Floor plans to scale, cable runs, cameras, APs and drops — counted for you.</span>}
      </div>
      {rows === null ? (
        <div className="wf-p-small wf-subtle">Loading sketches…</div>
      ) : rows.length === 0 ? (
        <div className="wf-p-small wf-subtle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PencilRuler size={16} /> No sketches yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 180 : 220}px, 1fr))`, gap: 10 }}>
          {rows.map((r) => {
            const sum = summaryLine(summarize(normalizeSketch(r.data)));
            const link = labelFor?.(r) ?? null;
            return (
              <div key={r.id} className="wf-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <button type="button" onClick={() => setOpen({ id: r.id, title: r.title, sketch: normalizeSketch(r.data) })}
                  style={{ border: 'none', padding: 0, background: '#f6f4ef', cursor: 'pointer', aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  aria-label={`Open the sketch ${r.title}`}>
                  {r.image_path && thumbs[r.image_path]
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={thumbs[r.image_path]} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
                    : <PencilRuler size={30} color="#b0b8c4" />}
                </button>
                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" onClick={() => setOpen({ id: r.id, title: r.title, sketch: normalizeSketch(r.data) })}
                      style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.title}
                    </button>
                    <button type="button" onClick={() => setReport(r)} aria-label={`Report for ${r.title}`} title="Report — print or save as PDF" style={{ border: 'none', background: 'none', color: '#0E1B2E', cursor: 'pointer', padding: 2 }}><FileText size={15} /></button>
                    {r.image_path && thumbs[r.image_path] && (
                      <button type="button" onClick={() => void downloadFromUrl(thumbs[r.image_path!], `${fileSafe(r.title)}.png`)} aria-label={`Download the picture of ${r.title}`} title="Download the picture" style={{ border: 'none', background: 'none', color: '#0E1B2E', cursor: 'pointer', padding: 2 }}><Download size={15} /></button>
                    )}
                    <button type="button" onClick={() => void remove(r)} aria-label={`Delete ${r.title}`} title="Delete" style={{ border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer', padding: 2 }}><Trash2 size={15} /></button>
                  </div>
                  {link && <div className="wf-p-small" style={{ color: 'var(--wf-gold-ink, #7a5c16)', fontWeight: 600 }}>{link}</div>}
                  <div className="wf-p-small wf-subtle" style={{ lineHeight: 1.35 }}>{sum}</div>
                  <div className="wf-p-small wf-subtle">{new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {blankForm && <BlankSketchForm onClose={() => setBlankForm(false)} />}
      {report && (
        <SketchReport title={report.title} sketch={normalizeSketch(report.data)} imageUrl={report.image_path ? thumbs[report.image_path] ?? null : null}
          photoUrl={fileUrl} linkLabel={labelFor?.(report) ?? null} updatedAt={report.updated_at} onClose={() => setReport(null)} />
      )}
      {/* Drawn over the whole page, so a pop-up or animated card around this
          list can never trap the full-screen sketch pad inside it. */}
      {open && typeof document !== 'undefined' && createPortal(
        <SketchEditor title={open.title} initial={open.sketch} onSave={save} onClose={() => { setOpen(null); void load(); }}
          uploadFile={uploadFile} fileUrl={fileUrl} />,
        document.body,
      )}
    </div>
  );
}
