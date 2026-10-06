'use client';
// A floating Save for full-page editors (Fred, 2026-10-06: "the save bar
// should be floating" — "every time I edit something it should be there").
// Forms in a window use the .save-bar row (app/globals.css); a whole-page
// editor like the floor plan uses this instead: a gold Save button pinned to
// the bottom of the screen whenever there's anything unsaved. It renders on
// document.body, because animated cards (.wf-rise) would trap position:fixed.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Save } from 'lucide-react';

export default function FloatingSave({ show, saving, onSave, label = 'Save changes' }: {
  show: boolean; saving?: boolean; onSave: () => void; label?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || (!show && !saving)) return null;
  return createPortal(
    <button type="button" onClick={onSave} disabled={saving}
      style={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(18px + env(safe-area-inset-bottom))', zIndex: 90,
        height: 46, padding: '0 22px', borderRadius: 999, border: 'none', background: '#C9A24B', color: '#0E1B2E',
        fontWeight: 800, fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
        cursor: saving ? 'default' : 'pointer', boxShadow: '0 8px 22px rgba(14,27,46,0.3)',
      }}>
      {saving ? <Loader2 size={17} className="spin" /> : <Save size={17} />} {saving ? 'Saving…' : label}
    </button>,
    document.body,
  );
}
