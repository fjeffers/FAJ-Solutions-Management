'use client';
// The tech's Alerts bar on his home screen (Fred, 2026-11-01: "like alerts for admin and tech" ...
// "add it"): one line with a count; tap it for the list. New offers, unread messages, jobs starting
// tomorrow and pictures to upload from today.
import { useState } from 'react';
import { Bell, ChevronDown, ChevronUp } from 'lucide-react';
import type { WfJob } from '@/lib/wf';
import { easternNow } from '@/lib/automations';
import { addDays } from '@/lib/week-view';

type Item = { key: string; text: string; go: () => void };

export default function TechAlerts({ jobs, unread, onOpen, onChat }: {
  jobs: WfJob[]; unread: number; onOpen: (id: string) => void; onChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const today = easternNow().day;
  const tomorrow = addDays(today, 1);
  const working = (j: WfJob) => j.status !== 'closed' && j.status !== 'declined' && j.status !== 'offered';
  const items: Item[] = [
    ...jobs.filter((j) => j.status === 'offered').map((j) => ({ key: `o${j.id}`, text: `New job offered · WO ${j.number}${j.siteName ? ` · ${j.siteName}` : ''}`, go: () => onOpen(j.id) })),
    ...(unread > 0 ? [{ key: 'msg', text: `${unread} unread message${unread === 1 ? '' : 's'}`, go: onChat }] : []),
    ...jobs.filter((j) => working(j) && j.date === tomorrow).map((j) => ({ key: `t${j.id}`, text: `Starts tomorrow · WO ${j.number}${j.siteName ? ` · ${j.siteName}` : ''}`, go: () => onOpen(j.id) })),
    ...jobs.filter((j) => working(j) && (j.myDay ?? []).some((e) => easternNow(new Date(e.at)).day === today))
      .map((j) => ({ key: `p${j.id}`, text: `Upload today's pictures · WO ${j.number}`, go: () => onOpen(j.id) })),
  ];
  return (
    <section className="fs-card" aria-label="Alerts" style={{ marginBottom: 14, padding: '10px 14px' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={items.length === 0}
        style={{ all: 'unset', cursor: items.length ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <Bell size={18} color="var(--wf-gold, #c9a24b)" />
        <b>Alerts</b>
        {items.length > 0 && <span className="wf-chip" style={{ fontSize: 12 }}>{items.length}</span>}
        <span className="fs-meta" style={{ flex: 1, margin: 0 }}>{items.length ? 'Tap to see them' : 'Nothing needs you right now'}</span>
        {items.length > 0 && (open ? <ChevronUp size={18} /> : <ChevronDown size={18} />)}
      </button>
      {open && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, maxHeight: 280, overflowY: 'auto' }}>
          {items.map((i) => <button key={i.key} type="button" className="wf-btn wf-btn-outline" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={i.go}>{i.text}</button>)}
        </div>
      )}
    </section>
  );
}
