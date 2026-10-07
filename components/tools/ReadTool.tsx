'use client';
// Read a code or a label from a photo, on the tech's phone — iScanner's QR /
// barcode reader and text recognition (Fred, 2026-10-07: "everything from
// iscanner"). Serial numbers and MAC addresses off equipment, a part number,
// the words on a sheet: copy them, or add them to the job report.
//
// Codes are tried first (lib/read-text.ts readCodes); "Read the words" runs
// text recognition on the same photo.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ClipboardCopy, FileText, Images, Loader2, NotebookPen, ScanText, X } from 'lucide-react';
import { readCodes, readText, type FoundCode } from '@/lib/read-text';
import { toastError, toastSuccess } from '@/lib/toast';

async function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap | HTMLImageElement;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("That photo couldn't be opened.")); im.src = URL.createObjectURL(file); });
  }
  const w0 = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width, h0 = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const k = Math.min(1, 2400 / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

const copy = (text: string) => {
  void navigator.clipboard?.writeText(text).then(() => toastSuccess('Copied.'), () => toastError('Couldn’t copy — press and hold the text to copy it.'));
};

export default function ReadTool({ onClose, onNote }: {
  onClose: () => void;
  /** Add a line to the job report (left out when the job can't take notes). */
  onNote?: (text: string) => Promise<void> | void;
}) {
  const [photo, setPhoto] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null);
  const [codes, setCodes] = useState<FoundCode[] | null>(null);
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const open = async (file: File | undefined) => {
    if (!file) return;
    setBusy('Looking for codes…');
    setCodes(null); setWords(null);
    try {
      const canvas = await loadPhoto(file);
      setPhoto({ canvas, url: canvas.toDataURL('image/jpeg', 0.8) });
      setCodes(await readCodes(canvas));
    } catch (e) {
      toastError(e instanceof Error ? e.message : "That photo couldn't be read.");
    } finally { setBusy(null); }
  };
  const readWords = async () => {
    if (!photo) return;
    setBusy('Reading the words… (the first time takes a little longer)');
    try {
      const text = await readText(photo.canvas, (share) => setBusy(`Reading the words… ${Math.round(share * 100)}%`));
      setWords(text || '');
    } catch {
      toastError('Couldn’t read the words — check the signal and try again.');
    } finally { setBusy(null); }
  };
  const note = async (text: string) => {
    if (!onNote || !text.trim()) return;
    await onNote(text.trim());
  };

  const pick = (label: string, icon: React.ReactNode, camera: boolean, primary: boolean) => (
    <label className={`wf-btn ${primary ? 'wf-btn-gold' : 'wf-btn-outline'}`} style={{ flex: '1 1 150px', justifyContent: 'center', opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
      {icon} {label}
      <input type="file" accept="image/*" {...(camera ? { capture: 'environment' as const } : {})} style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void open(f); }} />
    </label>
  );

  if (!mounted) return null;
  return createPortal(
    <div className="wf" role="dialog" aria-modal="true" aria-label="Read a code or label"
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'var(--wf-surface, #F6F4EF)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#0E1B2E', color: '#fff' }}>
        <button type="button" className="wf-btn wf-btn-sm" onClick={onClose} aria-label="Close" style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}><X size={16} /></button>
        <div style={{ flex: 1, fontWeight: 700 }}>Read a code or label</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!photo && (
          <div style={{ color: 'var(--wf-subtle)', fontSize: 14 }}>
            Take a close, sharp photo of a QR code, a barcode or a label — serial numbers, MAC addresses, part numbers. Fill the photo with it.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {pick(photo ? 'Another photo' : 'Take a photo', <Camera size={17} />, true, !photo)}
          {pick('From photos', <Images size={17} />, false, false)}
        </div>
        {busy && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--wf-subtle)', fontSize: 14 }}><Loader2 size={16} className="spin" /> {busy}</div>}
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt="The photo being read" style={{ maxHeight: 220, objectFit: 'contain', borderRadius: 10, background: '#fff', border: '1px solid var(--wf-line)' }} />
        )}
        {codes && codes.length > 0 && codes.map((c) => (
          <div key={c.text} className="wf-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="wf-label">{c.kind}</div>
            <div style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 15, wordBreak: 'break-all', userSelect: 'text' }}>{c.text}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => copy(c.text)}><ClipboardCopy size={15} /> Copy</button>
              {onNote && <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => void note(`${c.kind}: ${c.text}`)}><NotebookPen size={15} /> Add to the job report</button>}
              {/^https?:\/\//i.test(c.text) && <a className="wf-btn wf-btn-ghost wf-btn-sm" href={c.text} target="_blank" rel="noopener noreferrer">Open link</a>}
            </div>
          </div>
        ))}
        {photo && codes && codes.length === 0 && !busy && words === null && (
          <div style={{ fontSize: 14 }}>No QR code or barcode found in that photo. Try closer and steadier — or read the words on it.</div>
        )}
        {photo && !busy && words === null && (
          <button type="button" className="wf-btn wf-btn-navy" onClick={() => void readWords()}><ScanText size={17} /> Read the words</button>
        )}
        {words !== null && (
          <div className="wf-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="wf-label"><FileText size={13} style={{ verticalAlign: -2 }} /> Words in the photo — fix anything it misread</div>
            <textarea className="wf-input" rows={8} value={words} onChange={(e) => setWords(e.target.value)} placeholder="No words found." style={{ fontSize: 16, width: '100%' }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={!words.trim()} onClick={() => copy(words)}><ClipboardCopy size={15} /> Copy</button>
              {onNote && <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" disabled={!words.trim()} onClick={() => void note(words)}><NotebookPen size={15} /> Add to the job report</button>}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
