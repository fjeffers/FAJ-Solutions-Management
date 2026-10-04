'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Lock, CheckCircle2, ClipboardList, CheckSquare, ListChecks } from 'lucide-react';
import CloseoutListsEditor from './CloseoutListsEditor';
import QuestionTemplatesView from './QuestionTemplatesView';
import DeliverableTemplatesView from './DeliverableTemplatesView';
import type { QuestionTemplate, DeliverableTemplate } from '@/lib/types';

interface Props {
  templates: QuestionTemplate[];
  onSave: (
    id: string | null,
    data: { name: string; questions: QuestionTemplate['questions']; attachment_url: string | null },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUploadAttachment: (file: File) => Promise<string | null>;
  deliverableTemplates: DeliverableTemplate[];
  onSaveDeliverable: (id: string | null, data: { name: string; items: string[] }) => Promise<void>;
  onDeleteDeliverable: (id: string) => Promise<void>;
}

export default function SettingsView({ templates, onSave, onDelete, onUploadAttachment, deliverableTemplates, onSaveDeliverable, onDeleteDeliverable }: Props) {
  const supabase = createClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSuccess(true);
    setPassword('');
    setConfirm('');
  };

  return (
    <div className="view-inner" style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>SETTINGS</div>
        <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Settings</h1>
        <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Manage your account and configuration</p>
      </div>

      {/* ── Change Password ── */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: 28, marginBottom: 28, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(14,27,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Lock size={16} color="var(--teal)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>Change Password</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Update your admin account password</div>
          </div>
        </div>

        <div style={{ height: 1, background: '#f0f0f0', margin: '18px 0' }} />

        <form onSubmit={handleUpdate} style={{ maxWidth: 380 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
              New Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setSuccess(false); }}
              required
              minLength={8}
              placeholder="Min 8 characters"
              autoComplete="new-password"
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
              Confirm Password
            </label>
            <input
              type="password"
              className="input"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setSuccess(false); }}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', color: '#b91c1c', borderRadius: 8, fontSize: 13, marginBottom: 14, border: '1px solid rgba(239,68,68,0.15)' }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(4,120,87,0.08)', color: '#047857', borderRadius: 8, fontSize: 13, marginBottom: 14, fontWeight: 600, border: '1px solid rgba(4,120,87,0.15)' }}>
              <CheckCircle2 size={15} /> Password updated successfully!
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password || !confirm}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px' }}
          >
            <Lock size={14} />
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* ── Question Templates ── */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 28 }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(14,27,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ClipboardList size={16} color="var(--teal)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>Question Templates</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Reusable Q&A sets for work orders</div>
          </div>
        </div>
        <div style={{ padding: '0' }}>
          <QuestionTemplatesView
            templates={templates}
            onSave={onSave}
            onDelete={onDelete}
            onUploadAttachment={onUploadAttachment}
            embedded
          />
        </div>
      </div>

      {/* ── Deliverable Templates ── */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(14,27,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckSquare size={16} color="var(--teal)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>Deliverable Templates</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Reusable checklists applied to work order deliverables</div>
          </div>
        </div>
        <div style={{ padding: '0' }}>
          <DeliverableTemplatesView
            templates={deliverableTemplates}
            onSave={onSaveDeliverable}
            onDelete={onDeleteDeliverable}
            embedded
          />
        </div>
      </div>

      {/* ── Closeout checklists (tech portal, migration-106) ── */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginTop: 28 }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(14,27,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ListChecks size={16} color="var(--teal)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>Closeout checklists</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>What techs tick off before Work done — kiosk, survey and standard jobs</div>
          </div>
        </div>
        <CloseoutListsEditor />
      </div>
    </div>
  );
}
