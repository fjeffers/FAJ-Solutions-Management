'use client';
// Preventive maintenance and the site asset register — the CMMS.
//
// A CMMS normally tracks equipment you own. Fred does not own the racks,
// switches and cameras he works on; they belong to his clients' sites. So the
// register is per site, and the screen leads with the only question that
// actually drives work: what is due, and what is late.
//
// A due task turns into a site visit, because maintenance that never becomes
// billable work is just a reminder.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wrench, Plus, Trash2, X, CalendarCheck, CircleCheck, Boxes, AlertTriangle, Pause, Play,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import type { Asset, MaintenancePlan } from '@/lib/types';
import {
  dueState, duePhrase, sortByUrgency, dueSummary, markDone, nextDue, siteLabel,
  visitFromPlan, todayISO, DUE_STATE_LABEL, DUE_STATE_COLOR, INTERVAL_PRESETS,
  ASSET_TYPES, ASSET_STATUS_LABEL,
} from '@/lib/maintenance';
import { backdropClose } from '@/lib/backdrop';

type Tab = 'due' | 'assets';

export default function MaintenanceView() {
  const supabase = createClient();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [plans, setPlans] = useState<MaintenancePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('due');
  const [editingAsset, setEditingAsset] = useState<Partial<Asset> | null>(null);
  const [editingPlan, setEditingPlan] = useState<Partial<MaintenancePlan> | null>(null);

  const load = useCallback(async () => {
    const [aRes, pRes] = await Promise.all([
      supabase.from('assets').select('*').order('program').order('site_code').order('name'),
      supabase.from('maintenance_plans').select('*'),
    ]);
    if (aRes.error || pRes.error) toastError("Couldn't load maintenance. Check your connection and refresh.");
    if (aRes.data) setAssets(aRes.data as Asset[]);
    if (pRes.data) setPlans(pRes.data as MaintenancePlan[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const today = todayISO();
  const summary = useMemo(() => dueSummary(plans, today), [plans, today]);
  const queue = useMemo(() => sortByUrgency(plans, today), [plans, today]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const userId = async () => (await supabase.auth.getUser()).data.user?.id ?? null;

  // ── Assets ────────────────────────────────────────────────────────────────
  const saveAsset = async (a: Partial<Asset>) => {
    const uid = await userId();
    if (!uid) return;
    const payload = {
      user_id: uid,
      program: a.program?.trim() || null,
      site_code: a.site_code?.trim() || null,
      site_name: a.site_name?.trim() || null,
      name: a.name?.trim() || 'Untitled',
      asset_type: a.asset_type || null,
      manufacturer: a.manufacturer?.trim() || null,
      model: a.model?.trim() || null,
      serial: a.serial?.trim() || null,
      location_in_site: a.location_in_site?.trim() || null,
      installed_on: a.installed_on || null,
      status: a.status ?? 'active',
      notes: a.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = a.id
      ? await supabase.from('assets').update(payload).eq('id', a.id)
      : await supabase.from('assets').insert(payload);
    if (error) { toastError(`Couldn't save: ${error.message}`); return; }
    toastSuccess(`${payload.name} saved`);
    setEditingAsset(null);
    await load();
  };

  const deleteAsset = async (a: Asset) => {
    if (!confirm(`Delete ${a.name}? Any maintenance scheduled against it goes too.`)) return;
    const { error } = await supabase.from('assets').delete().eq('id', a.id);
    if (error) { toastError(`Couldn't delete: ${error.message}`); return; }
    toastSuccess(`${a.name} removed`);
    await load();
  };

  // ── Plans ─────────────────────────────────────────────────────────────────
  const savePlan = async (p: Partial<MaintenancePlan>) => {
    const uid = await userId();
    if (!uid) return;
    // A task against an asset inherits that asset's site, so the two can never
    // claim to be at different places.
    const asset = p.asset_id ? assetById.get(p.asset_id) : null;
    const payload = {
      user_id: uid,
      asset_id: p.asset_id || null,
      program: asset?.program ?? p.program?.trim() ?? null,
      site_code: asset?.site_code ?? p.site_code?.trim() ?? null,
      site_name: asset?.site_name ?? p.site_name?.trim() ?? null,
      task: p.task?.trim() || 'Maintenance',
      interval_days: Number(p.interval_days) > 0 ? Number(p.interval_days) : 90,
      last_done_on: p.last_done_on || null,
      next_due_on: p.next_due_on || null,
      active: p.active ?? true,
      notes: p.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = p.id
      ? await supabase.from('maintenance_plans').update(payload).eq('id', p.id)
      : await supabase.from('maintenance_plans').insert(payload);
    if (error) { toastError(`Couldn't save: ${error.message}`); return; }
    toastSuccess(`"${payload.task}" saved`);
    setEditingPlan(null);
    await load();
  };

  const deletePlan = async (p: MaintenancePlan) => {
    if (!confirm(`Stop scheduling "${p.task}"? Its history is kept.`)) return;
    const { error } = await supabase.from('maintenance_plans').delete().eq('id', p.id);
    if (error) { toastError(`Couldn't delete: ${error.message}`); return; }
    toastSuccess('Task removed');
    await load();
  };

  const togglePlan = async (p: MaintenancePlan) => {
    const { error } = await supabase.from('maintenance_plans')
      .update({ active: !p.active, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { toastError(error.message); return; }
    await load();
  };

  /**
   * Complete a task. Optionally raise the site visit at the same time, so the
   * work is logged where everything else is and can be priced and billed.
   */
  const complete = async (p: MaintenancePlan, withVisit: boolean) => {
    const uid = await userId();
    if (!uid) return;
    const done = markDone(p, today);

    let visitId: string | null = null;
    if (withVisit) {
      const asset = p.asset_id ? assetById.get(p.asset_id) ?? null : null;
      const { data, error } = await supabase.from('site_visits')
        .insert({ user_id: uid, ...visitFromPlan(p, asset, today) })
        .select('id').single();
      if (error) { toastError(`Couldn't create the visit: ${error.message}`); return; }
      visitId = (data?.id as string) ?? null;
    }

    const { error } = await supabase.from('maintenance_plans')
      .update({ ...done, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { toastError(`Couldn't update the schedule: ${error.message}`); return; }

    // The history is a record of each time it was done, not a date that gets
    // overwritten — so a site's maintenance can actually be looked back over.
    await supabase.from('maintenance_events').insert({
      user_id: uid, plan_id: p.id, asset_id: p.asset_id, site_visit_id: visitId, done_on: today,
    });

    toastSuccess(withVisit
      ? `Logged — a visit is now on the Site Log, and "${p.task}" is next due ${done.next_due_on}`
      : `"${p.task}" marked done — next due ${done.next_due_on}`);
    await load();
  };

  if (loading) {
    return <div className="view-inner" style={{ color: '#999', padding: 40 }}>Loading maintenance…</div>;
  }

  const sitesWithAssets = [...new Map(assets.map((a) => [siteLabel(a), a])).keys()];

  return (
    <div className="view-inner">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div className="display" style={{ fontSize: 10, color: 'var(--teal)', letterSpacing: 2 }}>MAINTENANCE</div>
          <h1 className="serif" style={{ fontSize: 26, margin: '2px 0 0', fontWeight: 600 }}>
            Site equipment &amp; recurring work
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => setEditingAsset({ status: 'active' })}>
            <Plus size={14} /> Add Equipment
          </button>
          <button className="btn btn-primary" onClick={() => setEditingPlan({ interval_days: 90, active: true })}>
            <Plus size={14} /> Schedule Work
          </button>
        </div>
      </div>

      {/* The four numbers that decide what happens this week. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Tile label="Overdue" value={summary.overdue} color="#b91c1c" icon={<AlertTriangle size={14} />} />
        <Tile label="Due now" value={summary.due} color="#c2410c" icon={<CalendarCheck size={14} />} />
        <Tile label="Coming up" value={summary.soon} color="#b45309" icon={<CalendarCheck size={14} />} />
        <Tile label="Equipment tracked" value={assets.length} color="var(--teal)" icon={<Boxes size={14} />}
          sub={sitesWithAssets.length ? `${sitesWithAssets.length} site${sitesWithAssets.length !== 1 ? 's' : ''}` : undefined} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={`filter-chip ${tab === 'due' ? 'active' : ''}`} onClick={() => setTab('due')}>
          What&apos;s due ({plans.length})
        </button>
        <button className={`filter-chip ${tab === 'assets' ? 'active' : ''}`} onClick={() => setTab('assets')}>
          Equipment ({assets.length})
        </button>
      </div>

      {tab === 'due' && (
        plans.length === 0 ? (
          <Empty
            icon={<Wrench size={26} color="#ddd" />}
            title="Nothing scheduled yet"
            body="Schedule the work that repeats — cleaning cameras, checking menu boards, rack tidies — and this becomes the list of what is due and what is late."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {queue.map((p) => {
              const st = dueState(p, today);
              const c = DUE_STATE_COLOR[st];
              const asset = p.asset_id ? assetById.get(p.asset_id) : null;
              const due = nextDue(p);
              return (
                <div key={p.id} className="glass card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                      <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 800, background: c.bg, color: c.color }}>
                        {DUE_STATE_LABEL[st]}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{p.task}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      {siteLabel(p)}
                      {asset ? ` · ${asset.name}` : ''}
                      {' · every '}{p.interval_days} days
                      {due ? ` · due ${due}` : ''}
                      <strong style={{ color: c.color, marginLeft: 6 }}>{duePhrase(p, today)}</strong>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 12px' }}
                      title="Create the site visit and mark this done — the visit lands on the Site Log ready to price"
                      onClick={() => void complete(p, true)}>
                      <CalendarCheck size={13} /> Log visit
                    </button>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 12px' }}
                      title="Mark done without raising a visit"
                      onClick={() => void complete(p, false)}>
                      <CircleCheck size={13} /> Done
                    </button>
                    <button className="icon-btn" title={p.active ? 'Pause this schedule' : 'Resume this schedule'}
                      onClick={() => void togglePlan(p)}>
                      {p.active ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button className="icon-btn" title="Edit" onClick={() => setEditingPlan(p)}><Wrench size={14} /></button>
                    <button className="icon-btn" title="Delete" style={{ color: '#b91c1c' }} onClick={() => void deletePlan(p)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === 'assets' && (
        assets.length === 0 ? (
          <Empty
            icon={<Boxes size={26} color="#ddd" />}
            title="No equipment recorded"
            body="Record what is installed at each site — racks, switches, cameras, menu boards — so a call about a fault starts from what is actually there."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groupAssets(assets).map(([label, rows]) => (
              <div key={label}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#888', marginBottom: 8 }}>
                  {label} <span style={{ color: '#bbb' }}>· {rows.length} item{rows.length !== 1 ? 's' : ''}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rows.map((a) => {
                    const onIt = plans.filter((p) => p.asset_id === a.id);
                    return (
                      <div key={a.id} className="glass card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: 'pointer' }}
                        onClick={() => setEditingAsset(a)}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>
                            {a.name}
                            {a.status !== 'active' && (
                              <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                                background: a.status === 'needs_repair' ? 'rgba(239,68,68,0.13)' : 'rgba(0,0,0,0.06)',
                                color: a.status === 'needs_repair' ? '#b91c1c' : '#6b7280' }}>
                                {ASSET_STATUS_LABEL[a.status]}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: '#888' }}>
                            {[a.asset_type, a.manufacturer, a.model, a.serial ? `SN ${a.serial}` : null, a.location_in_site]
                              .filter(Boolean).join(' · ') || 'No details yet'}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: onIt.length ? 'var(--teal)' : '#bbb', whiteSpace: 'nowrap' }}>
                          {onIt.length ? `${onIt.length} scheduled task${onIt.length !== 1 ? 's' : ''}` : 'no schedule'}
                        </div>
                        <button className="icon-btn" title="Delete" style={{ color: '#b91c1c' }}
                          onClick={(e) => { e.stopPropagation(); void deleteAsset(a); }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {editingAsset && (
        <AssetModal item={editingAsset} onSave={saveAsset} onClose={() => setEditingAsset(null)} />
      )}
      {editingPlan && (
        <PlanModal item={editingPlan} assets={assets} onSave={savePlan} onClose={() => setEditingPlan(null)} />
      )}
    </div>
  );
}

function groupAssets(assets: Asset[]): [string, Asset[]][] {
  const m = new Map<string, Asset[]>();
  for (const a of assets) {
    const k = [a.program, siteLabel(a)].filter(Boolean).join(' · ');
    m.set(k, [...(m.get(k) ?? []), a]);
  }
  return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0]));
}

function Tile({ label, value, color, icon, sub }: { label: string; value: number; color: string; icon: React.ReactNode; sub?: string }) {
  return (
    <div className="glass card" style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        <span style={{ color }}>{icon}</span>{label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#aaa' }}>{sub}</div>}
    </div>
  );
}

function Empty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="glass card" style={{ textAlign: 'center', padding: '48px 24px', color: '#aaa' }}>
      <div style={{ marginBottom: 10 }}>{icon}</div>
      <div style={{ fontWeight: 700, color: '#666', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, maxWidth: 460, margin: '0 auto', lineHeight: 1.7 }}>{body}</div>
    </div>
  );
}

const LBL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555',
  textTransform: 'uppercase', display: 'block', marginBottom: 5,
};

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={LBL}>{label}</label>{children}</div>;
}

function AssetModal({ item, onSave, onClose }: {
  item: Partial<Asset>;
  onSave: (a: Partial<Asset>) => Promise<void>;
  onClose: () => void;
}) {
  const [f, setF] = useState<Partial<Asset>>(item);
  const set = <K extends keyof Asset>(k: K, v: Asset[K]) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="modal-overlay" {...backdropClose(onClose)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <Head title={item.id ? 'Edit equipment' : 'Add equipment'} onClose={onClose} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <F label="What is it *">
            <input className="input" value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Drive-thru camera, 4U rack" />
          </F>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <F label="Customer">
              <input className="input" value={f.program ?? ''} onChange={(e) => set('program', e.target.value)} placeholder="Wendy's" />
            </F>
            <F label="Type">
              <select className="input" value={f.asset_type ?? ''} onChange={(e) => set('asset_type', e.target.value)}>
                <option value="">—</option>
                {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </F>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <F label="Site #"><input className="input" value={f.site_code ?? ''} onChange={(e) => set('site_code', e.target.value)} placeholder="1331" /></F>
            <F label="Site name"><input className="input" value={f.site_name ?? ''} onChange={(e) => set('site_name', e.target.value)} placeholder="Hillside" /></F>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <F label="Make"><input className="input" value={f.manufacturer ?? ''} onChange={(e) => set('manufacturer', e.target.value)} /></F>
            <F label="Model"><input className="input" value={f.model ?? ''} onChange={(e) => set('model', e.target.value)} /></F>
            <F label="Serial"><input className="input" value={f.serial ?? ''} onChange={(e) => set('serial', e.target.value)} /></F>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <F label="Where on site"><input className="input" value={f.location_in_site ?? ''} onChange={(e) => set('location_in_site', e.target.value)} placeholder="Manager's office" /></F>
            <F label="Installed"><input className="input" type="date" value={f.installed_on ?? ''} onChange={(e) => set('installed_on', e.target.value)} /></F>
            <F label="Condition">
              <select className="input" value={f.status ?? 'active'} onChange={(e) => set('status', e.target.value as Asset['status'])}>
                <option value="active">Active</option>
                <option value="needs_repair">Needs repair</option>
                <option value="retired">Retired</option>
              </select>
            </F>
          </div>
          <F label="Notes"><textarea className="input" rows={2} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></F>
          <Foot disabled={!f.name?.trim()} onClose={onClose} onSave={() => onSave(f)} label={item.id ? 'Save' : 'Add equipment'} />
        </div>
      </div>
    </div>
  );
}

function PlanModal({ item, assets, onSave, onClose }: {
  item: Partial<MaintenancePlan>;
  assets: Asset[];
  onSave: (p: Partial<MaintenancePlan>) => Promise<void>;
  onClose: () => void;
}) {
  const [f, setF] = useState<Partial<MaintenancePlan>>(item);
  const set = <K extends keyof MaintenancePlan>(k: K, v: MaintenancePlan[K]) => setF((p) => ({ ...p, [k]: v }));
  const asset = f.asset_id ? assets.find((a) => a.id === f.asset_id) : null;
  return (
    <div className="modal-overlay" {...backdropClose(onClose)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <Head title={item.id ? 'Edit scheduled work' : 'Schedule recurring work'} onClose={onClose} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <F label="What needs doing *">
            <input className="input" value={f.task ?? ''} onChange={(e) => set('task', e.target.value)} placeholder="e.g. Clean all cameras" />
          </F>

          <F label="Against a specific piece of equipment (optional)">
            <select className="input" value={f.asset_id ?? ''} onChange={(e) => set('asset_id', e.target.value || null)}>
              <option value="">The site as a whole</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name} — {siteLabel(a)}</option>)}
            </select>
          </F>

          {/* Site is only asked for when the task is not tied to equipment;
              otherwise it follows the asset and cannot disagree with it. */}
          {!asset && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <F label="Customer"><input className="input" value={f.program ?? ''} onChange={(e) => set('program', e.target.value)} placeholder="Wendy's" /></F>
              <F label="Site #"><input className="input" value={f.site_code ?? ''} onChange={(e) => set('site_code', e.target.value)} /></F>
              <F label="Site name"><input className="input" value={f.site_name ?? ''} onChange={(e) => set('site_name', e.target.value)} /></F>
            </div>
          )}

          <F label="How often">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="input" type="number" min={1} style={{ width: 90 }}
                value={f.interval_days ?? 90}
                onChange={(e) => set('interval_days', Number(e.target.value))} />
              <span style={{ fontSize: 12, color: '#888' }}>days</span>
              {INTERVAL_PRESETS.map((p) => (
                <button key={p.days} type="button" className="filter-chip"
                  onClick={() => set('interval_days', p.days)}>{p.label}</button>
              ))}
            </div>
          </F>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <F label="Last done"><input className="input" type="date" value={f.last_done_on ?? ''} onChange={(e) => set('last_done_on', e.target.value || null)} /></F>
            <F label="Next due (leave blank to work it out)">
              <input className="input" type="date" value={f.next_due_on ?? ''} onChange={(e) => set('next_due_on', e.target.value || null)} />
            </F>
          </div>

          <div style={{ fontSize: 12, color: '#666', background: 'rgba(14,27,46,0.06)', padding: '9px 12px', borderRadius: 8 }}>
            {nextDue(f as MaintenancePlan)
              ? <>Next due <strong>{nextDue(f as MaintenancePlan)}</strong> — {duePhrase({ ...f, active: true } as MaintenancePlan)}</>
              : 'No due date yet. Put in when it was last done, or set the next date.'}
          </div>

          <F label="Notes"><textarea className="input" rows={2} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></F>
          <Foot disabled={!f.task?.trim()} onClose={onClose} onSave={() => onSave(f)} label={item.id ? 'Save' : 'Schedule it'} />
        </div>
      </div>
    </div>
  );
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
      <h2 className="serif" style={{ fontSize: 21, margin: 0, fontWeight: 600 }}>{title}</h2>
      <button className="icon-btn" onClick={onClose}><X size={18} /></button>
    </div>
  );
}

function Foot({ disabled, onClose, onSave, label }: {
  disabled: boolean; onClose: () => void; onSave: () => Promise<void> | void; label: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 10, borderTop: '1px solid #eee' }}>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={disabled || busy} style={{ opacity: disabled || busy ? 0.55 : 1 }}
        onClick={async () => { setBusy(true); await onSave(); setBusy(false); }}>
        {busy ? 'Saving…' : label}
      </button>
    </div>
  );
}
