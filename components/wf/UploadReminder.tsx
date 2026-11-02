'use client';
// "Upload today's pictures" (Fred, 2026-11-01: "just reminders for them to upload the pictures"):
// shown when the tech leaves the site for the day, with the job's upload folder one tap away.
import { Upload } from 'lucide-react';
import { Dialog } from './WfUi';

export default function UploadReminder({ href, onClose }: { href?: string; onClose: () => void }) {
  return (
    <Dialog title="Upload today's pictures" onClose={onClose}
      footer={<button type="button" className="wf-btn wf-btn-ghost" onClick={onClose}>{href ? 'Later' : 'OK'}</button>}>
      <p style={{ marginTop: 0 }}>Before you go, put today&apos;s photos and documents where the client gets them.</p>
      {href
        ? <a className="wf-btn wf-btn-gold" href={href} target="_blank" rel="noopener noreferrer" onClick={onClose} style={{ width: '100%', justifyContent: 'center' }}><Upload size={16} /> Open the upload folder</a>
        : <p className="wf-subtle" style={{ marginBottom: 0 }}>Add them with the Photo button on the job.</p>}
    </Dialog>
  );
}
