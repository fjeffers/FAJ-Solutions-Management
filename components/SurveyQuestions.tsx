'use client';
import { useState } from 'react';
import { Plus, X, HelpCircle, ListPlus } from 'lucide-react';
import type { CustomQAItem, QuestionFieldType, QuestionTemplate, SurveyType } from '@/lib/types';

/**
 * Your own questions on a survey, and their answers.
 *
 * Every job asks something the fixed form does not — "is the ceiling accessible
 * above the drop tile?", "are we reusing the existing NVR?" — and those were
 * previously buried in the Notes box as prose, where nothing downstream could
 * read them.
 *
 * The shape is the same CustomQAItem work orders already use, so a question set
 * built in Settings can be answered here, and an answer recorded here reads the
 * same way anywhere else in the app.
 */
const TYPE_LABEL: Record<QuestionFieldType, string> = {
  text: 'Short answer', textarea: 'Long answer', number: 'Number',
  yes_no: 'Yes / No', photo: 'Photo', document: 'Document', signature: 'Signature',
};

// Only the types that make sense typed into a survey. Photo/document/signature
// are portal capture types and have their own homes on other pages.
const ASKABLE: QuestionFieldType[] = ['text', 'textarea', 'number', 'yes_no'];

/**
 * One-tap starters per survey type. A blank "add a question" box is a box
 * nobody fills in; these are the questions that actually get asked on the walk
 * and they seed the list in a single tap.
 */
const STARTERS: Record<SurveyType, { label: string; type: QuestionFieldType }[]> = {
  camera: [
    { label: 'Where is each camera being installed — hallway, lobby, entrance?', type: 'textarea' },
    { label: 'Estimated total cable needed?', type: 'text' },
    { label: 'What equipment and materials are needed to complete the site?', type: 'textarea' },
    { label: 'Is there an existing NVR or DVR we are reusing?', type: 'yes_no' },
    { label: 'Is the ceiling accessible above the tile for cable runs?', type: 'yes_no' },
    { label: 'Who signs off on the work when it is finished?', type: 'text' },
  ],
  cabling: [
    { label: 'Where does each drop terminate on the patch panel?', type: 'textarea' },
    { label: 'Estimated total cable needed?', type: 'text' },
    { label: 'What equipment and materials are needed to complete the site?', type: 'textarea' },
    { label: 'Are existing pathways and conduit reusable?', type: 'yes_no' },
    { label: 'Is certification testing required on completion?', type: 'yes_no' },
  ],
  network: [
    { label: 'What equipment and materials are needed to complete the site?', type: 'textarea' },
    { label: 'How many rack units are free in the closet?', type: 'text' },
    { label: 'Is there adequate power and UPS at the rack?', type: 'yes_no' },
    { label: 'Who is the ISP and where is the handoff?', type: 'text' },
  ],
  wireless: [
    { label: 'Which areas need coverage?', type: 'textarea' },
    { label: 'What equipment and materials are needed to complete the site?', type: 'textarea' },
    { label: 'Where can the AP or dish be mounted?', type: 'text' },
    { label: 'Is there line of sight for the backhaul?', type: 'yes_no' },
  ],
  general: [
    { label: 'What equipment and materials are needed to complete the site?', type: 'textarea' },
    { label: 'Who signs off on the work when it is finished?', type: 'text' },
  ],
};

