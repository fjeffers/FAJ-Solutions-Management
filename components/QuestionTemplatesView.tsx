'use client';
import { useState, useRef } from 'react';
import { Plus, Edit2, Trash2, X, GripVertical, ChevronDown, Paperclip, Upload } from 'lucide-react';
import type { QuestionTemplate, QuestionField, QuestionFieldType } from '@/lib/types';

const FIELD_TYPES: { value: QuestionFieldType; label: string }[] = [
  { value: 'text',     label: 'Short Text' },
  { value: 'textarea', label: 'Long Text'  },
  { value: 'number',   label: 'Number'     },
  { value: 'yes_no',   label: 'Yes / No'   },
];

function newField(): QuestionField {
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: '',
    type: 'text',
    placeholder: '',
    required: false,
  };
}

function fileName(url: string): string {
  try {
    const parts = decodeURIComponent(url).split('/');
    const raw = parts[parts.length - 1];
    return raw.replace(/^\d+-/, ''); // strip leading timestamp prefix
  } catch {
    return 'attachment';
  }
}

// ─── Template Edit Modal ──────────────────────────────────────────────────────

function TemplateModal({
  template,
  onSave,
  onClose,
  onUploadAttachment,
}: {
  template: Partial<QuestionTemplate> | null;
  onSave: (t: { name: string; questions: QuestionField[]; attachment_url: string | null }) => void;
  onClose: () => void;
  onUploadAttachment: (file: File) => Promise<string | null>;
}) {
  const [name, setName]           = useState(template?.name ?? '');
  const [questions, setQuestions] = useState<QuestionField[]>(
    template?.questions?.length ? template.questions : [newField()]
  );
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(template?.attachment_url ?? null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef              = useRef<HTMLInputElement>(null);

  const addQuestion = () => setQuestions((q) => [...q, newField()]);

  const updateQuestion = (id: string, patch: Partial<QuestionField>) =>
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  const removeQuestion = (id: string) =>
    setQuestions((qs) => qs.filter((q) => q.id !== id));

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await onUploadAttachment(file);
    if (url) setAttachmentUrl(url);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const canSave = name.trim() && questions.some((q) => q.label.trim());

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div className="display" style={{ fontSize: 10, color: 'var(--teal)', letterSpacing: 2, marginBottom: 4 }}>
              {template?.id ? 'EDIT' : 'NEW'} TEMPLATE
            </div>
            <h2 className="serif" style={{ fontSize: 24, margin: 0, fontWeight: 600 }}>Question Template</h2>
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
            placeholder="e.g. AT&T Jobs, Spectrum Installs, Standard Inspection"
            autoFocus
          />
        </div>

        {/* Vendor attachment */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Vendor Paperwork (optional)
          </label>
          {attachmentUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(13,115,119,0.06)', border: '1.5px solid rgba(13,115,119,0.15)' }}>
              <Paperclip size={14} color="var(--teal)" />
              <a
                href={attachmentUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, fontSize: 13, color: 'var(--teal)', fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {fileName(attachmentUrl)}
              </a>
              <button onClick={() => setAttachmentUrl(null)} style={{ padding: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#aaa' }}>
                <X size={13} />
              </button>
            </div>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  width: '100%', padding: '12px', border: '2px dashed #e5e7eb',
                  borderRadius: 10, background: uploading ? '#fafafa' : 'white',
                  cursor: uploading ? 'wait' : 'pointer',
                  fontSize: 13, color: '#888',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <Upload size={14} />
                {uploading ? 'Uploading...' : 'Upload PDF, Word doc, or image'}
              </button>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                Contractors will see a download link in their portal when this template is applied to a work order.
              </div>
            </>
          )}
        </div>

        {/* Questions */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Questions ({questions.length})
            </label>
            <button onClick={addQuestion} className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}>
              <Plus size={12} /> Add Question
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {questions.map((q, i) => (
              <div key={q.id} style={{ padding: '14px 16px', borderRadius: 10, background: '#fafafa', border: '1.5px solid #e5e7eb' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', paddingTop: 10, color: '#ccc', flexShrink: 0 }}>
                    <GripVertical size={14} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, marginBottom: 8 }}>
                      <input
                        className="input"
                        value={q.label}
                        onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                        placeholder={`Question ${i + 1} label (e.g. POC Name)`}
                        style={{ fontSize: 13 }}
                      />
                      <div style={{ position: 'relative' }}>
                        <select
                          className="select input"
                          value={q.type}
                          onChange={(e) => updateQuestion(q.id, { type: e.target.value as QuestionFieldType })}
                          style={{ fontSize: 12 }}
                        >
                          {FIELD_TYPES.map((ft) => (
                            <option key={ft.value} value={ft.value}>{ft.label}</option>
                          ))}
                        </select>
                        <ChevronDown size={11} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#aaa' }} />
                      </div>
                    </div>
                    <input
                      className="input"
                      value={q.placeholder ?? ''}
                      onChange={(e) => updateQuestion(q.id, { placeholder: e.target.value })}
                      placeholder="Placeholder / hint text (optional)"
                      style={{ fontSize: 12 }}
                    />
                  </div>
                  <button
                    onClick={() => removeQuestion(q.id)}
                    style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer', color: '#ccc', flexShrink: 0, marginTop: 4 }}
                  >
                    <X size={14} />
                  </button>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888', cursor: 'pointer', marginLeft: 24 }}>
                  <input
                    type="checkbox"
                    checked={q.required ?? false}
                    onChange={(e) => updateQuestion(q.id, { required: e.target.checked })}
                  />
                  Required
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 20, borderTop: '1px solid #eee' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({
              name: name.trim(),
              questions: questions.filter((q) => q.label.trim()),
              attachment_url: attachmentUrl,
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

export default function QuestionTemplatesView({
  templates,
  onSave,
  onDelete,
  onUploadAttachment,
}: {
  templates: QuestionTemplate[];
  onSave: (id: string | null, data: { name: string; questions: QuestionField[]; attachment_url: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUploadAttachment: (file: File) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState<Partial<QuestionTemplate> | null | false>(false);

  const handleSave = async (data: { name: string; questions: QuestionField[]; attachment_url: string | null }) => {
    const id = editing && 'id' in editing ? editing.id ?? null : null;
    await onSave(id ?? null, data);
    setEditing(false);
  };

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>SETTINGS</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Question Templates</h1>
            <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
              Create reusable question sets for different 