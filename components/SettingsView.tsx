'use client';
import ChangePasswordForm from './ChangePasswordForm';
import { Lock, ClipboardList, CheckSquare, ListChecks, PanelsTopLeft, ListOrdered, TextCursorInput, Eye, LayoutDashboard } from 'lucide-react';
import CloseoutListsEditor from './CloseoutListsEditor';
import LayoutEditor from './LayoutEditor';
import ScreenPartsEditor from './ScreenPartsEditor';
import ScreenDesigner from './ScreenDesigner';
import ListsEditor from './ListsEditor';
import CustomFieldsEditor from './CustomFieldsEditor';
import type { FieldSets } from '@/lib/custom-fields';
import type { AppLists } from '@/lib/app-lists';
import type { Layout } from '@/lib/app-layout';
import type { LayoutSaveState } from './useAppLayout';
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
  /** Fred's own menu (Menu & screens). */
  layout: Layout;
  onLayoutChange: (next: Layout) => void;
  layoutSaveState: LayoutSaveState;
  layoutSaveError: string | null;
  onLayoutRetry: () => void;
  /** Fred's lists (Lists & stages). */
  lists: AppLists;
  onListsChange: (next: AppLists) => void;
  listsSaveState: LayoutSaveState;
  listsSaveError: string | null;
  onListsRetry: () => void;
  /** Fred's own fields (Custom fields). */
  fields: FieldSets;
  onFieldsChange: (next: FieldSets) => void;
  fieldsSaveState: LayoutSaveState;
  fieldsSaveError: string | null;
  onFieldsRetry: () => void;
}

export default function SettingsView({
  templates, onSave, onDelete, onUploadAttachment, deliverableTemplates, onSaveDeliverable, onDeleteDeliverable,
  layout, onLayoutChange, layoutSaveState, layoutSaveError, onLayoutRetry,
  lists, onListsChange, listsSaveState, listsSaveError, onListsRetry,
  fields, onFieldsChange, fieldsSaveState, fieldsSaveError, onFieldsRetry,
}: Props) {
  return (
    <div className="view-inner" style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>SETTINGS</div>
        <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Settings</h1>
        <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Manage your account and configuration</p>
      </div>

      {/* ── Menu & screens (migration-107) ── Fred, 2026-10-05: "I want setting
          to be able to create or change layouts of the app, add, remove anything" */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 28 }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(14,27,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PanelsTopLeft size={16} color="var(--teal)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>Menu &amp; screens</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Name, order, hide and group every screen in the left menu and Office</div>
          </div>
        </div>
        <div className="wf">
          <LayoutEditor layout={layout} onChange={onLayoutChange} saveState={layoutSaveState} saveError={layoutSaveError} onRetry={onLayoutRetry} />
        </div>
      </div>

      {/* ── What each screen shows (saved with the menu layout) ── */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 28 }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(14,27,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Eye size={16} color="var(--teal)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>What each screen shows</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Switch parts of the Dashboard, Dispatch and the job page on or off</div>
          </div>
        </div>
        <div className="wf">
          <ScreenPartsEditor layout={layout} onChange={onLayoutChange} saveState={layoutSaveState} saveError={layoutSaveError} onRetry={onLayoutRetry} />
        </div>
      </div>

      {/* ── Screen designer (saved with the menu layout; lib/screen-design.ts) ──
          Fred, 2026-10-06: "go ahead with the screen designer" */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 28 }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(14,27,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LayoutDashboard size={16} color="var(--teal)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>Screen designer</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Arrange the Dashboard and the job page: order, width, columns, your own notes and shortcut buttons</div>
          </div>
        </div>
        <div className="wf">
          <ScreenDesigner layout={layout} onChange={onLayoutChange} saveState={layoutSaveState} saveError={layoutSaveError} onRetry={onLayoutRetry} />
        </div>
      </div>

      {/* ── Lists & stages (migration-109) ── */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 28 }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(14,27,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ListOrdered size={16} color="var(--teal)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>Lists &amp; stages</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Stage names, priorities, service types, job sources and assignment types. Checklists and templates are further down.</div>
          </div>
        </div>
        <div className="wf">
          <ListsEditor lists={lists} onChange={onListsChange} saveState={listsSaveState} saveError={listsSaveError} onRetry={onListsRetry} />
        </div>
      </div>

      {/* ── Custom fields (migration-110) ── */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 28 }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(14,27,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <TextCursorInput size={16} color="var(--teal)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>Custom fields</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Your own boxes on jobs, techs and customers — office only</div>
          </div>
        </div>
        <div className="wf">
          <CustomFieldsEditor fields={fields} onChange={onFieldsChange} saveState={fieldsSaveState} saveError={fieldsSaveError} onRetry={onFieldsRetry} />
        </div>
      </div>

      {/* ── Change Password ── */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: 28, marginBottom: 28, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(14,27,46,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Lock size={16} color="var(--teal)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>Change Password</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Type your current password, then the new one twice</div>
          </div>
        </div>

        <div style={{ height: 1, background: '#f0f0f0', margin: '18px 0' }} />

        {/* The server checks the current password and saves the new one (Fred,
            2026-10-05: "whenever I try changing the PW it doesn't take"). */}
        <div className="wf"><ChangePasswordForm /></div>
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
