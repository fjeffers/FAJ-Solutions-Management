'use client';
// The office fixes a tech's clock (Fred, 2026-10-24: "in case some one forget to
// log in or the app was not working for them i need to be able to edit their
// hours"; "i too close off as the admin"; "if i need to add or remove edit i
// should be able too"; "i have some still saying on site when they are not").
//
//   StillOnSite  every tech still clocked in on a job, with Clock out
//   ClockPanel   one job's clock-ins and clock-outs: move, remove, add
//
// Both go through wf_owner_fix_punch (migration 139), which also puts the tech's
// job card right, so they stop showing "on site" everywhere.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, LogOut, Plus, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { dayOf } from '@/lib/project-day';
import { clockOf, fixReasonText, parsePunches, punchDays, stillOnSite, zonedIso, type Punch } from '@/lib/clock-fix';
import { toastError, toastSuccess } from '@/lib/toast';
import type { EnrichedWorkOrder } from '@/lib/types';
import { Section } from '@/components/wf/WfUi';

const TZ = 'America/New_York';
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const at = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
const COLS = 'id, wo_id, wo_number, contractor_name, kind, at';

type Fix = { p_op: 'add' | 'move' | 'remove'; p_wo_id: string; p_tech?: string; p_kind?: 'in' | 'out'; p_at?: string; p_id?: string; p_note?: string };

/** One change to the clock. True when it saved. */
async function fixPunch(args: Fix): Promise<boolean> {
  const { data, error } = await createClient().rpc('wf_owner_fix_punch', {
    p_op: args.p_op, p_wo_id: args.p_wo_id, p_tech: args.p_tech ?? null, p_kind: args.p_kind ?? null,
    p_at: args.p_at ?? null, p_id: args.p_id ?? null, p_note: args.p_note ?? null,
  });
  if (error) {
    toastError(error.code === 'PGRST202' ? 'Fixing the clock needs the database update (migration 139) first.' : fixReasonText(''));
    return false;
  }
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!res.ok) { toastError(fixReasonText(res.reason ?? '')); return false; }
  return true;
}

/** A clock-out for someone still on site: the day they clocked in, a time typed. */
function ClockOutBox({ p, onDone }: { p: Punch; onDone: () => void }) {
  const [day, setDay] = useState(() => dayOf(p.at, TZ));
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const label = `${p.contractor_name} WO ${p.wo_number ?? ''}`.trim();
  const save = async () => {
    const iso = zonedIso(day, time, TZ);
    if (!iso) { toastError('Type the time they left the site.'); return; }
    if (Date.parse(iso) < Date.parse(p.at)) { toastError(`That's before they clocked in (${at(p.at)}).`); return; }
    setBusy(true);
    const ok = await fixPunch({ p_op: 'add', p_wo_id: p.wo_id, p_tech: p.contractor_name, p_kind: 'out', p_at: iso, p_note: 'Clocked out by the office' });
    setBusy(false);
    if (ok) { toastSuccess(`${p.contractor_name} clocked out at ${at(iso)}.`); onDone(); }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="date" className="wf-input" style={{ minHeight: 32, padding: '2px 6px' }} value={day} onChange={(e) => setDay(e.target.value)} aria-label={`clock-out day ${label}`} />
      <input type="time" className="wf-input" style={{ minHeight: 32, padding: '2px 6px' }} value={time} onChange={(e) => setTime(e.target.value)} aria-label={`clock-out time ${label}`} />
      <button className="wf-btn wf-btn-navy wf-btn-sm" disabled={busy || !time} onClick={() => void save()}><LogOut size={15} /> Clock out</button>
    </span>
  );
}

