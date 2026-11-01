'use client';
// Automations on Home (Fred, 2026-10-31): what the rules found (jobs with no tech
// soon, jobs waiting to be invoiced), and the Rules box to switch each one on or off.
import { useState } from 'react';
import { Zap } from 'lucide-react';
import { AUTO_RULES, noTechSoon, waitingInvoice, type AutoRule } from '@/lib/automations';
import { todayISO } from '@/lib/utils';
import type { WorkOrder } from '@/lib/types';
import { Dialog } from './WfUi';

export default function AutomationsCard({ rules, onChange, workOrders, onOpenJob, saveError }: {
  rules: AutoRule[]; onChange: (r: AutoRule[]) => void; workOrders: WorkOrder[]; onOpenJob: (id: string) => void; saveError?: string | null;
}) {
  const [open, setOpen] = useState(false);
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
    <section className="wf-card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Zap size={16} color="var(--wf-gold)" />
        <b>Automations</b>
        <span className="wf-subtle" style={{ fontSize: 13 }}>{on} of {rules.length} on</span>
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}>Rules</button>
      </div>
      {noTech.length + invoice.length > 0 ? (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
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
