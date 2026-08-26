'use client';
import { useState } from 'react';
import { X, Check, ChevronLeft, ChevronRight, FileSignature, Save, ClipboardList } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import {
  newScopeItem, scopeLineTotal, surveyTotals, pageStatus, readyToQuote,
  SURVEY_PAGES, type SurveyPage,
} from '@/lib/surveys';
import { newFolderKey } from '@/lib/survey-upload';
import SurveyCameras from '@/components/SurveyCameras';
import SurveyDrops from '@/components/SurveyDrops';
import SurveyDocuments from '@/components/SurveyDocuments';
import SurveyPlacements from '@/components/SurveyPlacements';
import SurveyQuestions from '@/components/SurveyQuestions';
import type { QuestionTemplate, Survey, SurveyScopeItem, SurveyStatus, SurveyType } from '@/lib/types';
import { SURVEY_STATUSES, SURVEY_TYPES, scheduleKindFor } from '@/lib/types';

/**
 * The survey, as four pages instead of one long form.
 *
 *   1  Client & Site      who and where — the same for every job
 *   2  Survey Details     the type-specific questions, and only those
 *   3  Placements         a photo of the recommended spot for each device
 *   4  Summary            findings, labour, pricing, and the gate to a quote
 *
 * Page 2 branches on survey_type: a camera walk-through is asked about mounts
 * and covers, a cabling walk-through about jacks and terminations, and neither
 * is asked the other's questions.
 */
