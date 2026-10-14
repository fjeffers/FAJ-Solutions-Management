'use client';

// "What is this photo?" (Fred, 2026-10-14: "he takes a pic, the app asked
// Mike 'inventory', then the smartsheet gets the same on the next line with
// the pic"). Asked on project jobs right after each photo; the answer rides
// with the photo (wo_photos.label, migration 120) onto the live project sheet.
import { useState } from 'react';
import { Camera } from 'lucide-react';
import { Dialog } from './WfUi';

/** The quick picks first, then the job's own checklist, no repeats. */
export const PHOTO_LABELS = ['Inventory', 'Before', 'In progress', 'After', 'Equipment', 'Problem found'];

export function photoLabelChoices(checklist: string[]): string[] {
  const seen = new Set<string>();
  return [...PHOTO_LABELS, ...checklist].filter((l) => {
    const k = l.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function PhotoLabelDialog({ preview, choices, onPick, onCancel }: {
  preview: string | null; choices: string[]; onPick: (label: string | null) => void; onCancel: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <Dialog
      title="What is this photo?"
      onClose={onCancel}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={() => onPick(null)}>Skip</button>
        <button className="wf-btn wf-btn-navy" disabled={!text.trim()} onClick={() => onPick(text.trim())}><Camera size={16} /> Send photo</button>
      </>}
    >
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 10, marginBottom: 10 }} />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {choices.map((c) => (
          <button key={c} type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onPick(c)}>{c}</button>
        ))}
      </div>
      <input className="wf-input" style={{ marginTop: 10, fontSize: 16 }} value={text} maxLength={80}
        onChange={(e) => setText(e.target.value)} placeholder="Or type what it is"
        onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) onPick(text.trim()); }} />
    </Dialog>
  );
}
