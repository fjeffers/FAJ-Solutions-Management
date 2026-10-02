'use client';
// Portal & Review — the owner's side of the contractor portal (migrations 048/049).
//
// Two jobs that belong together, because both are "what happens between the tech
// finishing and Fred paying":
//
//   REVIEW    a tech submits the job; Fred approves it or denies it with a
//             reason. Approving locks the job to the portal for good. Alongside
//             each submission sits the pay the logged hours suggest, so the
//             number Fred pays comes from GPS-stamped time instead of memory.
//
//   ACCESS    helper links. A revocable token with an explicit list of what that
//             person may do, scoped to one tech's work. The checkboxes here only
//             decide which controls the portal draws — the database enforces it.
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import { logAudit } from '@/lib/audit';
import type {
  WorkOrder, Contractor, ContractorTimeLog, PortalGrant, PortalCapability,
} from '@/lib/types';
import { PORTAL_CAPABILITIES } from '@/lib/types';
import { suggestPayForWO, suggestionsAsContractorPay, payVariance, type PaySuggestion } from '@/lib/pay';
import { fmtMoney, fmtDate } from '@/lib/utils';
import {
  Plus, X, Check, Ban, Link2, Clock, MapPin, ShieldCheck, AlertTriangle, Users,
} from 'lucide-react';
import { backdropClose } from '@/lib/backdrop';

type Tab = 'review' | 'access';

