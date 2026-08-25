'use client';
import { useRef, useState } from 'react';
import { X, ImagePlus, Loader2 } from 'lucide-react';
import { uploadSurveyFile, deleteSurveyFile } from '@/lib/survey-upload';
import { toastError } from '@/lib/toast';

/**
 * Photos of the recommended spot for one device — a camera position, a drop
 * location. Shared by the schedule rows and the Placements page so a photo
 * added in either place is the same photo.
 *
 * `capture="environment"` opens the rear camera straight from a phone, because
 * these get taken standing under the spot, not uploaded afterwards.
 */
export default function SurveyPhotoStrip({
  photos, folderKey, alt, size = 54, addLabel = 'Area', onChange,
}: {
  photos: string[];
  folderKey: string;
  alt: string;
  size?: number;
  addLabel?: string;
  onChange: (photos: string[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      try {
        urls.push(await uploadSurveyFile(folderKey, file));
      } catch (e) {
        toastError(`Couldn't upload ${file.name}: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
    if (urls.length > 0) onChange([...photos, ...urls]);
    setBusy(false);
    if (input.current) input.current.value = '';
  };

  const remove = async (url: string) => {
    // Drop the reference first: a failed storage delete must never leave a
    // photo the surveyor already dismissed still showing on the row.
    onChange(photos.filter((p) => p !== url));
    await deleteSurveyFile(url);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
      <input
        ref={input} type="file" hidden multiple accept="image/*" capture="environment"
        onChange={(e) => add(e.target.files)}
      />
      {photos.map((url) => (
        <div key={url} style={{ position: 'relative', width: size, height: size, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e2e2' }}>
          <a href={url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </a>
          <button
            onClick={() => remove(url)} title="Remove photo"
            style={{
              position: 'absolute', top: 1, right: 1, width: 17, height: 17, borderRadius: '50%',
              background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}
          ><X size={10} /></button>
        </div>
      ))}
      <button
        onClick={() => input.current?.click()} disabled={busy}
        title="Photo of the recommended spot"
        style={{
          width: size, height: size, borderRadius: 8, border: '1px dashed #ccc', background: 'none',
          cursor: 'pointer', color: '#999', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: size > 70 ? 10 : 8,
        }}
      >
        {busy ? <Loader2 size={size > 70 ? 20 : 15} /> : <ImagePlus size={size > 70 ? 20 : 15} />}
        {busy ? 'Wait…' : addLabel}
      </button>
    </div>
  );
}