export default function SurveyQuestions({
  items, templates, surveyType, onChange,
}: {
  items: CustomQAItem[];
  templates: QuestionTemplate[];
  surveyType: SurveyType;
  onChange: (next: CustomQAItem[]) => void;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<QuestionFieldType>('text');

  const add = () => {
    const q = label.trim();
    if (!q) return;
    onChange([...items, {
      id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: q, type, answer: null,
    }]);
    setLabel('');
    setType('text');
  };

  const answer = (id: string, value: string) =>
    onChange(items.map((i) => (i.id === id ? { ...i, answer: value } : i)));

  /** Append a saved set, skipping questions already on this survey. */
  const applyTemplate = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    const existing = new Set(items.map((i) => i.label.trim().toLowerCase()));
    const added = (t.questions ?? [])
      .filter((q) => !existing.has(q.label.trim().toLowerCase()))
      .map((q, n) => ({
        id: `qa-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 5)}`,
        label: q.label, type: q.type, answer: null as string | null,
      }));
    if (added.length > 0) onChange([...items, ...added]);
  };

  const unanswered = items.filter((i) => !(i.answer ?? '').trim()).length;

  const asked = new Set(items.map((i) => i.label.trim().toLowerCase()));
  const starters = (STARTERS[surveyType] ?? STARTERS.general)
    .filter((q) => !asked.has(q.label.trim().toLowerCase()));

  const addStarter = (q: { label: string; type: QuestionFieldType }) =>
    onChange([...items, {
      id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: q.label, type: q.type, answer: null,
    }]);

  return (
    <div>
      {items.length > 0 && (
        <div style={{
          fontSize: 12, color: unanswered > 0 ? '#b45309' : '#047857',
          fontWeight: 600, marginBottom: 10,
        }}>
          {items.length} question{items.length !== 1 ? 's' : ''}
          {unanswered > 0 ? ` · ${unanswered} still unanswered` : ' · all answered'}
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ padding: '18px 14px', textAlign: 'center', color: '#aaa', fontSize: 13, border: '1px dashed #ddd', borderRadius: 10, marginBottom: 10 }}>
          <HelpCircle size={20} color="#ddd" style={{ marginBottom: 5 }} />
          <div>No extra questions on this job yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 10 }}>
          {items.map((q) => (
            <div key={q.id} style={{ border: '1px solid #e8e8e8', borderRadius: 10, padding: 10, background: 'white' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{q.label}</div>
                <button
                  onClick={() => onChange(items.filter((i) => i.id !== q.id))}
                  title="Remove question"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 3, flexShrink: 0 }}
                ><X size={14} /></button>
              </div>

              {q.type === 'yes_no' ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  {['Yes', 'No', 'N/A'].map((opt) => (
                    <button
                      key={opt} onClick={() => answer(q.id, opt)}
                      style={{
                        padding: '7px 16px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                        border: q.answer === opt ? '1px solid var(--teal)' : '1px solid #e2e2e2',
                        background: q.answer === opt ? 'var(--teal)' : 'white',
                        color: q.answer === opt ? 'white' : '#666',
                      }}
                    >{opt}</button>
                  ))}
                </div>
              ) : q.type === 'textarea' ? (
                <textarea
                  className="input" rows={2} value={q.answer ?? ''}
                  onChange={(e) => answer(q.id, e.target.value)} placeholder="Answer…"
                />
              ) : (
                <input
                  className="input" value={q.answer ?? ''}
                  type={q.type === 'number' ? 'number' : 'text'}
                  inputMode={q.type === 'number' ? 'decimal' : undefined}
                  onChange={(e) => answer(q.id, e.target.value)} placeholder="Answer…"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* One-tap starters — the questions that actually get asked on this kind
          of walk, so the box is never blank. */}
      {starters.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: '#999', textTransform: 'uppercase', marginBottom: 6 }}>
            Common questions — tap to add
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {starters.map((q) => (
              <button
                key={q.label} onClick={() => addStarter(q)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, textAlign: 'left',
                  padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
                  border: '1px dashed #cfcabb', background: 'white',
                  fontSize: 11.5, color: '#555', lineHeight: 1.3,
                }}
              >
                <Plus size={11} color="var(--teal)" /> {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ask something new */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input" placeholder="Ask a question — e.g. Is the ceiling accessible above the tile?"
          value={label} onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          style={{ flex: '1 1 240px' }}
        />
        <select
          className="select input" value={type}
          onChange={(e) => setType(e.target.value as QuestionFieldType)}
          style={{ width: 132, flexShrink: 0 }}
        >
          {ASKABLE.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <button className="btn btn-ghost" onClick={add} disabled={!label.trim()} style={{ flexShrink: 0 }}>
          <Plus size={13} /> Add
        </button>
      </div>

      {templates.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9, fontSize: 12, color: '#888' }}>
          <ListPlus size={13} />
          <span>Or load a saved set:</span>
          <select
            className="select input" value=""
            onChange={(e) => { if (e.target.value) { applyTemplate(e.target.value); e.target.value = ''; } }}
            style={{ width: 210, fontSize: 12 }}
          >
            <option value="">Choose…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
