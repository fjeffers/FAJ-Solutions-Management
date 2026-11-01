'use client';
// Automations on Home (Fred, 2026-10-31): what the rules found (jobs with no tech
// soon, jobs waiting to be invoiced), and the Rules box to switch each one on or off.
import { useState } from 'react';
import { Bell, ChevronDown, ChevronUp } from 'lucide-react';
import { AUTO_RULES, noTechSoon, waitingInvoice, type AutoRule } from '@/lib/automations';
import { todayISO } from '@/lib/utils';
import type { WorkOrder } from '@/lib/types';
import { Dialog } from './WfUi';

export default function AutomationsCard({ rules, onChange, workOrders, onOpenJob, saveError }: {
  rules: AutoRule[]; onChange: (r: AutoRule[]) => void; workOrders: WorkOrder[]; onOpenJob: (id: string) => void; saveError?: string | null;
}) {
  const [open, setOpen] = useState(false);
  // Folded by default so the job board comes first (Fred, 2026-11-01: "taking up too much space").
  const [shown, setShown] = useState(false);
  const today = todayISO();
  const noTech = noTechSoon(workOrders, rules, today);
  const invoice = waitingInvoice(workOrders, rules, today);
  const on = rules.filter((r) => r.on).length;
  const set = (id: AutoRule['id'], p: Partial<AutoRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const line = (w: WorkOrder, why: string) => (
    <li key={`${why}-${w.id}`}>
      <button type="button" className="wf-sheet-link" onClick={() => onOpenJob(w.id)}>WO {w.wo_number}</button> {w.title || ''} <span className="wf-subtle">· {why}</span>
    </li>
  );
  return (
    <section className="wf-card" style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={() => setShown((v) => !v)} aria-expanded={shown}
          style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <Bell size={16} color="var(--wf-gold)" />
          <b>Alerts</b>
          {noTech.length + invoice.length > 0 && <span className="wf-chip" style={{ fontSize: 12 }}>{noTech.length + invoice.length}</span>}
          <span className="wf-subtle" style={{ fontSize: 12.5 }}>
            {[noTech.length && `${noTech.length} need a tech`, invoice.length && `${invoice.length} ready to invoice`].filter(Boolean).join(' · ') || 'Nothing needs you'}
          </span>
          {noTech.length + invoice.length > 0 && (shown ? <ChevronUp size={16} /> : <ChevronDown size={16} />)}
        </button>
        <span className="wf-subtle" style={{ fontSize: 12 }}>{on} of {rules.length} rules on</span>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setOpen(true)}>Rules</button>
      </div>
      {!shown ? null : noTech.length + invoice.length > 0 ? (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13.5, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
          {noTech.map((w) => line(w, `starts ${new Date(`${w.start_date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} with no tech`))}
          {invoice.map((w) => line(w, 'work done, ready to invoice'))}
        </ul>
      ) : <div className="wf-subtle" style={{ fontSize: 13, marginTop: 6 }}>Nothing needs you from the rules right now.</div>}
      {saveError && <div style={{ color: 'var(--wf-danger)', fontSize: 12.5, marginTop: 6 }}>{saveError}</div>}
      {open && (
        <Dialog title="Automations" onClose={() => setOpen(false)}
          footer={<button type="button" className="wf-btn wf-btn-gold" onClick={() => setOpen(false)}>Done</button>}>
          <p className="wf-subtle" style={{ marginTop: 0, fontSize: 13 }}>These run while the office app is open on any of your devices.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {AUTO_RULES.map((d) => {
              const r = rules.find((x) => x.id === d.id)!;
              return (
                <label key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
                  <input type="checkbox" checked={r.on} onChange={(e) => set(d.id, { on: e.target.checked })} style={{ marginTop: 3 }} />
                  <span style={{ flex: 1 }}>
                    <b style={{ fontWeight: 600 }}>{d.when}</b>{d.days !== null && (
                      <> <input type="number" min={0} max={60} value={r.days} aria-label={`Days for: ${d.when}`} className="wf-sheet-input" style={{ width: 60 }}
                        onChange={(e) => set(d.id, { days: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} /> day{r.days === 1 ? '' : 's'}</>
                    )}
                    <span className="wf-subtle" style={{ display: 'block' }}>then {d.then}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </Dialog>
      )}
    </section>
  );
}
