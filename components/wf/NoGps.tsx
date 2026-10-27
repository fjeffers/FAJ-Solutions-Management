'use client';
// A picture held back for want of GPS (Fred, 2026-10-27: "Geo tag on every
// picture"). It is never thrown away (Greptile on PR #28): it stays here, with
// any marks drawn on it, until Location is on and the tech sends it again.
import { MapPin } from 'lucide-react';
import { noGpsMessage } from '@/lib/geo';

export function HeldForGps({ onRetry, onDiscard, busy = false }: { onRetry: () => void; onDiscard: () => void; busy?: boolean }) {
  return (
    <div role="alert" style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 10, background: 'rgba(180,83,9,0.08)', border: '1px solid rgba(180,83,9,0.3)', fontSize: 13 }}>
      <div style={{ fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}><MapPin size={15} /> Photo not sent: no GPS right now</div>
      <div className="wf-subtle">{noGpsMessage()} The photo is kept here until then.</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="wf-btn wf-btn-navy wf-btn-sm" disabled={busy} onClick={onRetry}>Send again</button>
        <button type="button" className="wf-btn wf-btn-ghost wf-btn-sm" disabled={busy} onClick={onDiscard}>Discard</button>
      </div>
    </div>
  );
}
