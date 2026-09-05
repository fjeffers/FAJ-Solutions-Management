'use client';
import { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, AlertTriangle, Package, Layers } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import { kitCost, newKitItem } from '@/lib/material-kits';
import type { Material, MaterialKit, MaterialKitItem } from '@/lib/types';

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
  kits,
  onSave,
  onDelete,
  onSaveKit,
  onDeleteKit,
}: {
  materials: Material[];
  kits: MaterialKit[];
  onSave: (m: Partial<Material>) => Promise<void>;
  onDelete: (id: string) => void;
  onSaveKit: (k: Partial<MaterialKit>) => Promise<void>;
  onDeleteKit: (id: string) => void;
}) {
  const [editing, setEditing] = useState<Partial<Material> | null>(null);
  const [editingKit, setEditingKit] = useState<Partial<MaterialKit> | null>(null);
  const [section, setSection] = useState<'inventory' | 'kits'>('inventory');
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
            {kits.length > 0 && <span> · {kits.length} kit{kits.length !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {section === 'inventory' ? (
            <>
              <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
              <button className={`filter-chip ${filter === 'low' ? 'active' : ''}`} onClick={() => setFilter('low')}>Needs Attention</button>
              <button className="btn btn-primary" onClick={() => setEditing({})}>
                <Plus size={14} /> Add Material
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setEditingKit({ items: [] })}>
              <Plus size={14} /> New Kit
            </button>
          )}
        </div>
      </div>

      {/* Two things live here: what's on the shelf, and the saved recipes that
          pull from it. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button className={`filter-chip ${section === 'inventory' ? 'active' : ''}`} onClick={() => setSection('inventory')}>
          <Package size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Inventory
        </button>
        <button className={`filter-chip ${section === 'kits' ? 'active' : ''}`} onClick={() => setSection('kits')}>
          <Layers size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Kits
        </button>
      </div>

      {section === 'inventory' && (rows.length === 0 ? (
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
      ))}

      {section === 'kits' && (
        <KitList
          kits={kits}
          onEdit={(k) => setEditingKit(k)}
          onDelete={onDeleteKit}
        />
      )}

      {editingKit && (
        <KitModal
          item={editingKit}
          materials={materials}
          onSave={async (k) => { await onSaveKit(k); setEditingKit(null); }}
          onClose={() => setEditingKit(null)}
        />
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

// ─── Kits ───────────────────────────────────────────────────────────────────
//
// A kit is the parts list for a job you do over and over — "camera drop",
// "AP install". Saved once here, then added whole to a job's closeout or to a
// quote, instead of typed out again every time.

function KitList({
  kits, onEdit, onDelete,
}: {
  kits: MaterialKit[];
  onEdit: (k: MaterialKit) => void;
  onDelete: (id: string) => void;
}) {
  if (kits.length === 0) {
    return (
      <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
        <Layers size={28} color="#ddd" style={{ marginBottom: 8 }} />
        <div style={{ marginBottom: 4, color: '#666', fontWeight: 600 }}>No kits saved yet.</div>
        <div style={{ fontSize: 13, maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>
          Save the parts list for a job you do often — then add the whole list to a work order&apos;s
          Closeout tab, or price it into a quote, in one pick.
        </div>
      </div>
    );
  }

  const sorted = [...kits].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
      {sorted.map((k) => {
        const items = k.items ?? [];
        return (
          <div key={k.id} className="glass card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{k.name}</div>
                {k.description && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{k.description}</div>}
              </div>
              <div style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                <button onClick={() => onEdit(k)} style={ICON_BTN}><Edit2 size={13} /></button>
                <button onClick={() => { if (confirm(`Delete the "${k.name}" kit? Jobs that already used it keep their materials.`)) onDelete(k.id); }} style={{ ...ICON_BTN, color: '#b91c1c' }}><Trash2 size={13} /></button>
              </div>
            </div>

            {items.length === 0 ? (
              <div style={{ fontSize: 12, color: '#aaa' }}>Nothing in this kit yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {items.map((i) => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: '#444' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong style={{ color: '#111' }}>{i.quantity}&times;</strong> {i.name || 'Unnamed item'}
                      {!i.material_id && <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', marginLeft: 6 }}>BUY</span>}
                    </span>
                    <span style={{ color: '#888', flexShrink: 0 }}>{fmtMoney((i.quantity || 0) * (i.unit_cost || 0))}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f0f0f0', paddingTop: 8, marginTop: 'auto' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                {items.length} line{items.length !== 1 ? 's' : ''} &middot; at cost
              </span>
              <span style={{ fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(kitCost(items))}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KitModal({
  item, materials, onSave, onClose,
}: {
  item: Partial<MaterialKit>;
  materials: Material[];
  onSave: (k: Partial<MaterialKit>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<MaterialKit>>({ name: '', description: '', items: [], ...item });
  const items = form.items ?? [];
  const setItems = (next: MaterialKitItem[]) => setForm((f) => ({ ...f, items: next }));

  const addItem = (materialId: string | null) => {
    const mat = materialId ? materials.find((m) => m.id === materialId) ?? null : null;
    setItems([...items, newKitItem(mat)]);
  };
  const updateItem = (id: string, patch: Partial<MaterialKitItem>) =>
    setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const removeItem = (id: string) => setItems(items.filter((i) => i.id !== id));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={onClose}>
      <div className="glass card" style={{ width: 600, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item.id ? 'Edit Kit' : 'New Kit'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5, marginBottom: 16 }}>
          The parts list for a job you do over and over. Saving a kit changes nothing on its own —
          stock only moves when a work order that used it is saved.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Kit Name"><input className="input" value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Standard camera drop" /></Field>
          <Field label="Description"><input className="input" value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="When you would use this kit" /></Field>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>What is in it</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ position: 'relative', flex: '1 1 220px' }}>
                <select
                  className="select input"
                  value=""
                  onChange={(e) => { if (e.target.value) addItem(e.target.value); }}
                  style={{ fontSize: 12 }}
                >
                  <option value="">+ Add from inventory&hellip;</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.unit_cost ? ` · ${fmtMoney(m.unit_cost)}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => addItem(null)}>
                <Plus size={13} /> Item you buy for the job
              </button>
            </div>

            {items.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#aaa', fontSize: 13, border: '1.5px dashed #e5e7eb', borderRadius: 10 }}>
                Nothing in this kit yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((i) => (
                  <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: i.material_id ? 'rgba(13,115,119,0.04)' : 'rgba(245,158,11,0.05)', border: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
                      background: i.material_id ? 'rgba(13,115,119,0.12)' : 'rgba(245,158,11,0.15)',
                      color: i.material_id ? 'var(--teal)' : '#92400e',
                    }}>
                      {i.material_id ? 'STOCK' : 'BUY'}
                    </span>
                    <input
                      className="input"
                      value={i.name}
                      readOnly={!!i.material_id}
                      placeholder="Item name"
                      onChange={(e) => updateItem(i.id, { name: e.target.value })}
                      style={{ flex: '2 1 160px', fontSize: 13, padding: '7px 10px', background: i.material_id ? 'transparent' : undefined, border: i.material_id ? 'none' : undefined, fontWeight: 600 }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
                      Qty
                      <input className="input" type="number" min="0" step="1" value={i.quantity || ''}
                        onChange={(e) => updateItem(i.id, { quantity: Number(e.target.value) })}
                        style={{ width: 64, fontSize: 12, padding: '6px 8px', textAlign: 'right' }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
                      $ each
                      <input className="input" type="number" min="0" step="0.01" value={i.unit_cost ?? ''} placeholder="0.00"
                        onChange={(e) => updateItem(i.id, { unit_cost: e.target.value === '' ? null : Number(e.target.value) })}
                        style={{ width: 80, fontSize: 12, padding: '6px 8px', textAlign: 'right' }} />
                    </label>
                    <button type="button" onClick={() => removeItem(i.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4, flexShrink: 0 }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', padding: '4px 10px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>Kit cost</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(kitCost(items))}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.name?.trim()}>Save Kit</button>
        </div>
      </div>
    </div>
  );
}

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
