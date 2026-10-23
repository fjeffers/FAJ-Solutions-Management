'use client';
// Any job document, opened inside the app (Fred, 2026-10-22: documents "not
// working for all ... ios, windows, and android"). A plain link left it to the
// phone: Android Chrome downloads a PDF instead of showing it, and a Word or
// Excel file needs those apps. Here every kind opens the same on every device:
//   PDF    its pages, and its fillable boxes as boxes to fill in (lib/pdf-form.ts)
//   Word   an editable page, like a Google Doc, made into a PDF to sign (lib/doc-to-pdf.ts)
//   Excel  its sheets as tables
//   Photo  the picture
// "Fill in & sign" hands a PDF to the PDF editor (components/tools/PdfEditor).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, Signature, X } from 'lucide-react';
import { openPdf, renderPage } from '@/lib/pdf-view';
import { fillForm, readFormFields, type FormField, type FormValues } from '@/lib/pdf-form';
import { blocksFromHtml, blocksToPdf } from '@/lib/doc-to-pdf';
import { toastError } from '@/lib/toast';

export type DocKind = 'pdf' | 'word' | 'sheet' | 'image' | 'other';

/** What kind of document, from its name or type. */
export function docKind(name: string, type = ''): DocKind {
  const n = name.toLowerCase().split('?')[0];
  if (/\.pdf$/.test(n) || type === 'application/pdf') return 'pdf';
  if (/\.docx$/.test(n) || type.includes('wordprocessingml')) return 'word';
  if (/\.(xlsx|xls|csv)$/.test(n) || type.includes('spreadsheetml') || type === 'text/csv') return 'sheet';
  if (/\.(jpe?g|png|gif|webp|heic)$/.test(n) || type.startsWith('image/')) return 'image';
  return 'other';
}

/** Links inside a document keep only web and email addresses. */
function tidyLinks(root: HTMLElement) {
  root.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (/^(https?:|mailto:)/i.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    else a.removeAttribute('href');
  });
  root.querySelectorAll('script,iframe,object,embed').forEach((el) => el.remove());
}