export default function PortalAdminView() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>('review');
  const [wos, setWos] = useState<WorkOrder[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [logs, setLogs] = useState<ContractorTimeLog[]>([]);
  const [grants, setGrants] = useState<PortalGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [denying, setDenying] = useState<{ wo: WorkOrder; reason: string } | null>(null);
  const [granting, setGranting] = useState<Partial<PortalGrant> | null>(null);

  const load = async () => {
    const [w, c, l, g] = await Promise.all([
      supabase.from('work_orders').select('*').is('archived_at', null),
      supabase.from('contractors').select('*').order('name'),
      supabase.from('contractor_time_logs').select('*'),
      supabase.from('portal_grants').select('*').order('created_at', { ascending: false }),
    ]);
    setWos((w.data ?? []) as WorkOrder[]);
    setContractors((c.data ?? []) as Contractor[]);
    setLogs((l.data ?? []) as ContractorTimeLog[]);
    setGrants((g.data ?? []) as PortalGrant[]);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Submitted and waiting on Fred. Oldest first — the tech is waiting to be paid.
  const submitted = useMemo(
    () => wos
      .filter((w) => w.submission_status === 'submitted')
      .sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? '')),
    [wos],
  );

  // Jobs a tech has clocked time on but not submitted — the other half of
  // "who was on site". Without this they'd be invisible until submission.
  const inFlight = useMemo(() => {
    const withTime = new Set(logs.map((l) => l.wo_id));
    return wos.filter((w) => withTime.has(w.id) && w.submission_status !== 'submitted'
      && w.wo_status !== 'Approved' && w.wo_status !== 'Paid');
  }, [wos, logs]);

  // One pass over the logs per data change, not one per card per render — a
  // keystroke in the deny box used to re-run this for every visible job.
  const suggestionsByWo = useMemo(() => {
    const m = new Map<string, PaySuggestion[]>();
    for (const wo of [...submitted, ...inFlight]) {
      m.set(wo.id, suggestPayForWO(wo, logs, contractors));
    }
    return m;
  }, [submitted, inFlight, logs, contractors]);

  const suggestionsFor = (wo: WorkOrder) => suggestionsByWo.get(wo.id) ?? [];

  // ── Approve / deny ──────────────────────────────────────────────────────
  const approve = async (wo: WorkOrder, acceptPay: PaySuggestion[] | null) => {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      wo_status: 'Approved',
      submission_status: 'approved',
      approved_at: now,
      reviewed_at: now,
      rejection_reason: null,
      updated_at: now,
      review_history: [
        ...(Array.isArray(wo.review_history) ? wo.review_history : []),
        { at: now, action: 'approved', by: 'owner' },
      ],
    };

    // Accepting the suggestion writes it into contractor_pay — the same field
    // Fred would have typed by hand. Only techs with a real amount are included.
    if (acceptPay) {
      const pay = suggestionsAsContractorPay(acceptPay);
      if (Object.keys(pay).length > 0) patch.contractor_pay = pay;
    }

    const { error } = await supabase.from('work_orders').update(patch).eq('id', wo.id);
    if (error) return toastError(error.message);
    // Approving can write contractor_pay, so it belongs in the audit trail
    // alongside every other money-touching write in the app.
    await logAudit({
      action: 'update', entityType: 'work_order', entityId: wo.id,
      entityLabel: `WO#${wo.wo_number}`,
      changes: { event: 'approved', pay: patch.contractor_pay ?? null },
    });
    toastSuccess(`${wo.wo_number} approved — the portal can no longer change it`);
    void load();
  };

  const deny = async () => {
    if (!denying) return;
    const reason = denying.reason.trim();
    if (!reason) return toastError('Give the tech a reason — they need to know what to fix');

    const now = new Date().toISOString();
    const { error } = await supabase.from('work_orders').update({
      // Back to In Progress so the tech can reach it and fix it.
      wo_status: 'In Progress',
      submission_status: 'rejected',
      rejection_reason: reason,
      reviewed_at: now,
      updated_at: now,
      review_history: [
        ...(Array.isArray(denying.wo.review_history) ? denying.wo.review_history : []),
        { at: now, action: 'denied', by: 'owner', reason },
      ],
    }).eq('id', denying.wo.id);

    if (error) return toastError(error.message);
    await logAudit({
      action: 'update', entityType: 'work_order', entityId: denying.wo.id,
      entityLabel: `WO#${denying.wo.wo_number}`,
      changes: { event: 'denied', reason },
    });
    toastSuccess('Sent back to the tech with your reason');
    setDenying(null);
    void load();
  };

  // ── Grants ──────────────────────────────────────────────────────────────
  const saveGrant = async () => {
    if (!granting?.label?.trim()) return toastError('Give the link a name so you know whose it is');
    if (!granting.contractor_id) return toastError('Pick which tech this helper works under');

    const caps = granting.capabilities?.length ? granting.capabilities : (['view'] as PortalCapability[]);
    // 'view' is the baseline — without it the link resolves but shows nothing.
    const withView = caps.includes('view') ? caps : (['view', ...caps] as PortalCapability[]);

    const { error } = await supabase.from('portal_grants').insert({
      label: granting.label.trim(),
      contractor_id: granting.contractor_id,
      capabilities: withView,
      expires_at: granting.expires_at || null,
    });
    if (error) return toastError(error.message);
    toastSuccess('Helper link created');
    setGranting(null);
    void load();
  };

  const revoke = async (g: PortalGrant) => {
    if (!confirm(`Revoke ${g.label}?\n\nTheir link stops working immediately.`)) return;
    const { error } = await supabase.from('portal_grants')
      .update({ revoked_at: new Date().toISOString() }).eq('id', g.id);
    if (error) return toastError(error.message);
    toastSuccess('Revoked');
    void load();
  };

  const copyLink = async (g: PortalGrant) => {
    const url = `${window.location.origin}/portal/${g.token}`;
    try {
      if (navigator.share) await navigator.share({ title: g.label, url });
      else { await navigator.clipboard.writeText(url); toastSuccess('Link copied'); }
    } catch { /* dismissed */ }
  };

  if (loading) return <div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div>;

  const nameOf = (id: string) => contractors.find((c) => c.id === id)?.name ?? 'Unknown tech';

  return (
    <div style={{ padding: '16px 4px', maxWidth: 1000 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <h2 className="serif" style={{ fontSize: 26, fontWeight: 600, margin: 0 }}>Portal &amp; Review</h2>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, background: 'var(--line)', borderRadius: 10, padding: 3 }}>
          {([['review', `Review${submitted.length ? ` (${submitted.length})` : ''}`], ['access', 'Helper links']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: 8, padding: '7px 14px',
                fontSize: 12, fontWeight: 700,
                background: tab === k ? 'var(--card)' : 'transparent',
                color: tab === k ? 'var(--teal)' : 'var(--muted)',
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'review' && (
        <>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Approving a job locks it to the portal permanently — the tech can no longer open or change it.
          </div>

          {submitted.length === 0 && (
            <div className="card" style={{ padding: 18, fontSize: 13, color: 'var(--muted)' }}>
              Nothing waiting on you. Submitted jobs land here.
            </div>
          )}

          {submitted.map((wo) => (
            <ReviewCard key={wo.id} wo={wo} suggestions={suggestionsFor(wo)}
              onApprove={(withPay) => void approve(wo, withPay)}
              onDeny={() => setDenying({ wo, reason: '' })} />
          ))}

          {inFlight.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
                On site now / not yet submitted
              </div>
              {inFlight.map((wo) => {
                const s = suggestionsFor(wo);
                return (
                  <div key={wo.id} className="card" style={{ padding: '12px 15px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                      <b style={{ fontSize: 14 }}>{wo.wo_number}</b>
                      <span style={{ fontSize: 13 }}>{wo.title ?? ''}</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{wo.wo_status}</span>
                    </div>
                    {s.map((x) => <PayLine key={x.contractorName} s={x} />)}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'access' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
              A helper link works under one tech and only does what you tick. Revoke any time.
            </div>
            <button className="btn" onClick={() => setGranting({ capabilities: ['view'] as PortalCapability[] })}>
              <Plus size={15} /> New helper link
            </button>
          </div>

          {grants.length === 0 && (
            <div className="card" style={{ padding: 18, fontSize: 13, color: 'var(--muted)' }}>
              No helper links yet. Techs use their own portal link and always have full access to their own jobs.
            </div>
          )}

          {grants.map((g) => {
            const revoked = Boolean(g.revoked_at);
            const expired = Boolean(g.expires_at && new Date(g.expires_at) < new Date());
            const dead = revoked || expired;
            return (
              <div key={g.id} className="card" style={{ padding: '14px 16px', marginBottom: 10, opacity: dead ? 0.55 : 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Users size={15} style={{ color: 'var(--teal)' }} />
                  <b style={{ fontSize: 15 }}>{g.label}</b>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>under {nameOf(g.contractor_id)}</span>
                  {dead && (
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#b91c1c', background: 'rgba(185,28,28,0.1)', borderRadius: 999, padding: '2px 8px' }}>
                      {revoked ? 'revoked' : 'expired'}
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  {!dead && (
                    <>
                      <button className="btn btn-ghost" onClick={() => void copyLink(g)}><Link2 size={14} /> Link</button>
                      <button className="btn btn-ghost" onClick={() => void revoke(g)} title="Revoke"><Ban size={14} /></button>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 9 }}>
                  {g.capabilities.map((c) => (
                    <span key={c} style={{ fontSize: 10, fontWeight: 700, color: 'var(--teal)', background: 'rgba(14,27,46,0.1)', borderRadius: 999, padding: '2px 9px' }}>
                      {PORTAL_CAPABILITIES.find((p) => p.key === c)?.label ?? c}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                  {g.expires_at ? `Expires ${fmtDate(g.expires_at)} · ` : ''}
                  {g.last_seen_at ? `last used ${fmtDate(g.last_seen_at)}` : 'never used'}
                </div>
              </div>
            );
          })}
        </>
      )}

      {denying && (
        <Modal title={`Deny ${denying.wo.wo_number}`} onClose={() => setDenying(null)} onSave={() => void deny()} saveLabel="Send back">
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            The job goes back to In Progress so the tech can reach it and fix what&apos;s wrong.
          </div>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>
              What needs fixing
            </div>
            <textarea className="input" rows={4} autoFocus value={denying.reason}
              onChange={(e) => setDenying({ ...denying, reason: e.target.value })}
              placeholder="Photos of the rack are missing, and the patch panel labels aren't in the notes." />
          </label>
        </Modal>
      )}

      {granting && (
        <Modal title="New helper link" onClose={() => setGranting(null)} onSave={() => void saveGrant()}>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>Name</div>
            <input className="input" autoFocus placeholder="Mike — Dave's helper"
              value={granting.label ?? ''} onChange={(e) => setGranting({ ...granting, label: e.target.value })} />
          </label>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>Works under</div>
            <select className="input" value={granting.contractor_id ?? ''}
              onChange={(e) => setGranting({ ...granting, contractor_id: e.target.value })}>
              <option value="">Pick a tech…</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>Expires (optional)</div>
            <input className="input" type="date" value={granting.expires_at?.slice(0, 10) ?? ''}
              onChange={(e) => setGranting({ ...granting, expires_at: e.target.value || null })} />
          </label>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5 }}>
              What they can do
            </div>
            {PORTAL_CAPABILITIES.map((cap) => {
              const on = (granting.capabilities ?? []).includes(cap.key);
              const locked = cap.key === 'view';
              return (
                <label key={cap.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', cursor: locked ? 'default' : 'pointer' }}>
                  <input type="checkbox" checked={on || locked} disabled={locked}
                    onChange={(e) => {
                      const cur = new Set(granting.capabilities ?? []);
                      if (e.target.checked) cur.add(cap.key); else cur.delete(cap.key);
                      setGranting({ ...granting, capabilities: [...cur] as PortalCapability[] });
                    }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{cap.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{cap.hint}</div>
                  </div>
                </label>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', background: 'rgba(14,27,46,0.06)', borderRadius: 8, padding: '9px 11px' }}>
            <ShieldCheck size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
            A helper never sees pay, and can never file the tech&apos;s W-9 or sign their contract.
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function PayLine({ s }: { s: PaySuggestion }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline', padding: '5px 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 120 }}>{s.contractorName}</span>
      {s.hours != null && (
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          <Clock size={11} style={{ verticalAlign: -1 }} /> {s.hours}h{s.adjusted ? ' (adjusted)' : ''}
        </span>
      )}
      {s.rate != null && <span style={{ fontSize: 12, color: 'var(--muted)' }}>@ {fmtMoney(s.rate)}/hr</span>}
      {s.amount != null
        ? <span style={{ fontSize: 14, fontWeight: 800, color: '#047857' }}>{fmtMoney(s.amount)}</span>
        : <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309' }}>
            <AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {s.blockedReason}
          </span>}
      {s.amount != null && s.blockedReason && (
        <span style={{ fontSize: 11, color: '#b45309', flexBasis: '100%' }}>{s.blockedReason}</span>
      )}
    </div>
  );
}

function ReviewCard({ wo, suggestions, onApprove, onDeny }: {
  wo: WorkOrder;
  suggestions: PaySuggestion[];
  onApprove: (withPay: PaySuggestion[] | null) => void;
  onDeny: () => void;
}) {
  const [usePay, setUsePay] = useState(true);
  const payable = suggestions.filter((s) => s.amount != null);
  const variance = payVariance(wo.contractor_pay as Record<string, number> | null, suggestions);
  const disagrees = variance.filter((v) => v.delta != null && v.delta !== 0);

  return (
    <div className="card" style={{ padding: '15px 17px', marginBottom: 12, borderLeft: '4px solid #b45309' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <b style={{ fontSize: 16 }}>{wo.wo_number}</b>
        <span style={{ fontSize: 14 }}>{wo.title ?? ''}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          submitted {fmtDate(wo.submitted_at)}{wo.submitted_by ? ` by ${wo.submitted_by}` : ''}
        </span>
      </div>

      {wo.site_name && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
          <MapPin size={11} style={{ verticalAlign: -1 }} /> {[wo.site_name, wo.site_city, wo.site_state].filter(Boolean).join(', ')}
        </div>
      )}

      {wo.closeout_notes && (
        <div style={{ background: 'var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 12.5, whiteSpace: 'pre-wrap', marginTop: 10 }}>
          {wo.closeout_notes}
        </div>
      )}

      {wo.rejection_reason && (
        <div style={{ fontSize: 11, color: '#b45309', marginTop: 8 }}>
          Previously sent back: {wo.rejection_reason}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)' }}>
          Pay from logged hours
        </div>
        {suggestions.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 0' }}>No time logged on this job.</div>
          : suggestions.map((s) => <PayLine key={s.contractorName} s={s} />)}
      </div>

      {disagrees.length > 0 && (
        <div style={{ fontSize: 11, color: '#b45309', marginTop: 8 }}>
          <AlertTriangle size={11} style={{ verticalAlign: -1 }} />{' '}
          {disagrees.map((v) => `${v.contractorName}: recorded ${fmtMoney(v.current ?? 0)}, hours suggest ${fmtMoney(v.suggested ?? 0)}`).join(' · ')}
        </div>
      )}

      {payable.length > 0 && (
        <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, marginTop: 10 }}>
          <input type="checkbox" checked={usePay} onChange={(e) => setUsePay(e.target.checked)} />
          Set contractor pay to the suggested amounts on approval
        </label>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={() => onApprove(usePay && payable.length > 0 ? suggestions : null)}>
          <Check size={15} /> Approve
        </button>
        <button className="btn btn-ghost" onClick={onDeny}><Ban size={15} /> Deny &amp; send back</button>
      </div>
    </div>
  );
}

function Modal({ title, onClose, onSave, saveLabel, children }: {
  title: string; onClose: () => void; onSave: () => void; saveLabel?: string; children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" {...backdropClose(onClose)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div className="serif" style={{ fontSize: 19, fontWeight: 600 }}>{title}</div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 4 }}><X size={16} /></button>
        </div>
        <div style={{ display: 'grid', gap: 11 }}>{children}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={onSave}>{saveLabel ?? 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
