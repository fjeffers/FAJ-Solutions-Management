'use client';
import { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, AlertTriangle, Package } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import type { Material } from '@/lib/types';

type Severity = 'out' | 'critical' | 'low' | 'ok';

function severityOf(m: Material): Severity {
  if (m.stock_quantity <= 0) return 'out';
  if (m.low_stock_threshold != null) {
    if (m.stock_quantity <= m.low_stock_threshold * 0.5) return 'critical';
    if (m.stock_quantity <= m.low_stock_threshold) return 'low';
  }
  return 'ok';
}

const SEVERITY_META: Record<Severity, { label: string; color: string; bg: string }> = {
  out:      { label: 'Out of Stock', color: '#b91c1c', bg: 'rgba(239,68,68,0.12)' },
  critical: { label: 'Critical',     color: '#b91c1c', bg: 'rgba(239,68,68,0.08)' },
  low:      { label: 'Low Stock',    color: '#b45309', bg: 'rgba(245,158,11,0.12)' },
  ok:       { label: 'In Stock',     color: '#047857', bg: 'rgba(16,185,129,0.1)' },
};

export default function MaterialsView({
  materials,
  onSave,
  onDelete,
}: {
  materials: Material[];
  onSave: (m: Partial<Material>) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<Partial<Material> | null>(null);
  const [filter, setFilter] = useState<'all' | 'low'>('all');

  const rows = useMemo(() => {
    const withSeverity = materials.map((m) => ({ m, severity: severityOf(m) }));
    const filtered = filter === 'low' ? withSeverity.filter((r) => r.severity !== 'ok') : withSeverity;
    return filtered.sort((a, b) => a.m.name.localeCompare(b.m.name));
  }, [materials, filter]);

  const lowCount = materials.filter((m) => severityOf(m) !== 'ok').length;

  return (
    <div className="view-inner" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>INVENTORY</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Materials</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
            {materials.length} item{materials.length !== 1 ? 's' : ''}
            {lowCount > 0 && <span style={{ color: '#b45309', fontWeight: 600 }}> · {lowCount} need attention</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
          <button className={`filter-chip ${filter === 'low' ? 'active' : ''}`} onClick={() => setFilter('low')}>Needs Attention</button>
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={14} /> Add Material
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          <Package size={28} color="#ddd" style={{ marginBottom: 8 }} />
          <div>{filter === 'low' ? 'Nothing low on stock.' : 'No materials tracked yet.'}</div>
        </div>
      ) : (
        <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                {['Item', 'Category', 'Stock', 'Threshold', 'Unit Cost', 'Status', ''].map((h, i) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: i >= 2 && i <= 4 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, severity }) => {
                const sm = SEVERITY_META[severity];
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 700 }}>{m.name}</div>
                      {m.sku && <div style={{ fontSize: 11, color: '#aaa' }}>SKU: {m.sku}</div>}
                    </td>
                    <td style={{ padding: '12px 14px', color: '#666' }}>{m.category || '—'}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600 }}>{m.stock_quantity} {m.unit}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', color: '#999' }}>{m.low_stock_threshold ?? '—'}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', color: '#666' }}>{m.unit_cost != null ? fmtMoney(m.unit_cost) : '—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: sm.bg, color: sm.color, whiteSpace: 'nowrap' }}>
                        {severity !== 'ok' && <AlertTriangle size={10} />} {sm.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setEditing(m)} style={ICON_BTN}><Edit2 size={13} /></button>
                      <button onClick={() => { if (confirm(`Delete "${m.name}"?`)) onDelete(m.id); }} style={{ ...ICON_BTN, color: '#b91c1c' }}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <MaterialModal
          item={editing}
          onSave={async (m) => { await onSave(m); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const ICON_BTN: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#888', marginLeft: 2,
};

function MaterialModal({
  item, onSave, onClose,
}: {
  item: Partial<Material>;
  onSave: (m: Partial<Material>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Material>>({
    name: '', description: '', category: '', unit: 'each', stock_quantity: 0,
    low_stock_threshold: 5, unit_cost: 0, supplier: '', sku: '', location: '', notes: '',
    ...item,
  });
  const set = <K extends keyof Material>(k: K, v: Material[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div className="glass card" style={{ width: 480, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item.id ? 'Edit Material' : 'Add Material'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Name"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Category"><input className="input" value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. electrical, plumbing" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Stock Quantity"><input className="input" type="number" value={form.stock_quantity ?? 0} onChange={(e) => set('stock_quantity', Number(e.target.value))} /></Field>
            <Field label="Unit"><input className="input" value={form.unit ?? ''} onChange={(e) => set('unit', e.target.value)} placeholder="each, ft, box..." /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Low Stock Threshold"><input className="input" type="number" value={form.low_stock_threshold ?? ''} onChange={(e) => set('low_stock_threshold', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            <Field label="Unit Cost"><input className="input" type="number" step="0.01" value={form.unit_cost ?? 0} onChange={(e) => set('unit_cost', Number(e.target.value))} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="SKU"><input className="input" value={form.sku ?? ''} onChange={(e) => set('sku', e.target.value)} /></Field>
            <Field label="Supplier"><input className="input" value={form.supplier ?? ''} onChange={(e) => set('supplier', e.target.value)} /></Field>
          </div>
          <Field label="Location"><input className="input" value={form.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="Warehouse shelf, truck, etc." /></Field>
          <Field label="Notes"><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.name}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