export default function DocViewer({ url, name, onClose, onSign }: {
  url: string; name: string; onClose: () => void;
  /** Open this PDF in the PDF editor to sign and send. Absent: view only. */
  onSign?: (pdf: Blob, name: string) => void;
}) {
  const kind = docKind(name) !== 'other' ? docKind(name) : docKind(url);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [values, setValues] = useState<FormValues>({});
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const title = name.replace(/\.(pdf|docx|xlsx|xls|csv)$/i, '');

  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Couldn't open the document.");
        const b = new Uint8Array(await res.arrayBuffer());
        if (!live) return;
        setBytes(b);
        if (kind === 'pdf') {
          const f = await readFormFields(b);
          if (!live) return;
          setFields(f);
          setValues(Object.fromEntries(f.map((x) => [x.name, x.value])));
          const pdf = await openPdf(b);
          const width = Math.min(1200, Math.round((typeof window !== 'undefined' ? window.innerWidth : 600) * 2));
          for (let i = 1; i <= pdf.numPages && live; i++) {
            const { blob } = await renderPage(await pdf.getPage(i), 0, width, 0.8);
            const u = URL.createObjectURL(blob);
            urls.push(u);
            if (live) setPages((p) => [...p, u]);
          }
        } else if (kind === 'word') {
          const mammoth = await import('mammoth');
          const r = await mammoth.convertToHtml({ arrayBuffer: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer });
          if (live) setHtml(r.value || '<p></p>');
        } else if (kind === 'sheet') {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(b, { type: 'array' });
          const out = wb.SheetNames.map((s) => `<h3>${s.replace(/[<>&"]/g, '')}</h3>${XLSX.utils.sheet_to_html(wb.Sheets[s], { header: '', footer: '' })}`).join('');
          if (live) setHtml(out);
        }
      } catch (e) {
        if (live) setError(e instanceof Error && e.message.startsWith("Couldn't") ? e.message : "Couldn't open the document. Try again when you have signal.");
      }
    })();
    return () => { live = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [url, kind]);

  // The Word page and the sheets are the file's own content: set once, links tidied.
  useEffect(() => {
    const el = kind === 'word' ? editRef.current : sheetRef.current;
    if (el && html != null) { el.innerHTML = html; tidyLinks(el); }
  }, [html, kind]);

  const sign = async () => {
    if (!onSign || !bytes) return;
    setBusy(true);
    try {
      if (kind === 'pdf') {
        const out = fields.length ? await fillForm(bytes, values) : bytes;
        onSign(new Blob([out.slice()], { type: 'application/pdf' }), title);
      } else if (kind === 'word' && editRef.current) {
        const out = await blocksToPdf(blocksFromHtml(editRef.current), title);
        onSign(new Blob([out.slice()], { type: 'application/pdf' }), title);
      }
    } catch {
      toastError("Couldn't make the PDF. Try again.");
    }
    setBusy(false);
  };

  const field = (f: FormField) => {
    const v = values[f.name];
    const set = (x: string | boolean) => setValues((s) => ({ ...s, [f.name]: x }));
    const lab = <span className="wf-label" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>{f.label}</span>;
    if (f.kind === 'check') {
      return (
        <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
          <input type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked)} style={{ width: 22, height: 22 }} />
          <span style={{ fontWeight: 600 }}>{f.label}</span>
        </label>
      );
    }
    if (f.kind === 'choice') {
      return (
        <label key={f.name} style={{ display: 'block' }}>{lab}
          <select className="wf-input" value={String(v ?? '')} onChange={(e) => set(e.target.value)}>
            <option value="">—</option>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      );
    }
    return (
      <label key={f.name} style={{ display: 'block' }}>{lab}
        {f.multiline
          ? <textarea className="wf-input" rows={3} value={String(v ?? '')} maxLength={f.maxLength ?? undefined} onChange={(e) => set(e.target.value)} />
          : <input className="wf-input" value={String(v ?? '')} maxLength={f.maxLength ?? undefined} onChange={(e) => set(e.target.value)} />}
      </label>
    );
  };

  const canSign = !!onSign && !!bytes && (kind === 'pdf' || (kind === 'word' && html != null));
  const loading = !error && (!bytes || (kind === 'pdf' && pages.length === 0) || ((kind === 'word' || kind === 'sheet') && html == null));

  const body = (
    <div className="wf" role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', flexDirection: 'column', background: 'var(--wf-surface, #F6F4EF)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--wf-line)', background: 'var(--wf-card, #fff)' }}>
        <b style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 15 }}>{title}</b>
        <a className="wf-btn wf-btn-ghost wf-btn-sm" href={url} download={name || undefined} target="_blank" rel="noopener noreferrer" aria-label="Download"><Download size={16} /></a>
        <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 12 }}>
        <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div className="wf-card" style={{ padding: 14 }}>{error}</div>}
          {loading && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 14 }}><Loader2 size={18} className="spin" /> Opening…</div>}

          {kind === 'pdf' && fields.length > 0 && (
            <div className="wf-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <b>Fill in the form</b>
                <div className="wf-subtle" style={{ fontSize: 12.5 }}>{fields.length} box{fields.length === 1 ? '' : 'es'} on this form. Your answers go into the PDF.</div>
              </div>
              {fields.map(field)}
            </div>
          )}
          {kind === 'pdf' && pages.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt={`Page ${i + 1}`} style={{ width: '100%', height: 'auto', background: '#fff', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }} />
          ))}

          {kind === 'word' && html != null && (
            <>
              <div className="wf-subtle" style={{ fontSize: 12.5 }}>Tap anywhere on the page to type, like a Google Doc. Fill in the blanks, then Fill in &amp; sign.</div>
              <div ref={editRef} contentEditable suppressContentEditableWarning className="wf-doc-page"
                style={{ background: '#fff', padding: '28px 24px', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', lineHeight: 1.5, outline: 'none', minHeight: 300, overflowWrap: 'anywhere' }} />
            </>
          )}

          {kind === 'sheet' && html != null && (
            <div ref={sheetRef} className="wf-doc-sheet" style={{ background: '#fff', padding: 12, borderRadius: 6, overflowX: 'auto' }} />
          )}

          {kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={title} style={{ width: '100%', height: 'auto', borderRadius: 6 }} />
          )}

          {kind === 'other' && (
            <div className="wf-card" style={{ padding: 14 }}>This kind of file can&apos;t be shown in the app. Use Download to open it on the device.</div>
          )}
        </div>
      </div>
      {canSign && (
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--wf-line)', background: 'var(--wf-card, #fff)', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="wf-btn wf-btn-gold" disabled={busy || loading} onClick={() => void sign()}>
            <Signature size={16} /> {busy ? 'One moment…' : 'Fill in & sign'}
          </button>
        </div>
      )}
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(body, document.body);
}
