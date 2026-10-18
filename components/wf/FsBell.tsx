'use client';
// The bell in the tech portal's top bar, as in Field Service LIVE
// (FieldService.app app/components/alerts.js): the unread count, and every
// notification with All / Unread / High priority filters. Opening one goes to
// its job (or Messenger) and marks it read. The list is lib/tech-inbox.ts.
import { useEffect, useRef, useState } from 'react';
import { unreadNotes, type TechNote } from '@/lib/tech-inbox';
import { FsIcon } from './FsUi';

const ICON: Record<TechNote['kind'], string> = {
  message: 'chat', new: 'clipboard', date: 'calendar', time: 'clock', address: 'pin',
  scope: 'file', access: 'pin', docs: 'file', closed: 'check', removed: 'alert',
};
const LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export function FsBell({ notes, onOpen, onReadAll }: {
  notes: TechNote[];
  onOpen: (n: TechNote) => void;
  onReadAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread' | 'high'>('all');
  const box = useRef<HTMLDivElement>(null);
  const unread = unreadNotes(notes);
  const urgent = unread.some((n) => n.priority === 'high');
  const shown = notes.filter((n) => filter === 'all' || (filter === 'unread' ? !n.read : n.priority === 'high'));
  const now = Date.now();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="fs-bell-wrap" ref={box}>
      <button type="button" className={`fs-bell${urgent ? ' urgent' : ''}`} aria-label={`Notifications, ${unread.length} unread`}
        aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <FsIcon name="bell" size={20} />
        {unread.length > 0 && <em>{unread.length > 99 ? '99+' : unread.length}</em>}
      </button>
      {open && (
        <section className="fs-card fs-note-center" role="dialog" aria-label="Notifications">
          <header>
            <h2>Notifications</h2>
            {unread.length > 0 && <button type="button" className="fs-text-button" onClick={onReadAll}>Mark all read</button>}
          </header>
          <div className="fs-segmented" role="group" aria-label="Show notifications">
            {([['all', 'All'], ['unread', `Unread (${unread.length})`], ['high', 'High priority']] as const).map(([k, l]) => (
              <button type="button" key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <div className="fs-note-list">
            {shown.map((n) => (
              <button type="button" key={n.id} className={`fs-note-row${n.read ? '' : ' unread'}`}
                onClick={() => { setOpen(false); onOpen(n); }}>
                <i className={`fs-note-icon pri-${n.priority}`}><FsIcon name={ICON[n.kind]} size={16} /></i>
                <span><b>{n.text}</b><small>{ago(n.at, now)}</small></span>
                <em className={`fs-chip fs-chip-${n.priority === 'high' ? 'red' : n.priority === 'medium' ? 'amber' : 'grey'}`}>{LABEL[n.priority]}</em>
              </button>
            ))}
            {shown.length === 0 && (
              <p className="fs-muted fs-note-empty">
                {notes.length === 0 ? 'Nothing yet. New jobs, changes to your jobs and new messages show here.' : 'Nothing here.'}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
