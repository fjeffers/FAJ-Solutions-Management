'use client';
// "Build this job?" — after Generate with AI reads the email, Fred ticks what
// this job needs and what it doesn't (Fred, 2026-10-18: "it can read the email
// then ask me if we should build or not"). The choices are lib/ai-needs.ts.
import type { ReactNode } from 'react';
import { CAPTURE_ITEMS, type CaptureItem } from '@/lib/capture';
import { linkLabel } from '@/lib/client-links';
import { fmtMoney } from '@/lib/utils';
import { foundParts, isTechContact, type Found, type NeedChoices } from '@/lib/ai-needs';

const card: React.CSSProperties = { border: '1px solid var(--wf-line)', borderRadius: 12, padding: '12px 14px', display: 'grid', gap: 8 };
const h: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 700 };
const short = (s: string | null | undefined, n = 90) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function Tick({ on, onChange, children, note }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; note?: string }) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }} />
      <span style={{ minWidth: 0 }}>
        {children}
        {note && <span className="wf-subtle" style={{ display: 'block', fontSize: 12 }}>{note}</span>}
      </span>
    </label>
  );
}

export default function AiNeedsReview({ found, choices, onChange }: {
  found: Found; choices: NeedChoices; onChange: (c: NeedChoices) => void;
}) {
  const set = (patch: Partial<NeedChoices>) => onChange({ ...choices, ...patch });
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v));
  const parts = foundParts(found);
  const contacts = found.contacts ?? [];
  const links = found.client_links ?? [];
  const kept = links.filter((l) => choices.links.includes(l));
  const counts: Partial<Record<CaptureItem, number>> = { checklist: found.wo_tasks?.length ?? 0, questions: found.custom_qa?.length ?? 0 };
  const price = found.total_amount ?? null;
  const hasAddress = !!(found.site_address || found.site_zip);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0 }}>
        Here&apos;s what I read{found.title ? <> for <b>{found.title}</b></> : null}. Tick what this job needs; anything left off stays off the job.
      </p>

      <section style={card}>
        <h3 style={h}>What the tech records</h3>
        {found.capture_why && <div className="wf-subtle" style={{ fontSize: 13 }}>AI: {found.capture_why}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CAPTURE_ITEMS.map((c) => {
            const on = choices.capture.includes(c.key);
            return (
              <button key={c.key} type="button" aria-pressed={on} title={c.hint}
                onClick={() => set({ capture: toggle(choices.capture, c.key, !on) })}
                style={{
                  borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', font: 'inherit',
                  border: `1px solid ${on ? 'var(--wf-gold, #C9A227)' : 'var(--wf-line)'}`,
                  background: on ? 'rgba(201,162,39,0.16)' : 'var(--wf-card)', color: 'var(--wf-text)',
                }}>
                {c.label}{counts[c.key] ? ` (${counts[c.key]} found)` : ''}
              </button>
            );
          })}
        </div>
      </section>

      {(contacts.length > 0 || links.length > 0 || parts.access || parts.parts || parts.deliverables || parts.money || hasAddress) && (
        <section style={card}>
          <h3 style={h}>From the email</h3>
          {contacts.map((c) => (
            <Tick key={c.id} on={choices.contacts.includes(c.id)} onChange={(on) => set({ contacts: toggle(choices.contacts, c.id, on) })}
              note={isTechContact(c) ? 'Looks like a tech sent to do the work, so it starts off' : undefined}>
              {[c.name, c.label].filter(Boolean).join(' · ') || c.email || c.phone}
              {c.phone ? <span className="wf-subtle"> · {c.phone}</span> : null}
            </Tick>
          ))}
          {links.map((l) => (
            <Tick key={l} on={choices.links.includes(l)} onChange={(on) => set({
              links: toggle(choices.links, l, on),
              ...(on ? {} : { checkin: choices.checkin === l ? '' : choices.checkin, checkout: choices.checkout === l ? '' : choices.checkout }),
            })}>
              Link: {linkLabel(l)}
            </Tick>
          ))}
          {kept.length > 0 && (
            <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {([['When the tech checks in on site, open', 'checkin'], ['When the tech checks out for the day, open', 'checkout']] as const).map(([label, key]) => (
                <label key={key} style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
                  {label}
                  <select className="wf-input" value={choices[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<NeedChoices>)}>
                    <option value="">Nothing</option>
                    {kept.map((l) => <option key={l} value={l}>{linkLabel(l)}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          {parts.access && (
            <Tick on={choices.access} onChange={(on) => set({ access: on })} note={short(found.access_instructions || found.parking_instructions)}>
              Access and parking
            </Tick>
          )}
          {parts.parts && (
            <Tick on={choices.parts} onChange={(on) => set({ parts: on })} note={short(found.parts_materials || found.tools_required || found.required_skills)}>
              Tools, parts and skills
            </Tick>
          )}
          {parts.deliverables && (
            <Tick on={choices.deliverables} onChange={(on) => set({ deliverables: on })} note={short(found.deliverables || found.deliverable_instructions)}>
              Deliverables and closeout notes
            </Tick>
          )}
          {parts.money && (
            <Tick on={choices.money} onChange={(on) => set({ money: on })} note="What the client pays and any budgets in the email">
              Price{price != null ? `: ${fmtMoney(price)}` : ''}
            </Tick>
          )}
          {hasAddress && (
            <Tick on={choices.mileage} onChange={(on) => set({ mileage: on })} note="Worked out from the address when the job opens">
              Bill the client for mileage
            </Tick>
          )}
        </section>
      )}
      <div className="wf-subtle" style={{ fontSize: 12 }}>
        The title, site, schedule and description always go on. Techs and their pay are never filled in by the AI.
      </div>
    </div>
  );
}