export default function SurveyWizard({
  item, questionTemplates, onSave, onSaveAndQuote, onClose,
}: {
  item: Partial<Survey>;
  questionTemplates: QuestionTemplate[];
  onSave: (s: Partial<Survey>) => Promise<void>;
  onSaveAndQuote: (s: Partial<Survey>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Survey>>({
    survey_number: '', survey_type: 'camera', last_page: 1,
    client_name: '', client_email: '', client_phone: '', poc_name: '', poc_phone: '',
    site_name: '', site_address: '', site_city: '', site_state: '', site_zip: '',
    title: '', survey_date: new Date().toISOString().slice(0, 10), surveyed_by: '',
    status: 'draft', existing_conditions: '', findings: '', recommendations: '', notes: '',
    scope_items: [], cameras: [], cable_drops: [], documents: [], custom_qa: [],
    head_end_notes: '', rack_space: '', switch_notes: '', access_notes: '',
    labor_rate: null, labor_hours: null, tax_rate: 0, payment_terms: '',
    ...item,
  });
  // Resume where the surveyor stopped, which matters in the field.
  const [page, setPage] = useState<SurveyPage>(((item.last_page as SurveyPage) ?? 1));
  const [saving, setSaving] = useState(false);
  // Generated once per open: lets photos upload before the survey is ever saved.
  const [folderKey] = useState(() => newFolderKey());

  const set = <K extends keyof Survey>(k: K, v: Survey[K]) => setForm((f) => ({ ...f, [k]: v }));

  const asSurvey = { ...form, last_page: page } as Survey;
  const status = pageStatus(asSurvey);
  const ready = readyToQuote(asSurvey);
  const kind = scheduleKindFor(form.survey_type ?? 'camera');
  const totals = surveyTotals(asSurvey);

  const save = async (thenQuote: boolean) => {
    setSaving(true);
    const payload = { ...form, last_page: page };
    if (thenQuote) await onSaveAndQuote(payload);
    else await onSave(payload);
    setSaving(false);
  };

  return (
    // Full screen, not a dialog floating over a page. A survey is the whole
    // task while you are standing in the building — nothing behind it matters,
    // and a translucent card over the survey list was unreadable.
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100, background: '#fdfcfa',
      display: 'flex', flexDirection: 'column',
    }}>
      <header style={{
        background: 'linear-gradient(135deg, #0D7377 0%, #0a5a5d 100%)', color: 'white',
        padding: '16px 20px', flexShrink: 0,
      }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
              <ClipboardList size={14} color="var(--gold-light)" />
              <span className="display" style={{ fontSize: 10, color: 'var(--gold-light)', fontWeight: 700, letterSpacing: 1.6 }}>
                SITE SURVEY
              </span>
            </div>
            <div className="serif" style={{ fontSize: 25, fontWeight: 600, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {form.title?.trim() || form.site_name?.trim() || form.client_name?.trim() || 'New survey'}
            </div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
              {form.survey_number} · {SURVEY_TYPES.find((t) => t.value === form.survey_type)?.label}
            </div>
          </div>
          <button
            onClick={onClose} title="Close"
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', cursor: 'pointer',
              borderRadius: 8, padding: '9px 13px', display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600, flexShrink: 0,
            }}
          ><X size={15} /> Close</button>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto' }}>
       <div style={{ maxWidth: 1000, margin: '0 auto', padding: '18px 20px 0' }}>

        {/* Step rail — every page's state visible at once, so "what's left?" is
            a glance rather than a hunt. */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8, marginBottom: 20,
        }}>
          {SURVEY_PAGES.map((p) => {
            const st = status.find((x) => x.page === p.page)!;
            const active = page === p.page;
            return (
              <button
                key={p.page} onClick={() => setPage(p.page)}
                style={{
                  textAlign: 'left', cursor: 'pointer',
                  padding: '11px 13px', borderRadius: 11,
                  border: active ? '1px solid var(--teal)' : '1px solid #e8e5dd',
                  background: active ? 'rgba(13,115,119,0.08)' : 'white',
                  boxShadow: active ? '0 2px 10px rgba(13,115,119,0.10)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{
                    width: 17, height: 17, borderRadius: '50%', flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 800,
                    background: st.done ? '#047857' : active ? 'var(--teal)' : '#ddd',
                    color: 'white',
                  }}>{st.done ? <Check size={10} /> : p.page}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: active ? 'var(--teal)' : '#444' }}>{p.title}</span>
                </div>
                <div style={{ fontSize: 10, color: st.done ? '#047857' : '#b45309', marginTop: 4, minHeight: 13, lineHeight: 1.3 }}>
                  {st.done ? 'Complete' : st.missing[0] ?? ''}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{
          background: 'white', border: '1px solid #eee9df', borderRadius: 16,
          padding: '22px 24px', marginBottom: 20,
          boxShadow: '0 4px 24px rgba(13,115,119,0.05)',
        }}>
          {/* ── Page 1 — Client & Site ─────────────────────────────────── */}
          {page === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SectionLabel>What kind of survey is this?</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                {SURVEY_TYPES.map((t) => {
                  const active = form.survey_type === t.value;
                  return (
                    <button
                      key={t.value} onClick={() => set('survey_type', t.value as SurveyType)}
                      style={{
                        textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                        border: active ? '1px solid var(--teal)' : '1px solid #e4e4e4',
                        background: active ? 'rgba(13,115,119,0.08)' : 'transparent',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13, color: active ? 'var(--teal)' : '#333' }}>{t.label}</div>
                      <div style={{ fontSize: 10, color: '#999', marginTop: 2, lineHeight: 1.4 }}>{t.blurb}</div>
                    </button>
                  );
                })}
              </div>

              <SectionLabel>Client</SectionLabel>
              <Field label="Title"><input className="input" placeholder="e.g. Camera system replacement" value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
              <Two>
                <Field label="Client Name"><input className="input" value={form.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} /></Field>
                <Field label="Client Email"><input className="input" value={form.client_email ?? ''} onChange={(e) => set('client_email', e.target.value)} /></Field>
              </Two>
              <Three>
                <Field label="Client Phone"><input className="input" value={form.client_phone ?? ''} onChange={(e) => set('client_phone', e.target.value)} /></Field>
                <Field label="Site Contact"><input className="input" value={form.poc_name ?? ''} onChange={(e) => set('poc_name', e.target.value)} /></Field>
                <Field label="Contact Phone"><input className="input" value={form.poc_phone ?? ''} onChange={(e) => set('poc_phone', e.target.value)} /></Field>
              </Three>

              <SectionLabel>Site</SectionLabel>
              <Two>
                <Field label="Site Name"><input className="input" value={form.site_name ?? ''} onChange={(e) => set('site_name', e.target.value)} /></Field>
                <Field label="Address"><input className="input" value={form.site_address ?? ''} onChange={(e) => set('site_address', e.target.value)} /></Field>
              </Two>
              <Three>
                <Field label="City"><input className="input" value={form.site_city ?? ''} onChange={(e) => set('site_city', e.target.value)} /></Field>
                <Field label="State"><input className="input" value={form.site_state ?? ''} onChange={(e) => set('site_state', e.target.value)} /></Field>
                <Field label="ZIP"><input className="input" value={form.site_zip ?? ''} onChange={(e) => set('site_zip', e.target.value)} /></Field>
              </Three>
              <Two>
                <Field label="Survey Date"><input className="input" type="date" value={form.survey_date ?? ''} onChange={(e) => set('survey_date', e.target.value)} /></Field>
                <Field label="Surveyed By"><input className="input" value={form.surveyed_by ?? ''} onChange={(e) => set('surveyed_by', e.target.value)} /></Field>
              </Two>
            </div>
          )}

          {/* ── Page 2 — the type-specific questions ───────────────────── */}
          {page === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {kind === 'cameras' && (
                <>
                  <SectionLabel>Camera schedule</SectionLabel>
                  <SurveyCameras cameras={form.cameras ?? []} folderKey={folderKey} onChange={(c) => set('cameras', c)} />
                </>
              )}
              {kind === 'drops' && (
                <>
                  <SectionLabel>Drop schedule</SectionLabel>
                  <SurveyDrops drops={form.cable_drops ?? []} folderKey={folderKey} onChange={(d) => set('cable_drops', d)} />
                </>
              )}

              <SectionLabel>What you found</SectionLabel>
              <Field label="Existing Conditions"><textarea className="input" rows={2} placeholder="What is on site today" value={form.existing_conditions ?? ''} onChange={(e) => set('existing_conditions', e.target.value)} /></Field>
              <Field label="Findings"><textarea className="input" rows={2} placeholder="Problems, gaps, anything that needs attention" value={form.findings ?? ''} onChange={(e) => set('findings', e.target.value)} /></Field>

              <SectionLabel>Questions for this job</SectionLabel>
              <SurveyQuestions
                items={form.custom_qa ?? []}
                templates={questionTemplates}
                surveyType={form.survey_type ?? 'camera'}
                onChange={(qa) => set('custom_qa', qa)}
              />

              {(kind !== 'none') && (
                <>
                  <SectionLabel>Head-end &amp; infrastructure</SectionLabel>
                  <Two>
                    <Field label="Rack space available"><input className="input" placeholder="e.g. 9-12U" value={form.rack_space ?? ''} onChange={(e) => set('rack_space', e.target.value)} /></Field>
                    <Field label="PoE switch"><input className="input" placeholder="Make/model, or 'sourcing'" value={form.switch_notes ?? ''} onChange={(e) => set('switch_notes', e.target.value)} /></Field>
                  </Two>
                  <Field label="Head-end / NVR notes"><textarea className="input" rows={2} placeholder="Existing rack, patch panel, cable bundle to ceiling…" value={form.head_end_notes ?? ''} onChange={(e) => set('head_end_notes', e.target.value)} /></Field>
                </>
              )}

              <Field label="Access &amp; scheduling"><textarea className="input" rows={2} placeholder="Occupied during install? Permits? Attic/crawlspace access?" value={form.access_notes ?? ''} onChange={(e) => set('access_notes', e.target.value)} /></Field>

              <SectionLabel>Documentation</SectionLabel>
              <SurveyDocuments documents={form.documents ?? []} folderKey={folderKey} onChange={(d) => set('documents', d)} />
            </div>
          )}

          {/* ── Page 3 — recommended placements ────────────────────────── */}
          {page === 3 && (
            <SurveyPlacements
              survey={asSurvey} folderKey={folderKey}
              onCamerasChange={(c) => set('cameras', c)}
              onDropsChange={(d) => set('cable_drops', d)}
            />
          )}

          {/* ── Page 4 — summary and pricing ───────────────────────────── */}
          {page === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SectionLabel>Recommendation</SectionLabel>
              <Field label="Recommendations"><textarea className="input" rows={3} placeholder="What FAJ proposes — this leads the quote" value={form.recommendations ?? ''} onChange={(e) => set('recommendations', e.target.value)} /></Field>

              <SectionLabel>Labour &amp; extra scope</SectionLabel>
              <Three>
                <Field label="Labor Hours"><input className="input" type="number" step="0.25" inputMode="decimal" value={form.labor_hours ?? ''} onChange={(e) => set('labor_hours', e.target.value === '' ? null : Number(e.target.value))} /></Field>
                <Field label="Labor Rate ($/hr)"><input className="input" type="number" step="0.01" inputMode="decimal" value={form.labor_rate ?? ''} onChange={(e) => set('labor_rate', e.target.value === '' ? null : Number(e.target.value))} /></Field>
                <Field label="Tax %"><input className="input" type="number" step="0.1" inputMode="decimal" value={form.tax_rate ?? 0} onChange={(e) => set('tax_rate', Number(e.target.value))} /></Field>
              </Three>

              <ScopeLines
                items={form.scope_items ?? []}
                onChange={(items) => set('scope_items', items)}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 18, fontSize: 13, padding: '10px 0', borderTop: '1px solid #eee', flexWrap: 'wrap' }}>
                {totals.devices > 0 && (
                  <div>{kind === 'drops' ? 'Drops' : 'Cameras'}: <strong>{fmtMoney(totals.devices)}</strong></div>
                )}
                {totals.scope > 0 && <div>Materials: <strong>{fmtMoney(totals.scope)}</strong></div>}
                {totals.labor > 0 && <div>Labor: <strong>{fmtMoney(totals.labor)}</strong></div>}
                {totals.tax > 0 && <div>Tax: <strong>{fmtMoney(totals.tax)}</strong></div>}
                <div style={{ color: 'var(--teal)' }}>Total: <strong>{fmtMoney(totals.total)}</strong></div>
              </div>

              <Two>
                <Field label="Payment Terms"><input className="input" placeholder="e.g. 50% deposit, 50% on completion" value={form.payment_terms ?? ''} onChange={(e) => set('payment_terms', e.target.value)} /></Field>
                <Field label="Status">
                  <select className="select input" value={form.status ?? 'draft'} onChange={(e) => set('status', e.target.value as SurveyStatus)}>
                    {SURVEY_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </Field>
              </Two>
              <Field label="Internal Notes"><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>

              {/* The gate. Nothing here blocks saving — only quoting. */}
              <div style={{
                padding: '11px 13px', borderRadius: 10, fontSize: 12,
                background: ready ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
                color: ready ? '#047857' : '#92400e',
              }}>
                {ready ? (
                  <strong>Survey complete — ready to quote.</strong>
                ) : (
                  <>
                    <strong>Still needed before quoting:</strong>
                    <ul style={{ margin: '5px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                      {status.filter((p) => p.page !== 3 && !p.done).map((p) => (
                        <li key={p.page}>
                          Page {p.page} — {p.missing.join(', ')}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

       </div>
      </div>

      {/* Sticky action bar — Next and Save stay reachable, never scrolled past. */}
      <div style={{
        flexShrink: 0, borderTop: '1px solid #eee9df', background: 'white',
        padding: '12px 20px', boxShadow: '0 -4px 20px rgba(0,0,0,0.04)',
      }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost" disabled={page === 1}
            onClick={() => setPage((p) => (p - 1) as SurveyPage)}
            style={{ opacity: page === 1 ? 0.4 : 1 }}
          ><ChevronLeft size={14} /> Back</button>

          <div style={{ flex: 1 }} />

          <button className="btn btn-ghost" onClick={() => save(false)} disabled={saving || !form.client_name}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>

          {page < 4 ? (
            <button className="btn btn-primary" onClick={() => setPage((p) => (p + 1) as SurveyPage)}>
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button
              className="btn btn-primary" onClick={() => save(true)}
              disabled={saving || !ready}
              title={ready ? 'Save the survey and build its quote' : 'Fill in what is still needed above'}
            >
              <FileSignature size={14} /> Save &amp; Build Quote
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Extra scope lines (page 4) ──────────────────────────────────────────────

function ScopeLines({ items, onChange }: { items: SurveyScopeItem[]; onChange: (i: SurveyScopeItem[]) => void }) {
  const GRID = '1fr 55px 60px 85px 80px 24px';
  const update = (id: string, patch: Partial<SurveyScopeItem>) =>
    onChange(items.map((li) => (li.id === id ? { ...li, ...patch } : li)));

  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
        Materials &amp; other lines
      </label>
      {items.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 6, fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', marginBottom: 4 }}>
            <div>Description</div><div>Qty</div><div>Unit</div><div>Rate</div><div style={{ textAlign: 'right' }}>Total</div><div />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((li) => (
              <div key={li.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 6, alignItems: 'center' }}>
                <input className="input" placeholder="e.g. Cat6 box, patch panel" value={li.description} onChange={(e) => update(li.id, { description: e.target.value })} />
                <input className="input" type="number" inputMode="decimal" value={li.quantity} onChange={(e) => update(li.id, { quantity: Number(e.target.value) })} />
                <input className="input" placeholder="ea" value={li.unit ?? ''} onChange={(e) => update(li.id, { unit: e.target.value })} />
                <input className="input" type="number" step="0.01" inputMode="decimal" value={li.rate} onChange={(e) => update(li.id, { rate: Number(e.target.value) })} />
                <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtMoney(scopeLineTotal(li))}</div>
                <button onClick={() => onChange(items.filter((x) => x.id !== li.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c' }}><X size={14} /></button>
              </div>
            ))}
          </div>
        </>
      )}
      <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={() => onChange([...items, newScopeItem()])}>
        + Add Line
      </button>
    </div>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function Two({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>{children}</div>;
}
function Three({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: 'var(--teal)', textTransform: 'uppercase', marginTop: 4, paddingTop: 10, borderTop: '1px solid #eee' }}>
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
