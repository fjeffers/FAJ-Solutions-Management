'use client';
import { useRef, useState } from 'react';
import { Upload, X, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { documentKindFor, isImageDocument, formatFileSize } from '@/lib/surveys';
import { toastError } from '@/lib/toast';
import type { SurveyDocument, SurveyDocumentKind } from '@/lib/types';
import { SURVEY_DOC_KINDS } from '@/lib/types';

const KIND_LABEL: Record<SurveyDocumentKind, string> = {
  photo: 'Photo', plan: 'Plan', spec: 'Spec sheet', quote: 'Vendor quote', other: 'Other',
};

/**
 * Site photos, existing plans, spec sheets and vendor quotes, attached to the
 * survey instead of living in an email thread.
 *
 * `folderKey` is generated once when the modal opens rather than taken from the
 * survey id, so a brand-new survey can take photos before it has ever been
 * saved — which is the normal case standing in a building.
 */
export default function SurveyDocuments({
  documents, folderKey, onChange,
}: {
  documents: SurveyDocument[];
  folderKey: string;
  onChange: (next: SurveyDocument[]) => void;
}) {
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    const added: SurveyDocument[] = [];

    for (const file of Array.from(files)) {
      const safe = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `${folderKey}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from('survey-docs').upload(path, file);
      if (error) { toastError(`Couldn't upload ${file.name}: ${error.message}`); continue; }
      const { data } = supabase.storage.from('survey-docs').getPublicUrl(path);
      added.push({
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        url: data.publicUrl,
        name: file.name,
        kind: documentKindFor(file.name, file.type),
        size: file.size,
        caption: null,
        uploaded_at: new Date().toISOString(),
      });
    }

    if (added.length > 0) onChange([...documents, ...added]);
    setBusy(false);
    if (fileInput.current) fileInput.current.value = '';
  };

  const update = (id: string, patch: Partial<SurveyDocument>) =>
    onChange(documents.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const remove = async (d: SurveyDocument) => {
    if (!confirm(`Remove ${d.name}?`)) return;
    // Best-effort storage cleanup; the record goes either way so a failed
    // delete never leaves a broken row in the survey.
    const marker = '/survey-docs/';
    const i = d.url.indexOf(marker);
    if (i >= 0) {
      const path = decodeURIComponent(d.url.slice(i + marker.length));
      await supabase.storage.from('survey-docs').remove([path]);
    }
    onChange(documents.filter((x) => x.id !== d.id));
  };

  return (
    <div>
      <input
        ref={fileInput} type="file" multiple hidden
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.dwg,.txt"
        onChange={(e) => upload(e.target.files)}
      />

      {documents.length === 0 ? (
        <div
          onClick={() => fileInput.current?.click()}
          style={{ padding: '22px 14px', textAlign: 'center', color: '#aaa', fontSize: 13, border: '1px dashed #ddd', borderRadius: 10, cursor: 'pointer' }}
        >
          <Upload size={22} color="#ddd" style={{ marginBottom: 6 }} />
          <div>Add site photos, floor plans, spec sheets or vendor quotes.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {documents.map((d) => (
            <div key={d.id} style={{ border: '1px solid #e8e8e8', borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.6)' }}>
              <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textDecoration: 'none' }}>
                {isImageDocument(d) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.url} alt={d.caption ?? d.name} style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(14,27,46,0.06)' }}>
                    <FileText size={26} color="var(--teal)" />
                  </div>
                )}
              </a>
              <div style={{ padding: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <select
                    className="select input" value={d.kind}
                    onChange={(e) => update(d.id, { kind: e.target.value as SurveyDocumentKind })}
                    style={{ fontSize: 10, padding: '4px 6px', height: 'auto' }}
                  >
                    {SURVEY_DOC_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                  <button onClick={() => remove(d)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 4, flexShrink: 0 }}>
                    <X size={13} />
                  </button>
                </div>
                <input
                  className="input" placeholder="Caption…" value={d.caption ?? ''}
                  onChange={(e) => update(d.id, { caption: e.target.value })}
                  style={{ fontSize: 11, padding: '5px 7px', marginTop: 5 }}
                />
                <div style={{ fontSize: 9, color: '#aaa', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.name}{d.size ? ` · ${formatFileSize(d.size)}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12 }}
        onClick={() => fileInput.current?.click()} disabled={busy}
      >
        {busy ? <Loader2 size={12} className="spin" /> : <ImageIcon size={12} />}
        {busy ? ' Uploading…' : ' Add Files'}
      </button>
    </div>
  );
}
