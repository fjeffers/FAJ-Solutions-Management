'use client';
import { useState } from 'react';
import { X, Hash, User, FileText, Calendar, DollarSign, ChevronDown } from 'lucide-react';
import type { WorkOrder, Contractor } from '@/lib/types';

type Props = { item: WorkOrder | null; contractors: Contractor[]; onSave: (w: Partial<WorkOrder>) => void; onClose: () => void; };

export default function WorkOrderModal({ item, contractors, onSave, onClose }: Props) {
  const [form, setForm] = useState<Partial<WorkOrder>>(item ?? { wo_number: '', contractor_name: '', description: '', start_date: '', end_date: '', total_amount: 0 });
  const canSave = !!(form.wo_number && form.contractor_name && form.total_amount && Number(form.total_amount) > 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>{item ? 'EDIT' : 'NEW'} WORK ORDER</div>
            <h2 className="serif" style={{ fontSize: 26, margin: 0, fontWeight: 600 }}>{item ? `WO #${item.wo_number}` : 'Add Work Order'}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <PF label="WO Number *" icon={<Hash size={14} />}><input className="input" value={form.wo_number ?? ''} onChange={(e) => setForm((f) => ({ ...f, wo_number: e.target.value }))} placeholder="e.g. 1001" autoFocus /></PF>
            <PF label="Contractor *" icon={<User size={14} />}>
              <div style={{ position: 'relative' }}>
                <select className="select input" value={form.contractor_name ?? ''} onChange={(e) => setForm((f) => ({ ...f, contractor_name: e.target.value }))}>
                  <option value="">Select contractor</option>
                  {contractors.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
              </div>
            </PF>
          </div>
          <PF label="Description" icon={<FileText size={14} />}><input className="input" value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Brief description of work" /></PF>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <PF label="Start Date" icon={<Calendar size={14} />}><input className="input" type="date" value={form.start_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} /></PF>
            <PF label="End Date" icon={<Calendar size={14} />}><input className="input" type="date" value={form.end_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} /></PF>
          </div>
          <PF label="Total Amount *" icon={<DollarSign size={14} />}><input className="input" type="number" step="0.01" min="0" value={form.total_amount ?? ''} onChange={(e) => setForm((f) => ({ ...f, total_amount: Number(e.target.value) }))} placeholder="0.00" /></PF>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => canSave && onSave(form)} disabled={!canSave} style={{ flex: 2, justifyContent: 'center' }}>{item ? 'Save Changes' : 'Add Work Order'}</button>
        </div>
      </div>
    </div>
  );
}

function PF({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>{icon} {label}</label>
      {children}
    </div>
  );
}
