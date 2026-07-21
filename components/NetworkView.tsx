'use client';
// Network documentation — web version of the "Office Labeling & Mapping
// Tracker" sheet. A site owns switches and patch panels; each drop is one
// room/jack record. The Switches and Patch Panels tabs render live port maps
// derived from drops, so free/used/conflicting ports are visible at a glance.
// Self-contained: loads and saves its own data (migration-034 tables).
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import { genTargetLabel } from '@/lib/network';
import type { NetworkProject, NetworkSite, NetworkSwitch, NetworkPatchPanel, NetworkDrop, NetworkDropStatus } from '@/lib/types';
import { Plus, Edit2, Trash2, X, Search, AlertTriangle, Server, Cable, Network, Tag } from 'lucide-react';
import FloorPlanView from '@/components/FloorPlanView';

const DEFAULT_SCHEME = '{room}-{jack}';

const STATUS_META: Record<NetworkDropStatus, { label: string; color: string; bg: string }> = {
  active:        { label: 'In Use',        color: '#047857', bg: 'rgba(16,185,129,0.1)' },
  needs_label:   { label: 'Needs Label',   color: '#b45309', bg: 'rgba(245,158,11,0.12)' },
  office_closed: { label: 'Office Closed', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
};

type Tab = 'drops' | 'switches' | 'panels' | 'plan';

type ModalState =
  | { type: 'project'; item: Partial<NetworkProject> }
  | { type: 'site'; item: Partial<NetworkSite> }
  | { type: 'switch'; item: Partial<NetworkSwitch> }
  | { type: 'panel'; item: Partial<NetworkPatchPanel> }
  | { type: 'drop'; item: Partial<NetworkDrop> }
  | null;

export default function NetworkView() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<NetworkProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sites, setSites] = useState<NetworkSite[]>([]);
  const [switches, setSwitches] = useState<NetworkSwitch[]>([]);
  const [panels, setPanels] = useState<NetworkPatchPanel[]>([]);
  const [drops, setDrops] = useState<NetworkDrop[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('drops');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<ModalState>(null);

  const load = async () => {
    const [pRes, sRes, swRes, ppRes, dRes] = await Promise.all([
      supabase.from('network_projects').select('*').order('name'),
      supabase.from('network_sites').select('*').order('name'),
      supabase.from('network_switches').select('*').order('name'),
      supabase.from('network_patch_panels').select('*').order('name'),
      supabase.from('network_drops').select('*').order('room'),
    ]);
    if (pRes.data) setProjects(pRes.data as NetworkProject[]);
    if (sRes.data) setSites(sRes.data as NetworkSite[]);
    if (swRes.data) setSwitches(swRes.data as NetworkSwitch[]);
    if (ppRes.data) setPanels(ppRes.data as NetworkPatchPanel[]);
    if (dRes.data) setDrops(dRes.data as NetworkDrop[]);
    if (pRes.error || sRes.error || swRes.error || ppRes.error || dRes.error) {
      toastError("Couldn't load network data. Check your connection and refresh.");
    }
    // Opens blank on purpose — no auto-selected project. Keep current
    // selections only while they still exist; floor must belong to project.
    const plist = (pRes.data as NetworkProject[] | null) ?? [];
    const slist = (sRes.data as NetworkSite[] | null) ?? [];
    setProjectId((prevP) => {
      const p = prevP && plist.some((x) => x.id === prevP) ? prevP : null;
      setSiteId((prevS) => {
        if (prevS && slist.some((s) => s.id === prevS && s.project_id === p)) return prevS;
        return p ? (slist.find((s) => s.project_id === p)?.id ?? null) : null;
      });
      return p;
    });
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const selectSite = (id: string | null) => setSiteId(id);
  const selectProject = (id: string | null) => {
    setProjectId(id);
    setSiteId(id ? (sites.find((s) => s.project_id === id)?.id ?? null) : null);
  };

  // ── CRUD ────────────────────────────────────────────────────────────────
  const saveRow = async (table: string, payload: Record<string, unknown>, label: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { id, created_at: _c, updated_at: _u, user_id: _uid, ...rest } = payload;
    let res;
    if (id) {
      res = await supabase.from(table).update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id);
    } else {
      const ins = await supabase.from(table).insert({ ...rest, user_id: user.id }).select('id').single();
      res = ins;
      // Jump straight into a freshly created project or floor
      if (!ins.error && ins.data) {
        const newId = (ins.data as { id: string }).id;
        if (table === 'network_projects') { setProjectId(newId); setSiteId(null); }
        if (table === 'network_sites') setSiteId(newId);
      }
    }
    if (res.error) { toastError(`Couldn't save ${label}: ${res.error.message}`); return; }
    toastSuccess(`${label} saved`);
    setModal(null);
    await load();
  };

  const deleteRow = async (table: string, id: string, label: string) => {
    const res = await supabase.from(table).delete().eq('id', id);
    if (res.error) { toastError(`Couldn't delete ${label}: ${res.error.message}`); return; }
    toastSuccess(`${label} deleted`);
    setModal(null);
    await load();
  };

  // ── Derived data for the selected project / floor ───────────────────────
  const project = projects.find((p) => p.id === projectId) ?? null;
  const floors = useMemo(() => sites.filter((s) => s.project_id === projectId), [sites, projectId]);
  const site = sites.find((s) => s.id === siteId) ?? null;
  const siteSwitches = useMemo(() => switches.filter((s) => s.site_id === siteId), [switches, siteId]);
  const sitePanels = useMemo(() => panels.filter((p) => p.site_id === siteId), [panels, siteId]);
  const siteDrops = useMemo(() => drops.filter((d) => d.site_id === siteId), [drops, siteId]);

  const dropsBySwitchPort = useMemo(() => {
    const m = new Map<string, NetworkDrop[]>();
    for (const d of siteDrops) {
      if (d.switch_id && d.switch_port != null) {
        const k = `${d.switch_id}:${d.switch_port}`;
        m.set(k, [...(m.get(k) ?? []), d]);
      }
    }
    return m;
  }, [siteDrops]);

  const dropsByPanelPort = useMemo(() => {
    const m = new Map<string, NetworkDrop[]>();
    for (const d of siteDrops) {
      if (d.patch_panel_id && d.panel_port != null) {
        const k = `${d.patch_panel_id}:${d.panel_port}`;
        m.set(k, [...(m.get(k) ?? []), d]);
      }
    }
    return m;
  }, [siteDrops]);

  const switchPortsUsed = useMemo(() => {
    let used = 0;
    for (const sw of siteSwitches) {
      for (let p = 1; p <= sw.port_count; p++) if (dropsBySwitchPort.has(`${sw.id}:${p}`)) used++;
    }
    return used;
  }, [siteSwitches, dropsBySwitchPort]);
  const switchPortsTotal = siteSwitches.reduce((sum, sw) => sum + sw.port_count, 0);
  const needsLabelCount = siteDrops.filter((d) => d.status === 'needs_label').length;
  const relabelable = siteDrops.filter((d) => d.status !== 'office_closed');
  const relabeledCount = relabelable.filter((d) => d.target_label).length;

  // Fill empty target labels for the whole site from its label scheme.
  const generateTargets = async () => {
    if (!site) return;
    const scheme = site.label_scheme || DEFAULT_SCHEME;
    const missing = relabelable.filter((d) => !d.target_label && d.room.trim() !== '');
    if (missing.length === 0) { toastSuccess('Every drop already has a target label.'); return; }
    if (!confirm(`Generate new labels for ${missing.length} drop${missing.length !== 1 ? 's' : ''} using the scheme "${scheme}"? Drops that already have a target label are left alone.`)) return;
    const now = new Date().toISOString();
    const results = await Promise.all(missing.map((d) =>
      supabase.from('network_drops')
        .update({ target_label: genTargetLabel(d.room, d.jacks, scheme), updated_at: now })
        .eq('id', d.id)));
    const failed = results.filter((r) => r.error).length;
    if (failed > 0) toastError(`${failed} of ${missing.length} labels failed to save.`);
    else toastSuccess(`Generated ${missing.length} target label${missing.length !== 1 ? 's' : ''}.`);
    await load();
  };

  const filteredDrops = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? siteDrops.filter((d) =>
          [d.room, d.assigned_to, d.wall_jack_label, d.area_zone, d.notes]
            .some((v) => v?.toLowerCase().includes(needle)))
      : siteDrops;
    return [...rows].sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
  }, [siteDrops, q]);

  const switchName = (id: string | null) => siteSwitches.find((s) => s.id === id)?.name ?? null;
  const panelName = (id: string | null) => sitePanels.find((p) => p.id === id)?.name ?? null;

  if (loading) {
    return <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto', color: '#999', padding: 40 }}>Loading network…</div>;
  }

  return (
    <div className="view-inner" style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>FIELD OPS</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Network</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
            {site ? (
              <>
                {siteDrops.length} drop{siteDrops.length !== 1 ? 's' : ''} · {switchPortsUsed}/{switchPortsTotal} switch ports in use
                · {relabeledCount}/{relabelable.length} relabeled
                {needsLabelCount > 0 && <span style={{ color: '#b45309', fontWeight: 600 }}> · {needsLabelCount} need labels</span>}
              </>
            ) : projects.length > 0 ? 'Select a project and floor to view its port mappings.' : 'Track switch and patch panel port mappings per project.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {projects.length > 0 && (
            <select className="input" style={{ width: 'auto', minWidth: 170 }} value={projectId ?? ''} onChange={(e) => selectProject(e.target.value || null)}>
              <option value="">— Select project —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {project && (
            <button className="btn btn-ghost" title="Edit project" onClick={() => setModal({ type: 'project', item: project })}><Edit2 size={14} /></button>
          )}
          <button className="btn btn-ghost" onClick={() => setModal({ type: 'project', item: {} })}><Plus size={14} /> Project</button>
          {project && (
            <>
              <select className="input" style={{ width: 'auto', minWidth: 130 }} value={siteId ?? ''} onChange={(e) => selectSite(e.target.value || null)}>
                <option value="">— Floor —</option>
                {floors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {site && (
                <button className="btn btn-ghost" title="Edit floor" onClick={() => setModal({ type: 'site', item: site })}><Edit2 size={14} /></button>
              )}
              <button className="btn btn-ghost" onClick={() => setModal({ type: 'site', item: { project_id: project.id } })}><Plus size={14} /> Floor</button>
            </>
          )}
        </div>
      </div>

      {!site ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          <Network size={28} color="#ddd" style={{ marginBottom: 8 }} />
          {projects.length === 0 ? (
            <>
              <div style={{ marginBottom: 12 }}>No projects yet. Create one to start mapping ports.</div>
              <button className="btn btn-primary" onClick={() => setModal({ type: 'project', item: {} })}><Plus size={14} /> New Project</button>
            </>
          ) : !project ? (
            <div>Select a project above to view its network — or add a new one with + Project.</div>
          ) : floors.length === 0 ? (
            <>
              <div style={{ marginBottom: 12 }}>No floors in {project.name} yet.</div>
              <button className="btn btn-primary" onClick={() => setModal({ type: 'site', item: { project_id: project.id } })}><Plus size={14} /> Add Floor</button>
            </>
          ) : (
            <div>Select a floor above.</div>
          )}
        </div>
      ) : (
        <>
          {/* Sub-tabs + actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            <button className={`filter-chip ${tab === 'drops' ? 'active' : ''}`} onClick={() => setTab('drops')}>Drops</button>
            <button className={`filter-chip ${tab === 'switches' ? 'active' : ''}`} onClick={() => setTab('switches')}>Switches</button>
            <button className={`filter-chip ${tab === 'panels' ? 'active' : ''}`} onClick={() => setTab('panels')}>Patch Panels</button>
            <button className={`filter-chip ${tab === 'plan' ? 'active' : ''}`} onClick={() => setTab('plan')}>Floor Plan</button>
            <div style={{ flex: 1 }} />
            {tab === 'drops' && (
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
                <input className="input" style={{ paddingLeft: 30, width: 200 }} placeholder="Search room, name, label…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            )}
            {tab === 'drops' && (
              <button className="btn btn-ghost" title={`Fill empty target labels using the site scheme "${site.label_scheme || DEFAULT_SCHEME}"`} onClick={generateTargets}>
                <Tag size={14} /> Generate Labels
              </button>
            )}
            {tab === 'drops' && <button className="btn btn-primary" onClick={() => setModal({ type: 'drop', item: { site_id: site.id, status: 'active' } })}><Plus size={14} /> Add Drop</button>}
            {tab === 'switches' && <button className="btn btn-primary" onClick={() => setModal({ type: 'switch', item: { site_id: site.id, port_count: 48 } })}><Plus size={14} /> Add Switch</button>}
            {tab === 'panels' && <button className="btn btn-primary" onClick={() => setModal({ type: 'panel', item: { site_id: site.id, port_count: 24 } })}><Plus size={14} /> Add Panel</button>}
          </div>

          {tab === 'drops' && (
            <DropsTable
              drops={filteredDrops}
              switchName={switchName}
              panelName={panelName}
              onEdit={(d) => setModal({ type: 'drop', item: d })}
              onDelete={(d) => { if (confirm(`Delete drop for room "${d.room}"?`)) deleteRow('network_drops', d.id, 'Drop'); }}
            />
          )}

          {tab === 'switches' && (
            siteSwitches.length === 0 ? (
              <EmptyCard icon={<Server size={28} color="#ddd" />} text="No switches yet." />
            ) : (
              siteSwitches.map((sw) => (
                <PortMapCard
                  key={sw.id}
                  title={sw.name}
                  subtitle={[sw.model, sw.location].filter(Boolean).join(' · ')}
                  notes={sw.notes}
                  portCount={sw.port_count}
                  dropsForPort={(p) => dropsBySwitchPort.get(`${sw.id}:${p}`) ?? []}
                  onEditMeta={() => setModal({ type: 'switch', item: sw })}
                  onDeleteMeta={() => {
                    if (confirm(`Delete "${sw.name}"? Drops keep their records but lose the switch/port link.`)) deleteRow('network_switches', sw.id, 'Switch');
                  }}
                  onPortClick={(p, portDrops) => {
                    if (portDrops.length > 0) setModal({ type: 'drop', item: portDrops[0] });
                    else setModal({ type: 'drop', item: { site_id: site.id, status: 'active', switch_id: sw.id, switch_port: p } });
                  }}
                />
              ))
            )
          )}

          {tab === 'plan' && (
            <FloorPlanView key={site.id} site={site} drops={siteDrops} projectName={project?.name ?? ''} onSaved={load} />
          )}

          {tab === 'panels' && (
            sitePanels.length === 0 ? (
              <EmptyCard icon={<Cable size={28} color="#ddd" />} text="No patch panels yet." />
            ) : (
              sitePanels.map((pp) => {
                const untraced = siteDrops
                  .filter((d) => d.patch_panel_id === pp.id && d.panel_port == null)
                  .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
                return (
                  <PortMapCard
                    key={pp.id}
                    title={`Panel ${pp.name}`}
                    subtitle={pp.location ?? ''}
                    notes={pp.notes}
                    portCount={pp.port_count}
                    dropsForPort={(p) => dropsByPanelPort.get(`${pp.id}:${p}`) ?? []}
                    onEditMeta={() => setModal({ type: 'panel', item: pp })}
                    onDeleteMeta={() => {
                      if (confirm(`Delete panel "${pp.name}"? Drops keep their records but lose the panel/port link.`)) deleteRow('network_patch_panels', pp.id, 'Patch panel');
                    }}
                    onPortClick={(p, portDrops) => {
                      if (portDrops.length > 0) setModal({ type: 'drop', item: portDrops[0] });
                      else setModal({ type: 'drop', item: { site_id: site.id, status: 'active', patch_panel_id: pp.id, panel_port: p } });
                    }}
                    footer={untraced.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #eee' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                          On this panel, port # not traced yet — click to assign
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {untraced.map((d) => (
                            <button key={d.id} onClick={() => setModal({ type: 'drop', item: d })}
                              style={{ border: '1px solid #f0e0c8', background: 'rgba(245,158,11,0.08)', color: '#92400e', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                              {d.room}{d.assigned_to ? ` · ${d.assigned_to}` : ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  />
                );
              })
            )
          )}
        </>
      )}

      {/* Modals */}
      {modal?.type === 'project' && (
        <EntityModal
          title={modal.item.id ? 'Edit Project' : 'New Project'}
          onClose={() => setModal(null)}
          onDelete={modal.item.id ? () => {
            if (confirm(`Delete project "${modal.item.name}" and ALL its floors, switches, panels, and drops? This can't be undone.`)) {
              deleteRow('network_projects', modal.item.id!, 'Project');
            }
          } : undefined}
        >
          {(close) => <ProjectForm item={modal.item} onSave={(p) => saveRow('network_projects', p, 'Project')} onCancel={close} />}
        </EntityModal>
      )}
      {modal?.type === 'site' && (
        <EntityModal
          title={modal.item.id ? 'Edit Floor' : 'Add Floor'}
          onClose={() => setModal(null)}
          onDelete={modal.item.id ? () => {
            if (confirm(`Delete floor "${modal.item.name}" and ALL its switches, panels, and drops? This can't be undone.`)) {
              deleteRow('network_sites', modal.item.id!, 'Floor');
            }
          } : undefined}
        >
          {(close) => <SiteForm item={modal.item} onSave={(p) => saveRow('network_sites', p, 'Floor')} onCancel={close} />}
        </EntityModal>
      )}
      {modal?.type === 'switch' && (
        <EntityModal title={modal.item.id ? 'Edit Switch' : 'Add Switch'} onClose={() => setModal(null)}>
          {(close) => <SwitchPanelForm kind="switch" item={modal.item} onSave={(p) => saveRow('network_switches', p, 'Switch')} onCancel={close} />}
        </EntityModal>
      )}
      {modal?.type === 'panel' && (
        <EntityModal title={modal.item.id ? 'Edit Patch Panel' : 'Add Patch Panel'} onClose={() => setModal(null)}>
          {(close) => <SwitchPanelForm kind="panel" item={modal.item} onSave={(p) => saveRow('network_patch_panels', p, 'Patch panel')} onCancel={close} />}
        </EntityModal>
      )}
      {modal?.type === 'drop' && (
        <EntityModal title={modal.item.id ? 'Edit Drop' : 'Add Drop'} onClose={() => setModal(null)}>
          {(close) => (
            <DropForm
              item={modal.item}
              switches={siteSwitches}
              panels={sitePanels}
              scheme={site?.label_scheme || DEFAULT_SCHEME}
              onSave={(p) => saveRow('network_drops', p, 'Drop')}
              onCancel={close}
            />
          )}
        </EntityModal>
      )}
    </div>
  );
}

// ── Drops table ───────────────────────────────────────────────────────────
function DropsTable({ drops, switchName, panelName, onEdit, onDelete }: {
  drops: NetworkDrop[];
  switchName: (id: string | null) => string | null;
  panelName: (id: string | null) => string | null;
  onEdit: (d: NetworkDrop) => void;
  onDelete: (d: NetworkDrop) => void;
}) {
  if (drops.length === 0) {
    return <EmptyCard icon={<Network size={28} color="#ddd" />} text="No drops recorded for this site." />;
  }
  return (
    <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
              {['Room', 'Assigned To', 'Current Label', 'New Label', 'Patch Panel', 'Switch', 'Status', ''].map((h) => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drops.map((d) => {
              const sm = STATUS_META[d.status];
              const sub = [d.item_type, d.side, d.area_zone].filter(Boolean).join(' · ');
              const panel = panelName(d.patch_panel_id);
              const sw = switchName(d.switch_id);
              return (
                <tr key={d.id} style={{ borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }} onClick={() => onEdit(d)}>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontWeight: 700 }}>{d.room}</div>
                    {sub && <div style={{ fontSize: 11, color: '#aaa' }}>{sub}</div>}
                  </td>
                  <td style={{ padding: '12px 14px', color: '#666' }}>{d.assigned_to || '—'}</td>
                  <td style={{ padding: '12px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#888' }}>{d.wall_jack_label || '—'}</td>
                  <td style={{ padding: '12px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                    {d.target_label
                      ? <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{d.target_label}</span>
                      : <span style={{ color: '#ccc' }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 14px', color: '#666' }}>
                    {panel ? <>Panel {panel}{d.panel_port != null ? ` : ${d.panel_port}` : <span style={{ color: '#b45309' }}> : ?</span>}</> : '—'}
                  </td>
                  <td style={{ padding: '12px 14px', color: '#666' }}>
                    {sw ? <>{sw}{d.switch_port != null ? ` : ${d.switch_port}` : <span style={{ color: '#b45309' }}> : ?</span>}</> : '—'}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: sm.bg, color: sm.color, whiteSpace: 'nowrap' }}>
                      {d.status === 'needs_label' && <AlertTriangle size={10} />} {sm.label}
                    </span>
                    {d.notes && <span title={d.notes} style={{ marginLeft: 6, color: '#bbb', fontSize: 11 }}>📝</span>}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => onEdit(d)} style={ICON_BTN}><Edit2 size={13} /></button>
                    <button onClick={() => onDelete(d)} style={{ ...ICON_BTN, color: '#b91c1c' }}><Trash2 size={13} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Port map card (shared by switches and panels) ─────────────────────────
function PortMapCard({ title, subtitle, notes, portCount, dropsForPort, onPortClick, onEditMeta, onDeleteMeta, footer }: {
  title: string;
  subtitle?: string;
  notes?: string | null;
  portCount: number;
  dropsForPort: (port: number) => NetworkDrop[];
  onPortClick: (port: number, drops: NetworkDrop[]) => void;
  onEditMeta: () => void;
  onDeleteMeta: () => void;
  footer?: React.ReactNode;
}) {
  const ports = Array.from({ length: portCount }, (_, i) => i + 1);
  const used = ports.filter((p) => dropsForPort(p).length > 0).length;
  return (
    <div className="glass card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{title}</span>
          {subtitle && <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>{subtitle}</span>}
          <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>{used}/{portCount} in use</span>
        </div>
        <div style={{ whiteSpace: 'nowrap' }}>
          <button onClick={onEditMeta} style={ICON_BTN}><Edit2 size={13} /></button>
          <button onClick={onDeleteMeta} style={{ ...ICON_BTN, color: '#b91c1c' }}><Trash2 size={13} /></button>
        </div>
      </div>
      {notes && <div style={{ fontSize: 12, color: '#b45309', marginBottom: 10 }}>{notes}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))', gap: 6 }}>
        {ports.map((p) => {
          const portDrops = dropsForPort(p);
          const conflict = portDrops.length > 1;
          const usedPort = portDrops.length > 0;
          const label = portDrops.map((d) => `${d.room}${d.assigned_to ? ` — ${d.assigned_to}` : ''}${d.wall_jack_label ? ` (${d.wall_jack_label})` : ''}`).join('\n');
          return (
            <button
              key={p}
              title={usedPort ? (conflict ? `⚠ ${portDrops.length} drops on this port:\n${label}` : label) : `Port ${p} — free (click to assign)`}
              onClick={() => onPortClick(p, portDrops)}
              style={{
                padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: usedPort ? '1px solid transparent' : '1px dashed #ccc',
                background: conflict ? '#b45309' : usedPort ? 'var(--teal)' : 'transparent',
                color: usedPort ? 'white' : '#999',
              }}
            >
              {p}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: '#999' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--teal)', marginRight: 5, verticalAlign: 'middle' }} />In use</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, border: '1px dashed #ccc', marginRight: 5, verticalAlign: 'middle' }} />Free</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#b45309', marginRight: 5, verticalAlign: 'middle' }} />Conflict (2+ drops)</span>
      </div>
      {footer}
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────
const ICON_BTN: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#888', marginLeft: 2,
};

function EmptyCard({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
      <div style={{ marginBottom: 8 }}>{icon}</div>
      <div>{text}</div>
    </div>
  );
}

function EntityModal({ title, onClose, onDelete, children }: {
  title: string;
  onClose: () => void;
  onDelete?: () => void;
  children: (close: () => void) => React.ReactNode;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div className="glass card modal-solid" style={{ width: 520, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {onDelete && (
              <button onClick={onDelete} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 6 }}><Trash2 size={15} /></button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
          </div>
        </div>
        {children(onClose)}
      </div>
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

const nn = (v: string) => (v.trim() === '' ? null : v);
const nnum = (v: string) => (v.trim() === '' ? null : Number(v));

// ── Forms ─────────────────────────────────────────────────────────────────
function ProjectForm({ item, onSave, onCancel }: {
  item: Partial<NetworkProject>;
  onSave: (p: Partial<NetworkProject>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<NetworkProject>>({ name: '', notes: '', ...item });
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Project Name"><input className="input" value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Reitler, ClientX HQ" /></Field>
        <Field label="Notes"><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
      </div>
      <FormFooter onCancel={onCancel} onSave={() => onSave({ ...form, notes: nn(form.notes ?? '') })} disabled={!form.name?.trim()} />
    </>
  );
}

function SiteForm({ item, onSave, onCancel }: {
  item: Partial<NetworkSite>;
  onSave: (p: Partial<NetworkSite>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<NetworkSite>>({ name: '', notes: '', label_scheme: DEFAULT_SCHEME, ...item });
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Floor Name"><input className="input" value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Floor 21, Basement, IDF East" /></Field>
        <Field label="Label Scheme">
          <input className="input" value={form.label_scheme ?? ''} onChange={(e) => setForm((f) => ({ ...f, label_scheme: e.target.value }))} placeholder={DEFAULT_SCHEME} />
          <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
            {'Tokens: {room} = room number · {jack} = one label per jack letter · {jacks} = letters together. '}
            {'"{room}-{jack}" → 2153-A, 2153-B, 2153-C'}
          </div>
        </Field>
        <Field label="Notes"><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
      </div>
      <FormFooter onCancel={onCancel} onSave={() => onSave({ ...form, label_scheme: (form.label_scheme ?? '').trim() || DEFAULT_SCHEME, notes: nn(form.notes ?? '') })} disabled={!form.name?.trim()} />
    </>
  );
}

function SwitchPanelForm({ kind, item, onSave, onCancel }: {
  kind: 'switch' | 'panel';
  item: Partial<NetworkSwitch> | Partial<NetworkPatchPanel>;
  onSave: (p: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Record<string, unknown>>({
    name: '', model: '', port_count: kind === 'switch' ? 48 : 24, location: '', notes: '', ...item,
  });
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const payload = () => {
    const p: Record<string, unknown> = {
      ...form,
      name: String(form.name ?? '').trim(),
      port_count: Math.max(1, Number(form.port_count) || (kind === 'switch' ? 48 : 24)),
      location: nn(String(form.location ?? '')),
      notes: nn(String(form.notes ?? '')),
    };
    if (kind === 'switch') p.model = nn(String(form.model ?? ''));
    else delete p.model;
    return p;
  };
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
          <Field label="Name"><input className="input" value={String(form.name ?? '')} onChange={(e) => set('name', e.target.value)} placeholder={kind === 'switch' ? 'e.g. Switch 1' : 'e.g. A'} /></Field>
          <Field label="Port Count"><input className="input" type="number" min={1} value={Number(form.port_count) || ''} onChange={(e) => set('port_count', e.target.value)} /></Field>
        </div>
        {kind === 'switch' && (
          <Field label="Model"><input className="input" value={String(form.model ?? '')} onChange={(e) => set('model', e.target.value)} placeholder="e.g. Cisco C9200-48T" /></Field>
        )}
        <Field label="Location"><input className="input" value={String(form.location ?? '')} onChange={(e) => set('location', e.target.value)} placeholder="e.g. IDF closet, rack 1" /></Field>
        <Field label="Notes"><textarea className="input" rows={2} value={String(form.notes ?? '')} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      <FormFooter onCancel={onCancel} onSave={() => onSave(payload())} disabled={!String(form.name ?? '').trim()} />
    </>
  );
}

function DropForm({ item, switches, panels, scheme, onSave, onCancel }: {
  item: Partial<NetworkDrop>;
  switches: NetworkSwitch[];
  panels: NetworkPatchPanel[];
  scheme: string;
  onSave: (p: Partial<NetworkDrop>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<NetworkDrop>>({
    room: '', assigned_to: '', side: '', area_zone: '', item_type: '', jacks: 'A,B,C',
    wall_jack_label: '', target_label: '',
    patch_panel_id: null, panel_port: null, switch_id: null, switch_port: null,
    status: 'active', notes: '', ...item,
  });
  const set = <K extends keyof NetworkDrop>(k: K, v: NetworkDrop[K]) => setForm((f) => ({ ...f, [k]: v }));
  const suggested = form.room?.trim() ? genTargetLabel(form.room.trim(), form.jacks ?? null, scheme) : '';
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Room / Location"><input className="input" value={form.room ?? ''} onChange={(e) => set('room', e.target.value)} placeholder="e.g. 2052" /></Field>
          <Field label="Assigned To"><input className="input" value={form.assigned_to ?? ''} onChange={(e) => set('assigned_to', e.target.value)} placeholder="Person or room use" /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Side"><input className="input" value={form.side ?? ''} onChange={(e) => set('side', e.target.value)} placeholder="Left / Center / Right" /></Field>
          <Field label="Area / Zone"><input className="input" value={form.area_zone ?? ''} onChange={(e) => set('area_zone', e.target.value)} placeholder="e.g. South, West" /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Item Type">
            <input className="input" list="network-item-types" value={form.item_type ?? ''} onChange={(e) => set('item_type', e.target.value)} placeholder="e.g. Office" />
            <datalist id="network-item-types">
              {['Office', 'Conference Room', 'Hallway', 'Mail Room', 'Storage', 'Reception', 'IDF / Closet'].map((t) => <option key={t} value={t} />)}
            </datalist>
          </Field>
          <Field label="Jacks on Plate"><input className="input" value={form.jacks ?? ''} onChange={(e) => set('jacks', e.target.value)} placeholder="A,B,C" /></Field>
        </div>
        <Field label="Current Label (old system)"><input className="input" value={form.wall_jack_label ?? ''} onChange={(e) => set('wall_jack_label', e.target.value)} placeholder="e.g. 29R-02 A,B,C" /></Field>
        <Field label="New Label (target)">
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" style={{ flex: 1 }} value={form.target_label ?? ''} onChange={(e) => set('target_label', e.target.value)} placeholder={suggested || 'Generated from room + jacks'} />
            <button className="btn btn-ghost" title={suggested ? `Use "${suggested}"` : 'Enter a room first'} disabled={!suggested} onClick={() => set('target_label', suggested)}>Auto</button>
          </div>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
          <Field label="Patch Panel">
            <select className="input" value={form.patch_panel_id ?? ''} onChange={(e) => set('patch_panel_id', e.target.value || null)}>
              <option value="">— None —</option>
              {panels.map((p) => <option key={p.id} value={p.id}>Panel {p.name}</option>)}
            </select>
          </Field>
          <Field label="Panel Port"><input className="input" type="number" min={1} value={form.panel_port ?? ''} onChange={(e) => set('panel_port', nnum(e.target.value))} /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
          <Field label="Switch">
            <select className="input" value={form.switch_id ?? ''} onChange={(e) => set('switch_id', e.target.value || null)}>
              <option value="">— None —</option>
              {switches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Switch Port"><input className="input" type="number" min={1} value={form.switch_port ?? ''} onChange={(e) => set('switch_port', nnum(e.target.value))} /></Field>
        </div>
        <Field label="Status">
          <select className="input" value={form.status ?? 'active'} onChange={(e) => set('status', e.target.value as NetworkDropStatus)}>
            <option value="active">In Use</option>
            <option value="needs_label">Needs Label</option>
            <option value="office_closed">Office Closed</option>
          </select>
        </Field>
        <Field label="Notes"><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      <FormFooter
        onCancel={onCancel}
        onSave={() => onSave({
          ...form,
          room: (form.room ?? '').trim(),
          assigned_to: nn(form.assigned_to ?? ''),
          side: nn(form.side ?? ''),
          area_zone: nn(form.area_zone ?? ''),
          item_type: nn(form.item_type ?? ''),
          jacks: nn(form.jacks ?? ''),
          wall_jack_label: nn(form.wall_jack_label ?? ''),
          target_label: nn(form.target_label ?? ''),
          notes: nn(form.notes ?? ''),
        })}
        disabled={!form.room?.trim()}
      />
    </>
  );
}

function FormFooter({ onCancel, onSave, disabled }: { onCancel: () => void; onSave: () => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
      <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      <button className="btn btn-primary" onClick={onSave} disabled={disabled}>Save</button>
    </div>
  );
}
