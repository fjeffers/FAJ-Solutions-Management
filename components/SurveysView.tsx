'use client';
import { useMemo, useState } from 'react';
import {
  Plus, Edit2, Trash2, X, ClipboardList, FileSignature, Briefcase, ArrowRight, MapPin,
  Camera, Paperclip,
} from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import {
  newScopeItem, scopeLineTotal, surveyTotals, surveyStage, nextSurveyNumber,
} from '@/lib/surveys';
import { newFolderKey } from '@/lib/survey-upload';
import SurveyCameras from '@/components/SurveyCameras';
import SurveyDocuments from '@/components/SurveyDocuments';
import type { Survey, SurveyScopeItem, SurveyStatus } from '@/lib/types';
import { SURVEY_STATUSES } from '@/lib/types';

const STATUS_META: Record<SurveyStatus, { label: string; color: string; bg: string }> = {
  draft:     { label: 'Draft',  color: '#666',    bg: 'rgba(0,0,0,0.06)' },
  completed: { label: 'Walked', color: '#1D4ED8', bg: 'rgba(59,130,246,0.12)' },
  quoted:    { label: 'Quoted', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
  won:       { label: 'Won',    color: '#047857', bg: 'rgba(16,185,129,0.12)' },
  lost:      { label: 'Lost',   color: '#b91c1c', bg: 'rgba(239,68,68,0.12)' },
};

/** The chain, drawn on the card: Survey -> Quote -> Job. */
function Pipeline({ s }: { s: Survey }) {
  const stage = surveyStage(s);
  const step = (label: string, done: boolean, current: boolean) => (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
      color: current ? 'var(--teal)' : done ? '#047857' : '#c4c4c4',
    }}>{label}</span>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      {step('Survey', true, stage === 'survey')}
      <ArrowRight size={10} color={s.quote_id ? '#047857' : '#ddd'} />
      {step('Quote', !!s.quote_id, stage === 'quoted')}
      <ArrowRight size={10} color={s.work_order_id ? '#047857' : '#ddd'} />
      {step('Job', !!s.work_order_id, stage === 'job')}
    </div>
  );
}