/** Every tech still clocked in, on any job: the ones still showing "on site". */
export function StillOnSite({ workOrders, onOpen, refresh = 0 }: { workOrders: EnrichedWorkOrder[]; onOpen: (woId: string) => void; refresh?: number }) {
  const [open, setOpen] = useState<Punch[] | null>(null);
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const { data } = await createClient().from('job_punches').select(COLS).gte('at', since).order('at').limit(5000);
    setOpen(stillOnSite(parsePunches(data)));
  }, []);
  useEffect(() => { void load(); }, [load, refresh]);
  const byId = useMemo(() => new Map(workOrders.map((w) => [w.id, w])), [workOrders]);
  const [now] = useState(() => Date.now());
  if (!open || open.length === 0) return null;
  return (
    <Section title="Still on site" subtitle={`${open.length} clocked in. Clock out anyone who left without tapping Off site.`}>
      <div style={{ display: 'grid', gap: 8 }}>
        {open.map((p) => {
          const w = byId.get(p.wo_id);
          const hours = Math.max(0, now - Date.parse(p.at)) / 3_600_000;
          return (
            <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13.5, borderTop: '1px solid #ECE8DF', paddingTop: 8 }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <b>{p.contractor_name}</b> · WO {p.wo_number ?? w?.wo_number ?? ''}{w ? ` · ${w.site_name || w.title}` : ''}
                <div className="wf-subtle" style={{ fontSize: 12.5 }}>
                  <Clock size={13} style={{ verticalAlign: '-2px' }} /> Clocked in {at(p.at)} · {hours < 48 ? `${hours.toFixed(1)} h ago` : `${Math.round(hours / 24)} days ago`}
                </div>
              </div>
              <ClockOutBox p={p} onDone={() => void load()} />
              <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => onOpen(p.wo_id)}>Open the sheet</button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** One job's clock: each tech's clock-ins and clock-outs a day at a time, every one movable or removable, and a missed one added. */
export function ClockPanel({ wo, techs, from, to, onChanged }: { wo: EnrichedWorkOrder; techs: string[]; from: string; to: string; onChanged: () => void }) {
  const [punches, setPunches] = useState<Punch[]>([]);
  const [hasOffice, setHasOffice] = useState(true);
  const load = useCallback(async () => {
    const db = createClient();
    const full = await db.from('job_punches').select(`${COLS}, by_office, tapped_at`).eq('wo_id', wo.id).order('at');
    // Before migration 139 the office columns aren't there yet: show the clock without them.
    const res = full.error ? await db.from('job_punches').select(COLS).eq('wo_id', wo.id).order('at') : full;
    setHasOffice(!full.error);
    setPunches(parsePunches(res.data));
  }, [wo.id]);
  useEffect(() => { void load(); }, [load]);
  const changed = async () => { await load(); onChanged(); };

  const days = punchDays(punches, TZ).filter((d) => (!from || d.day >= from) && (!to || d.day <= to));
  const open = stillOnSite(punches);
  const [tech, setTech] = useState(techs[0] ?? '');
  const [day, setDay] = useState(() => from || wo.start_date || dayOf(new Date().toISOString(), TZ));
  const [time, setTime] = useState('');
  const [kind, setKind] = useState<'in' | 'out'>('in');
  const [busy, setBusy] = useState(false);

  const move = async (p: Punch, hhmm: string) => {
    if (!hhmm || hhmm === clockOf(p.at, TZ)) return;
    const iso = zonedIso(dayOf(p.at, TZ), hhmm, TZ);
    if (!iso) return;
    if (await fixPunch({ p_op: 'move', p_wo_id: wo.id, p_id: p.id, p_at: iso })) { toastSuccess(`${p.contractor_name}'s clock-${p.kind} moved to ${at(iso)}.`); await changed(); }
  };
  const remove = async (p: Punch) => {
    if (!window.confirm(`Remove ${p.contractor_name}'s clock-${p.kind} at ${at(p.at)}?`)) return;
    if (await fixPunch({ p_op: 'remove', p_wo_id: wo.id, p_id: p.id })) { toastSuccess('Removed.'); await changed(); }
  };
  const add = async () => {
    const iso = zonedIso(day, time, TZ);
    if (!tech.trim()) { toastError('Pick the technician.'); return; }
    if (!iso) { toastError('Type the time.'); return; }
    setBusy(true);
    const ok = await fixPunch({ p_op: 'add', p_wo_id: wo.id, p_tech: tech.trim(), p_kind: kind, p_at: iso });
    setBusy(false);
    if (ok) { toastSuccess(`Clock-${kind} added for ${tech.trim()} at ${at(iso)}.`); setTime(''); await changed(); }
  };

  return (
    <Section title="Clock in and out" subtitle="What the techs tapped. Clock someone out, add a clock-in the app missed, move or remove one. The hours above follow it.">
      <div style={{ display: 'grid', gap: 12, fontSize: 13.5 }}>
        {open.map((p) => (
          <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#FDF3E1', borderRadius: 10, padding: '8px 10px' }}>
            <span style={{ flex: '1 1 240px' }}><b>{p.contractor_name}</b> is still clocked in since {at(p.at)}.</span>
            <ClockOutBox p={{ ...p, wo_number: wo.wo_number }} onDone={() => void changed()} />
          </div>
        ))}
        {days.length === 0 ? <div className="wf-subtle">No clock-ins for these dates.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>{['Day', 'Technician', 'Clock', 'Time', '', ''].map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '6px', fontSize: 11.5, color: '#5E6470', fontWeight: 600 }}>{h}</th>)}</tr></thead>
              <tbody>
                {days.flatMap((d) => d.list.map((p, i) => (
                  <tr key={p.id} style={{ borderTop: '1px solid #ECE8DF' }}>
                    <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{i === 0 ? fmtDay(d.day) : ''}</td>
                    <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{i === 0 ? d.tech : ''}</td>
                    <td style={{ padding: '4px 6px' }}>{p.kind === 'in' ? 'Clock in' : 'Clock out'}</td>
                    <td style={{ padding: '4px 6px' }}>
                      <input key={`${p.id}:${p.at}`} type="time" className="wf-input" style={{ minHeight: 30, padding: '2px 6px' }} defaultValue={clockOf(p.at, TZ)}
                        aria-label={`clock ${p.kind} ${p.contractor_name} ${d.day}`} onBlur={(e) => void move(p, e.target.value)} />
                    </td>
                    <td className="wf-subtle" style={{ padding: '4px 6px', fontSize: 12 }}>
                      {p.by_office ? 'Added by the office' : p.tapped_at ? `Tapped ${clockOf(p.tapped_at, TZ)}, moved by the office` : 'From the app'}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                      <button className="wf-btn wf-btn-ghost wf-btn-sm" aria-label={`remove clock ${p.kind} ${p.contractor_name} ${d.day}`} onClick={() => void remove(p)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="wf-label" style={{ flexBasis: '100%' }}>Add one the app missed</span>
          <input className="wf-input" list="clock-techs" style={{ minHeight: 32, padding: '2px 8px', width: 180 }} value={tech} onChange={(e) => setTech(e.target.value)} aria-label="technician" placeholder="Technician" />
          <datalist id="clock-techs">{techs.map((t) => <option key={t} value={t} />)}</datalist>
          <select className="wf-input" style={{ minHeight: 32, padding: '2px 6px' }} value={kind} onChange={(e) => setKind(e.target.value as 'in' | 'out')} aria-label="clock in or out">
            <option value="in">Clock in</option><option value="out">Clock out</option>
          </select>
          <input type="date" className="wf-input" style={{ minHeight: 32, padding: '2px 6px' }} value={day} onChange={(e) => setDay(e.target.value)} aria-label="day" />
          <input type="time" className="wf-input" style={{ minHeight: 32, padding: '2px 6px' }} value={time} onChange={(e) => setTime(e.target.value)} aria-label="time" />
          <button className="wf-btn wf-btn-gold wf-btn-sm" disabled={busy || !time || !tech.trim()} onClick={() => void add()}><Plus size={15} /> Add</button>
        </div>
        {!hasOffice && <div className="wf-subtle" style={{ fontSize: 12.5 }}>Changing the clock needs the database update (migration 139).</div>}
      </div>
    </Section>
  );
}
