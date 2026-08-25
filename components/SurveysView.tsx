'use client';
import { useMemo, useState } from 'react';
import {
  Plus, Edit2, Trash2, X, ClipboardList, FileSignature, Briefcase, ArrowRight, MapPin,
  Camera, Paperclip,
} from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { surveyTotals, surveyStage, nextSurveyNumber, readyToQuote } from '@/lib/surveys';
import SurveyWizard from '@/components/SurveyWizard';
import type { Survey, SurveyStatus } from '@/lib/types';
import { SURVEY_TYPES } from '@/lib/types';

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
  surveys, onSave, onSaveAndQuote, onDelete, onBuildQuote, onOpenQuote, onOpenWorkOrder,
}: {
  surveys: Survey[];
  onSave: (s: Partial<Survey>) => Promise<void>;
  onSaveAndQuote: (s: Partial<Survey>) => Promise<void>;
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
            const camCount = (s.cameras ?? []).length + (s.cable_drops ?? []).length;
            const docCount = (s.documents ?? []).length;
            const typeLabel = SURVEY_TYPES.find((t) => t.value === s.survey_type)?.label ?? '';
            const canQuote = readyToQuote(s);
            return (
              <div key={s.id} className="glass card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--teal)' }}>{s.survey_number}</span>
                    <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: sm.bg, color: sm.color }}>{sm.label}</span>
                    {typeLabel && (
                      <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'rgba(13,115,119,0.08)', color: 'var(--teal)' }}>{typeLabel}</span>
                    )}
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
                        title={canQuote ? 'Build Quote from this survey' : 'Survey is not complete yet — open it to see what is missing'}
                        onClick={() => onBuildQuote(s)}
                        disabled={!canQuote}
                        style={{ ...ICON_BTN, color: '#7c3aed', opacity: canQuote ? 1 : 0.35 }}
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
        <SurveyWizard
          item={editing}
          onSave={async (sv) => { await onSave(sv); setEditing(null); }}
          onSaveAndQuote={async (sv) => { await onSaveAndQuote(sv); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const ICON_BTN: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#888' };
