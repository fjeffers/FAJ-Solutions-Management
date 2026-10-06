'use client';
// Settings -> Lists & stages (Fred, 2026-10-05: "full admin privilege in
// settings"). Rename the job stages the office sees; add, rename, reorder and
// hide priorities, service types, job sources and assignment types; choose
// which priorities count as high priority. Saves by itself
// (components/useAppLists.ts); the rules are in lib/app-lists.ts.
import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, RotateCcw, Undo2 } from 'lucide-react';
import {
  NAME_MAX, STANDARD_LISTS, STANDARD_STAGE_NAMES, addItem, isStandardLists, normalizeLists, renameItem,
  renameStage, setItemHidden, setUrgent, shiftItem, type AppLists, type ListName,
} from '@/lib/app-lists';
import { WF_STATUS_COLOR, WF_STATUS_LABEL, type WfStatus } from '@/lib/wf';
import type { LayoutSaveState } from '@/components/useAppLayout';
import { SaveLine } from '@/components/LayoutEditor';

const STAGES: WfStatus[] = ['open', 'offered', 'scheduled', 'inProgress', 'workDone', 'closed', 'declined'];

const LISTS: { list: ListName; title: string; hint: string; noun: string }[] = [
  { list: 'priorities', title: 'Priorities', hint: 'Tick the ones that count as high priority — they show in red and in the High priority filter on Dispatch.', noun: 'priority' },
  { list: 'serviceTypes', title: 'Service types', hint: 'What kind of work a job is.', noun: 'service type' },
  { list: 'sources', title: 'Job sources', hint: 'Where a job came from. NetView and FieldNation also switch on their own forms and numbering.', noun: 'source' },
  { list: 'assignmentTypes', title: 'Assignment types', hint: 'How the tech on a job is engaged.', noun: 'assignment type' },
];

const iconBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 8, border: '1px solid var(--wf-line)', background: 'var(--wf-card)',
  color: 'var(--wf-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
};
const off: React.CSSProperties = { ...iconBtn, opacity: 0.35, cursor: 'default' };
const box: React.CSSProperties = { border: '1px solid var(--wf-line)', borderRadius: 12, overflow: 'hidden', background: 'var(--wf-card)' };
const head: React.CSSProperties = { padding: '10px 12px', background: 'var(--wf-surface)' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', borderTop: '1px solid var(--wf-line)' };

export default function ListsEditor({ lists, onChange, saveState, saveError, onRetry }: {
  lists: AppLists;
  onChange: (next: AppLists) => void;
  saveState: LayoutSaveState;
  saveError: string | null;
  onRetry: () => void;
}) {
  const [start] = useState<AppLists>(() => normalizeLists(lists));
  const [adding, setAdding] = useState<Partial<Record<ListName, string>>>({});
  const [addError, setAddError] = useState<Partial<Record<ListName, string>>>({});
  const changed = JSON.stringify(normalizeLists(lists)) !== JSON.stringify(start);

  const add = (list: ListName, noun: string) => {
    const name = (adding[list] ?? '').trim();
    if (!name) { setAddError((e) => ({ ...e, [list]: `Type the new ${noun} first.` })); return; }
    const next = addItem(lists, list, name);
    if (!next) { setAddError((e) => ({ ...e, [list]: `"${name}" is already in the list.` })); return; }
    onChange(next);
    setAdding((a) => ({ ...a, [list]: '' }));
    setAddError((e) => ({ ...e, [list]: undefined }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 28px 24px' }}>
      <p className="wf-p-small" style={{ margin: 0, color: 'var(--wf-subtle)', lineHeight: 1.5 }}>
        Rename, add, reorder or hide the choices on your jobs. Changes save by themselves.{' '}
        <strong>Nothing is ever deleted:</strong> a hidden choice just isn't offered for new jobs, and jobs that
        already use it keep it. Renaming changes the name everywhere, old jobs included. Expense categories
        stay fixed, because each one decides how a tech is paid back.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 34 }}>
        <SaveLine state={saveState} error={saveError} onRetry={onRetry} />
        <span style={{ flex: 1 }} />
        {changed && (
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onChange(start)}><Undo2 size={14} /> Undo my changes</button>
        )}
        {!isStandardLists(lists) && (
          <button type="button" className="wf-btn wf-btn-outline wf-btn-sm"
            onClick={() => { if (window.confirm('Put every list back to the standard names and choices? Choices you added stay, hidden.')) onChange(hideAdded(lists)); }}>
            <RotateCcw size={14} /> Standard lists
          </button>
        )}
      </div>

      <section style={box}>
        <div style={head}>
          <div className="wf-p-title">Job stages</div>
          <div className="wf-p-small wf-subtle">What the office calls each stage on Dispatch, the Schedule and job pages. Techs keep their own wording.</div>
        </div>
        {STAGES.map((st) => {
          const value = st in lists.stages ? lists.stages[st] ?? '' : STANDARD_STAGE_NAMES[st];
          const renamed = !!lists.stages[st]?.trim() && lists.stages[st]!.trim() !== STANDARD_STAGE_NAMES[st];
          return (
            <div key={st} style={rowStyle}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: WF_STATUS_COLOR[st], flexShrink: 0 }} />
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <input className="wf-input" value={value} placeholder={STANDARD_STAGE_NAMES[st]} maxLength={NAME_MAX}
                  aria-label={`Name for the stage ${STANDARD_STAGE_NAMES[st]}`}
                  onChange={(e) => onChange(renameStage(lists, st, e.target.value))} style={{ minHeight: 36, padding: '6px 10px' }} />
                <div className="wf-p-small wf-subtle" style={{ marginTop: 2 }}>
                  {renamed ? <>Standard name: {STANDARD_STAGE_NAMES[st]} · </> : null}Techs see: {WF_STATUS_LABEL[st]}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {LISTS.map(({ list, title, hint, noun }) => {
        const items = lists[list];
        const standardKeys = new Set(STANDARD_LISTS[list].map((i) => i.key));
        return (
          <section key={list} style={box}>
            <div style={head}>
              <div className="wf-p-title">{title}</div>
              <div className="wf-p-small wf-subtle">{hint}</div>
            </div>
            {items.map((it, i) => (
              <div key={it.key} style={{ ...rowStyle, opacity: it.hidden ? 0.55 : 1 }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <input className="wf-input" value={it.label} placeholder={it.key} maxLength={NAME_MAX}
                    aria-label={`Name for ${it.key}`}
                    onChange={(e) => onChange(renameItem(lists, list, it.key, e.target.value))} style={{ minHeight: 36, padding: '6px 10px' }} />
                  {(it.label.trim() !== it.key || it.hidden || !standardKeys.has(it.key)) && (
                    <div className="wf-p-small wf-subtle" style={{ marginTop: 2 }}>
                      {it.label.trim() !== it.key && <>Saved on jobs as: {it.key}</>}
                      {it.label.trim() !== it.key && (it.hidden || !standardKeys.has(it.key)) && ' · '}
                      {!standardKeys.has(it.key) && 'Added by you'}
                      {!standardKeys.has(it.key) && it.hidden && ' · '}
                      {it.hidden && <strong>Hidden — not offered for new jobs</strong>}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {list === 'priorities' && (
                    <label className="wf-p-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600, color: it.urgent ? 'var(--wf-danger)' : 'var(--wf-subtle)', width: 130 }}>
                      <input type="checkbox" checked={!!it.urgent} onChange={(e) => onChange(setUrgent(lists, it.key, e.target.checked))} />
                      High priority
                    </label>
                  )}
                  <button type="button" style={i === 0 ? off : iconBtn} disabled={i === 0} aria-label={`Move ${it.label || it.key} up`}
                    onClick={() => onChange(shiftItem(lists, list, it.key, -1))}><ArrowUp size={16} /></button>
                  <button type="button" style={i === items.length - 1 ? off : iconBtn} disabled={i === items.length - 1} aria-label={`Move ${it.label || it.key} down`}
                    onClick={() => onChange(shiftItem(lists, list, it.key, 1))}><ArrowDown size={16} /></button>
                  <button type="button" className={`wf-btn wf-btn-sm ${it.hidden ? 'wf-btn-gold' : 'wf-btn-outline'}`} style={{ width: 92 }}
                    onClick={() => onChange(setItemHidden(lists, list, it.key, !it.hidden))} aria-pressed={it.hidden}
                    title={it.hidden ? 'Offer it again for new jobs' : "Stop offering it for new jobs (jobs that use it keep it)"}>
                    {it.hidden ? <><Eye size={14} /> Show</> : <><EyeOff size={14} /> Hide</>}
                  </button>
                </div>
              </div>
            ))}
            <div style={{ ...rowStyle, background: 'var(--wf-surface)' }}>
              <input className="wf-input" value={adding[list] ?? ''} placeholder={`New ${noun}`} maxLength={NAME_MAX}
                aria-label={`New ${noun}`} style={{ flex: '1 1 180px', minHeight: 36, padding: '6px 10px' }}
                onChange={(e) => { setAdding((a) => ({ ...a, [list]: e.target.value })); setAddError((x) => ({ ...x, [list]: undefined })); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(list, noun); } }} />
              <button type="button" className="wf-btn wf-btn-navy wf-btn-sm" onClick={() => add(list, noun)}><Plus size={14} /> Add</button>
              {addError[list] && <div role="alert" className="wf-p-small" style={{ width: '100%', color: 'var(--wf-danger)', fontWeight: 600 }}>{addError[list]}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** "Standard lists": the standard names and order back; anything Fred added stays, hidden. */
function hideAdded(l: AppLists): AppLists {
  const std = normalizeLists(STANDARD_LISTS);
  const keep = (list: ListName) => {
    const keys = new Set(std[list].map((i) => i.key));
    return [...std[list], ...l[list].filter((i) => !keys.has(i.key)).map((i) => ({ ...i, hidden: true }))];
  };
  return { stages: {}, priorities: keep('priorities'), serviceTypes: keep('serviceTypes'), sources: keep('sources'), assignmentTypes: keep('assignmentTypes') };
}
