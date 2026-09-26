'use client';
import { useState } from 'react';
import { Plus, Edit2, Trash2, X, GripVertical } from 'lucide-react';
import type { DeliverableTemplate } from '@/lib/types';
import { backdropClose } from '@/lib/backdrop';

// ─── Template Edit Modal ──────────────────────────────────────────────────────

function TemplateModal({
  template,
  onSave,
  onClose,
}: {
  template: Partial<DeliverableTemplate> | null;
  onSave: (data: { name: string; items: string[] }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [items, setItems] = useState<string[]>(
    template?.items?.length ? template.items : ['']
  );

  const addItem = () => setItems((prev) => [...prev, '']);

  const updateItem = (index: number, value: string) =>
    setItems((prev) => prev.map((item, i) => (i === index ? value : item)));

  const removeItem = (index: number) =>
    setItems((prev) => prev.filter((_, i) => i !== index));

  const canSave = name.trim() && items.some((item) => item.trim());

  return (
    <div className="modal-overlay" {...backdropClose(onClose)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div className="display" style={{ fontSize: 10, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>
              {template?.id ? 'EDIT' : 'NEW'} TEMPLATE
            </div>
            <h2 className="serif" style={{ fontSize: 24, margin: 0, fontWeight: 600 }}>Deliverable Template</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Template name */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Template Name *
          </label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sanctuary Wealth, AT&T Survey, Standard Closeout"
            autoFocus
          />
        </div>

        {/* Checklist items */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Checklist Items ({items.filter((i) => i.trim()).length})
            </label>
            <button onClick={addItem} className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}>
              <Plus size={12} /> Add Item
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ color: '#ccc', flexShrink: 0 }}>
                  <GripVertical size={14} />
                </div>
                <div style={{ fontSize: 12, color: '#aaa', fontWeight: 700, minWidth: 20, textAlign: 'right', flexShrink: 0 }}>
                  {i + 1}.
                </div>
                <input
                  className="input"
                  value={item}
                  onChange={(e) => updateItem(i, e.target.value)}
                  placeholder={`Checklist item ${i + 1}`}
                  style={{ flex: 1, fontSize: 13 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
                  }}
                />
                <button
                  onClick={() => removeItem(i)}
                  style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer', color: '#ccc', flexShrink: 0 }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>
            Press Enter to quickly add the next item.
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 20, borderTop: '1px solid #eee' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({
              name: name.trim(),
              items: items.filter((item) => item.trim()),
            })}
            disabled={!canSave}
            style={{ opacity: canSave ? 1 : 0.5 }}
          >
            {template?.id ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function DeliverableTemplatesView({
  templates,
  onSave,
  onDelete,
  embedded,
}: {
  templates: DeliverableTemplate[];
  onSave: (id: string | null, data: { name: string; items: string[] }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  embedded?: boolean;
}) {
  const [editing, setEditing] = useState<Partial<DeliverableTemplate> | null | false>(false);

  const handleSave = async (data: { name: string; items: string[] }) => {
    const id = editing && 'id' in editing ? editing.id ?? null : null;
    await onSave(id ?? null, data);
    setEditing(false);
  };

  return (
    <div>
      {/* Page header — hidden when embedded inside SettingsView */}
      {!embedded && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Deliverable Templates</h1>
              <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
                Create reusable deliverables checklists you can apply to any work order in one click.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <Plus size={14} /> New Template
            </button>
          </div>
        </div>
      )}

      {/* When embedded, show a compact "New Template" button row */}
      {embedded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 28px 0' }}>
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={14} /> New Template
          </button>
        </div>
      )}

      {/* Template cards */}
      {templates.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '60px 20px', color: '#aaa' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>☑️</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No deliverable templates yet</div>
          <div style={{ fontSize: 13, marginBottom: 20 }}>
            Create reusable checklists like "Sanctuary Wealth Site Survey" or "Standard Closeout" and apply them to any work order.
          </div>
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={14} /> Create First Template
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {templates.map((t) => (
            <div key={t.id} className="glass card">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{t.name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {t.items.slice(0, 5).map((item, i) => (
                      <span key={i} style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, background: 'rgba(13,115,119,0.08)', color: 'var(--teal)', fontWeight: 600 }}>
                        {item}
                      </span>
                    ))}
                    {t.items.length > 5 && (
                      <span style={{ fontSize: 11, color: '#aaa', padding: '2px 4px' }}>+{t.items.length - 5} more</span>
                    )}
                    {t.items.length === 0 && (
                      <span style={{ fontSize: 11, color: '#ccc' }}>No items yet</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ textAlign: 'center', marginRight: 8 }}>
                    <div style={{ fontSize: 11, color: '#aaa', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Items</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--teal)' }}>{t.items.length}</div>
                  </div>
                  <button className="icon-btn" onClick={() => setEditing(t)}><Edit2 size={15} /></button>
                  <button
                    className="icon-btn"
                    style={{ color: '#b91c1c' }}
                    onClick={() => { if (confirm(`Delete template "${t.name}"?`)) onDelete(t.id); }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== false && (
        <TemplateModal
          template={editing ?? null}
          onSave={handleSave}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