export default function SurveysView({
  surveys, onSave, onDelete, onBuildQuote, onOpenQuote, onOpenWorkOrder,
}: {
  surveys: Survey[];
  onSave: (s: Partial<Survey>) => Promise<void>;
  onDelete: (id: string) => void;
  onBuildQuote: (s: Survey) => Promise<void>;
  onOpenQuote: (quoteId: string) => void;
  onOpenWorkOrder: (workOrderId: string) => void;
}) {
  const [editing, setEditing] = useState<Partial<Survey> | null>(null);

  const sorted = useMemo(
    () => [...surveys].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [surveys],
  );

  // What is still sitting on the shelf - walked but never quoted, i.e. money
  // left on the table. This is the number worth looking at every morning.
  const openValue = useMemo(
    () => surveys.filter((s) => !s.quote_id && s.status !== 'lost')
      .reduce((sum, s) => sum + surveyTotals(s).total, 0),
    [surveys],
  );

  return (
    <div className="view-inner" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>SITE SURVEYS</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Surveys</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
            {surveys.length} survey{surveys.length !== 1 ? 's' : ''}
            {openValue > 0 && <> · <strong style={{ color: 'var(--teal)' }}>{fmtMoney(openValue)}</strong> walked but not yet quoted</>}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ survey_number: nextSurveyNumber(surveys) })}>
          <Plus size={14} /> New Survey
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          <ClipboardList size={28} color="#ddd" style={{ marginBottom: 8 }} />
          <div>No surveys yet.</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>Walk a site, record what you found, then build the quote from it in one click.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sorted.map((s) => {
            const sm = STATUS_META[s.status] ?? STATUS_META.draft;
            const t = surveyTotals(s);
            const site = [s.site_city, s.site_state].filter(Boolean).join(', ');
            const scopeCount = (s.scope_items ?? []).length;
            const camCount = (s.cameras ?? []).length;
            const docCount = (s.documents ?? []).length;
            return (
              <div key={s.id} className="glass card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--teal)' }}>{s.survey_number}</span>
                    <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: sm.bg, color: sm.color }}>{sm.label}</span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{s.title || s.site_name || s.client_name || 'Untitled survey'}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {s.client_name}
                    {site && <><span>·</span><MapPin size={11} />{site}</>}
                    {s.survey_date && <><span>·</span>{fmtDate(s.survey_date)}</>}
                  </div>
                  <div style={{ marginTop: 7 }}><Pipeline s={s} /></div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(t.total)}</div>
                    <div style={{ fontSize: 10, color: '#aaa', display: 'flex', gap: 7, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {camCount > 0 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <Camera size={10} />{camCount}
                        </span>
                      )}
                      {docCount > 0 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <Paperclip size={10} />{docCount}
                        </span>
                      )}
                      <span>{scopeCount} line{scopeCount !== 1 ? 's' : ''}</span>
                      {t.labor > 0 && <span>+ {fmtMoney(t.labor)} labor</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {s.quote_id ? (
                      <button title="Open the quote this survey produced" onClick={() => onOpenQuote(s.quote_id!)} style={{ ...ICON_BTN, color: '#7c3aed' }}><FileSignature size={15} /></button>
                    ) : (
                      <button
                        title="Build Quote from this survey"
                        onClick={() => onBuildQuote(s)}
                        disabled={scopeCount === 0 && camCount === 0 && !s.labor_hours}
                        style={{ ...ICON_BTN, color: '#7c3aed' }}
                      ><FileSignature size={15} /></button>
                    )}
                    {s.work_order_id && (
                      <button title="Open the work order" onClick={() => onOpenWorkOrder(s.work_order_id!)} style={{ ...ICON_BTN, color: '#047857' }}><Briefcase size={15} /></button>
                    )}
                    <button title="Edit" onClick={() => setEditing(s)} style={ICON_BTN}><Edit2 size={15} /></button>
                    <button title="Delete" onClick={() => { if (confirm(`Delete survey ${s.survey_number}? The quote and work order it produced are kept.`)) onDelete(s.id); }} style={{ ...ICON_BTN, color: '#b91c1c' }}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <SurveyModal
          item={editing}
          onSave={async (s) => { await onSave(s); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const ICON_BTN: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#888' };

function SurveyModal({
  item, onSave, onClose,
}: {
  item: Partial<Survey>;
  onSave: (s: Partial<Survey>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Survey>>({
    survey_number: '', client_name: '', client_email: '', client_phone: '',
    poc_name: '', poc_phone: '',
    site_name: '', site_address: '', site_city: '', site_state: '', site_zip: '',
    title: '', survey_date: new Date().toISOString().slice(0, 10), surveyed_by: '',
    status: 'draft', existing_conditions: '', findings: '', recommendations: '', notes: '',
    scope_items: [newScopeItem()], labor_rate: null, labor_hours: null, tax_rate: 0, payment_terms: '',
    cameras: [], documents: [],
    head_end_notes: '', rack_space: '', switch_notes: '', access_notes: '',
    ...item,
  });
  // Generated once per open: lets photos upload before the survey is ever saved.
  const [folderKey] = useState(() => newFolderKey());
  const set = <K extends keyof Survey>(k: K, v: Survey[K]) => setForm((f) => ({ ...f, [k]: v }));

  const scopeItems = form.scope_items ?? [];
  const totals = surveyTotals({
    scope_items: scopeItems,
    labor_hours: form.labor_hours ?? null,
    labor_rate: form.labor_rate ?? null,
    tax_rate: form.tax_rate ?? 0,
  });

  const updateLine = (id: string, patch: Partial<SurveyScopeItem>) =>
    set('scope_items', scopeItems.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  const addLine = () => set('scope_items', [...scopeItems, newScopeItem()]);
  const removeLine = (id: string) => set('scope_items', scopeItems.filter((li) => li.id !== id));

  const GRID = '1fr 55px 60px 85px 80px 24px';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={onClose}>
      <div className="glass card" style={{ width: 720, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item.id ? `Edit ${form.survey_number}` : `New Survey — ${form.survey_number}`}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Title"><input className="input" placeholder="e.g. Camera system replacement" value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>

          <SectionLabel>Client</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Client Name"><input className="input" value={form.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} /></Field>
            <Field label="Client Email"><input className="input" value={form.client_email ?? ''} onChange={(e) => set('client_email', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Client Phone"><input className="input" value={form.client_phone ?? ''} onChange={(e) => set('client_phone', e.target.value)} /></Field>
            <Field label="Site Contact"><input className="input" value={form.poc_name ?? ''} onChange={(e) => set('poc_name', e.target.value)} /></Field>
            <Field label="Contact Phone"><input className="input" value={form.poc_phone ?? ''} onChange={(e) => set('poc_phone', e.target.value)} /></Field>
          </div>

          <SectionLabel>Site</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Site Name"><input className="input" value={form.site_name ?? ''} onChange={(e) => set('site_name', e.target.value)} /></Field>
            <Field label="Address"><input className="input" value={form.site_address ?? ''} onChange={(e) => set('site_address', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <Field label="City"><input className="input" value={form.site_city ?? ''} onChange={(e) => set('site_city', e.target.value)} /></Field>
            <Field label="State"><input className="input" value={form.site_state ?? ''} onChange={(e) => set('site_state', e.target.value)} /></Field>
            <Field label="ZIP"><input className="input" value={form.site_zip ?? ''} onChange={(e) => set('site_zip', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Survey Date"><input className="input" type="date" value={form.survey_date ?? ''} onChange={(e) => set('survey_date', e.target.value)} /></Field>
            <Field label="Surveyed By"><input className="input" value={form.surveyed_by ?? ''} onChange={(e) => set('surveyed_by', e.target.value)} /></Field>
          </div>

          <SectionLabel>What you found</SectionLabel>
          <Field label="Existing Conditions"><textarea className="input" rows={2} placeholder="What is on site today" value={form.existing_conditions ?? ''} onChange={(e) => set('existing_conditions', e.target.value)} /></Field>
          <Field label="Findings"><textarea className="input" rows={2} placeholder="Problems, gaps, anything that needs attention" value={form.findings ?? ''} onChange={(e) => set('findings', e.target.value)} /></Field>
          <Field label="Recommendations"><textarea className="input" rows={2} placeholder="What FAJ proposes — this becomes the quote's scope" value={form.recommendations ?? ''} onChange={(e) => set('recommendations', e.target.value)} /></Field>

          <SectionLabel>Camera schedule</SectionLabel>
          <SurveyCameras
            cameras={form.cameras ?? []}
            folderKey={folderKey}
            onChange={(cameras) => set('cameras', cameras)}
          />

          <SectionLabel>Head-end &amp; infrastructure</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Rack space available"><input className="input" placeholder="e.g. 9-12U" value={form.rack_space ?? ''} onChange={(e) => set('rack_space', e.target.value)} /></Field>
            <Field label="PoE switch"><input className="input" placeholder="Make/model, or 'sourcing'" value={form.switch_notes ?? ''} onChange={(e) => set('switch_notes', e.target.value)} /></Field>
          </div>
          <Field label="Head-end / NVR notes"><textarea className="input" rows={2} placeholder="Existing rack, patch panel, cable bundle to ceiling…" value={form.head_end_notes ?? ''} onChange={(e) => set('head_end_notes', e.target.value)} /></Field>
          <Field label="Access &amp; scheduling"><textarea className="input" rows={2} placeholder="Occupied during install? Permits? Attic/crawlspace access?" value={form.access_notes ?? ''} onChange={(e) => set('access_notes', e.target.value)} /></Field>

          <SectionLabel>Documentation</SectionLabel>
          <SurveyDocuments
            documents={form.documents ?? []}
            folderKey={folderKey}
            onChange={(documents) => set('documents', documents)}
          />

          <SectionLabel>Proposed scope and pricing</SectionLabel>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 6, fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', marginBottom: 4 }}>
              <div>Description</div><div>Qty</div><div>Unit</div><div>Rate</div><div style={{ textAlign: 'right' }}>Total</div><div />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {scopeItems.map((li) => (
                <div key={li.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 6, alignItems: 'center' }}>
                  <input className="input" placeholder="e.g. Dome camera, interior" value={li.description} onChange={(e) => updateLine(li.id, { description: e.target.value })} />
                  <input className="input" type="number" value={li.quantity} onChange={(e) => updateLine(li.id, { quantity: Number(e.target.value) })} />
                  <input className="input" placeholder="ea" value={li.unit ?? ''} onChange={(e) => updateLine(li.id, { unit: e.target.value })} />
                  <input className="input" type="number" step="0.01" value={li.rate} onChange={(e) => updateLine(li.id, { rate: Number(e.target.value) })} />
                  <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtMoney(scopeLineTotal(li))}</div>
                  <button onClick={() => removeLine(li.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c' }}><X size={14} /></button>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={addLine}><Plus size={12} /> Add Scope Line</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Labor Hours"><input className="input" type="number" step="0.25" value={form.labor_hours ?? ''} onChange={(e) => set('labor_hours', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            <Field label="Labor Rate ($/hr)"><input className="input" type="number" step="0.01" value={form.labor_rate ?? ''} onChange={(e) => set('labor_rate', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            <Field label="Tax %"><input className="input" type="number" step="0.1" value={form.tax_rate ?? 0} onChange={(e) => set('tax_rate', Number(e.target.value))} /></Field>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 13, padding: '10px 0', borderTop: '1px solid #eee' }}>
            <div>Scope: <strong>{fmtMoney(totals.scope)}</strong></div>
            {totals.labor > 0 && <div>Labor: <strong>{fmtMoney(totals.labor)}</strong></div>}
            {totals.tax > 0 && <div>Tax: <strong>{fmtMoney(totals.tax)}</strong></div>}
            <div style={{ color: 'var(--teal)' }}>Total: <strong>{fmtMoney(totals.total)}</strong></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Payment Terms"><input className="input" placeholder="e.g. 50% deposit, 50% on completion" value={form.payment_terms ?? ''} onChange={(e) => set('payment_terms', e.target.value)} /></Field>
            <Field label="Status">
              <select className="select input" value={form.status ?? 'draft'} onChange={(e) => set('status', e.target.value as SurveyStatus)}>
                {SURVEY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Internal Notes"><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.client_name && !form.site_name}>Save Survey</button>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: 'var(--teal)', textTransform: 'uppercase', marginTop: 6, paddingTop: 10, borderTop: '1px solid #eee' }}>
      {children}
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
