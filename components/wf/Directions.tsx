'use client';
// Directions: one tap opens a choice of Google Maps, Waze or Apple Maps
// (lib/navigation.ts). Used wherever the tech app had a Directions button.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Navigation } from 'lucide-react';
import { fullAddress, type WfJob } from '@/lib/wf';
import { NAV_APPS, navLink } from '@/lib/navigation';
import { Dialog } from './WfUi';

export default function DirectionsButton({ job, className, style, icon }: {
  job: WfJob; className?: string; style?: CSSProperties;
  /** The icon as the button shows it; a plain navigation arrow otherwise. */
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const target = { address: fullAddress(job), lat: job.siteLat, lng: job.siteLng };
  if (!navLink('google', target)) return null;
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setOpen(true)}>
        {icon ?? <Navigation size={15} />} Directions
      </button>
      {open && (
        <Dialog title="Directions" onClose={() => setOpen(false)}>
          <p className="wf-subtle" style={{ margin: '0 0 12px', fontSize: 13.5 }}>{target.address || 'The site\'s GPS point'}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {NAV_APPS.map((a) => (
              <a key={a.key} className="wf-btn wf-btn-outline" href={navLink(a.key, target) ?? undefined}
                target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                <Navigation size={16} /> {a.label}
              </a>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
