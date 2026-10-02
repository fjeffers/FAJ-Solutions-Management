'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BOARD_COLUMNS, woColumn, crewColumn, taskProgress, boardCounts, hasTech, type ColumnKey } from '@/lib/work-board';
import { todayEastern } from '@/lib/assistant';
import { fmtMoney, fmtDate } from '@/lib/utils';
import type { EnrichedWorkOrder, Contractor } from '@/lib/types';
import { MapPin, Users, CalendarDays, HardHat, AlertCircle, CheckCircle2, Wallet, Inbox } from 'lucide-react';

/** A crew-project site, as much of it as a board card shows. */
interface BoardSite {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  week_start: string | null;
  status: string | null;
  project: string;
  team: string | null;
  lead: string | null;
  helper: string | null;
}

type Card =
  | { kind: 'wo'; id: string; col: ColumnKey; sort: string; wo: EnrichedWorkOrder }
  | { kind: 'crew'; id: string; col: ColumnKey; sort: string; site: BoardSite };

/**
 * Work orders and crew-project sites on one board, a column per stage —
 * Fred's "merge Projects and Work Orders". A work order card opens the same
 * editor the list uses; a crew card opens Crew Projects.
 */
export default function WorkBoard({ workOrders, contractors, owedToTechs, onEdit, onOpenCrew, search }: {
  /** Live (not closed) work orders, already narrowed by the search box. */
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  owedToTechs: number;
  onEdit: (w: EnrichedWorkOrder) => void;
  onOpenCrew?: () => void;
  search: string;
}) {
  const supabase = createClient();
  const [sites, setSites] = useState<BoardSite[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('crew_sites')
        .select('id, name, city, state, week_start, status, crew_projects!inner(name, archived_at), crew_teams(name, helper_name, lead_contractor_id)')
        .is('crew_projects.archived_at', null);
      type Row = {
        id: string; name: string; city: string | null; state: string | null; week_start: string | null; status: string | null;
        crew_projects: { name: string } | { name: string }[] | null;
        crew_teams: { name: string | null; helper_name: string | null; lead_contractor_id: string | null } | { name: string | null; helper_name: string | null; lead_contractor_id: string | null }[] | null;
      };
      const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
      setSites(((data ?? []) as Row[]).map((r) => {
        const team = one(r.crew_teams);
        return {
          id: r.id, name: r.name, city: r.city, state: r.state, week_start: r.week_start, status: r.status,
          project: one(r.crew_projects)?.name ?? 'Crew project',
          team: team?.name ?? null, helper: team?.helper_name ?? null,
          lead: contractors.find((c) => c.id === team?.lead_contractor_id)?.name ?? null,
        };
      }));
    })();
    // Contractors only supply lead names; re-reading crew sites when they change is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = search.trim().toLowerCase();
  const shownSites = useMemo(() => sites.filter((s) => !q
    || [s.name, s.city, s.state, s.project, s.lead, s.helper, s.team].some((v) => (v ?? '').toLowerCase().includes(q))), [sites, q]);

  const today = todayEastern();
  const counts = boardCounts(workOrders, shownSites, today);

  const cards: Card[] = useMemo(() => [
    ...workOrders.map((wo): Card => ({ kind: 'wo', id: wo.id, col: woColumn(wo.wo_status, hasTech(wo)), sort: (wo.scheduled_date ?? '9999') + wo.wo_number, wo })),
    ...shownSites.map((site): Card => ({ kind: 'crew', id: site.id, col: crewColumn(site.status), sort: (site.week_start ?? '9999') + site.name, site })),
  ].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0)), [workOrders, shownSites]);

  return (
    <div>
      {/* ── The numbers that say what to do next ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Kpi icon={<Inbox size={18} />} label="Needs a tech" value={String(counts.needsTech)} tone={counts.needsTech > 0 ? 'warn' : 'ok'} />
        <Kpi icon={<CalendarDays size={18} />} label="Scheduled this week" value={String(counts.thisWeek)} />
        <Kpi icon={<CheckCircle2 size={18} />} label="Work done: close & bill" value={String(counts.readyToClose)} tone={counts.readyToClose > 0 ? 'act' : 'ok'} />
        <Kpi icon={<Wallet size={18} />} label="Still owed to techs" value={fmtMoney(owedToTechs)} tone={owedToTechs > 0 || counts.paySetMissing > 0 ? 'warn' : 'ok'}
          note={counts.paySetMissing > 0 ? `+ ${counts.paySetMissing} job${counts.paySetMissing === 1 ? '' : 's'} with no tech pay set` : undefined} />
      </div>

      {/* ── Columns: side by side on a computer, swipe across on a phone ── */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(232px, 1fr))`, gap: 12, overflowX: 'auto', paddingBottom: 8, scrollSnapType: 'x mandatory' }}>
        {BOARD_COLUMNS.map((col) => {
          const list = cards.filter((c) => c.col === col.key);
          return (
            <section key={col.key} style={{ background: 'rgba(0,0,0,0.035)', borderRadius: 14, padding: 10, minHeight: 320, scrollSnapAlign: 'start', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '4px 4px 10px', borderBottom: `2.5px solid ${col.accent}`, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: col.accent }}>{col.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '1px 8px', borderRadius: 999, background: 'white', color: '#555' }}>{list.length}</span>
                </div>
                <div style={{ fontSize: 10.5, color: '#999', marginTop: 2 }}>{col.hint}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                {list.length === 0 && (
                  <div style={{ border: '2px dashed rgba(0,0,0,0.08)', borderRadius: 10, padding: '22px 8px', textAlign: 'center', fontSize: 11.5, color: '#aaa' }}>
                    Nothing here
                  </div>
                )}
                {list.map((c) => c.kind === 'wo'
                  ? <WoCard key={`wo-${c.id}`} w={c.wo} accent={col.accent} onOpen={() => onEdit(c.wo)} />
                  : <CrewCard key={`crew-${c.id}`} s={c.site} onOpen={onOpenCrew} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function WoCard({ w, accent, onOpen }: { w: EnrichedWorkOrder; accent: string; onOpen: () => void }) {
  const techs = (w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter(Boolean);
  const where = [w.site_name, [w.site_city, w.site_state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const tasks = taskProgress(w.wo_tasks);
  const afterWork = ['Work Done', 'Approved', 'Paid'].includes(w.wo_status ?? '');
  return (
    <button onClick={onOpen} className="board-card" style={{ ...CARD, borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 800, color: 'var(--teal)' }}>WO {w.wo_number}</span>
        {w.scheduled_date && <span style={{ fontSize: 11, color: '#777', display: 'flex', gap: 3, alignItems: 'center' }}><CalendarDays size={11} />{fmtDate(w.scheduled_date)}</span>}
      </div>
      <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3, margin: '5px 0 3px' }}>
        {w.title || w.customer_name || w.service_type || 'Work order'}
      </div>
      {w.customer_name && w.title && <div style={{ fontSize: 11.5, color: '#777' }}>{w.customer_name}</div>}
      {where && <div style={{ fontSize: 11.5, color: '#666', marginTop: 4, display: 'flex', gap: 4, alignItems: 'flex-start' }}><MapPin size={12} style={{ flexShrink: 0, marginTop: 1 }} /><span>{where}</span></div>}
      <div style={{ fontSize: 11.5, marginTop: 3, display: 'flex', gap: 4, alignItems: 'center', color: techs.length ? '#555' : '#b45309', fontWeight: techs.length ? 500 : 700 }}>
        {techs.length ? <Users size={12} /> : <AlertCircle size={12} />}{techs.length ? techs.join(', ') : 'No tech yet'}
      </div>
      {tasks.total > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ height: 5, background: 'rgba(0,0,0,0.07)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${(tasks.done / tasks.total) * 100}%`, height: '100%', background: accent }} />
          </div>
          <div style={{ fontSize: 10.5, color: '#999', marginTop: 3 }}>{tasks.done} of {tasks.total} checklist items</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 9, paddingTop: 8, borderTop: '1px solid #f1f1f1', gap: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>{Number(w.total_amount) > 0 ? fmtMoney(Number(w.total_amount)) : <span style={{ color: '#aaa', fontWeight: 500 }}>No price</span>}</span>
        {afterWork && techs.length > 0 && (w.pay_set === false && w.payment_status !== 'paid' ? (
          // No pay figure recorded: what the tech is owed is unknown, not zero.
          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: 'rgba(245,158,11,0.14)', color: '#b45309' }}>
            Pay not set
          </span>
        ) : (
          <span style={{
            fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
            background: w.payment_status === 'paid' ? 'rgba(16,185,129,0.12)' : w.payment_status === 'partial' ? 'rgba(245,158,11,0.14)' : 'rgba(239,68,68,0.1)',
            color: w.payment_status === 'paid' ? '#047857' : w.payment_status === 'partial' ? '#b45309' : '#b91c1c',
          }}>
            {w.payment_status === 'paid' ? 'Tech paid' : w.payment_status === 'partial' ? 'Tech part-paid' : 'Tech not paid'}
          </span>
        ))}
      </div>
    </button>
  );
}

function CrewCard({ s, onOpen }: { s: BoardSite; onOpen?: () => void }) {
  const who = [s.lead, s.helper].filter(Boolean).join(' + ') || s.team;
  return (
    <button onClick={onOpen} className="board-card" style={{ ...CARD, borderLeft: '3px solid #6B2D8B', background: 'rgba(107,45,139,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: '#6B2D8B', textTransform: 'uppercase', display: 'flex', gap: 4, alignItems: 'center' }}><HardHat size={11} /> Crew project</span>
        {s.week_start && <span style={{ fontSize: 11, color: '#777' }}>Wk of {fmtDate(s.week_start)}</span>}
      </div>
      <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3, margin: '5px 0 3px' }}>{s.name}</div>
      <div style={{ fontSize: 11.5, color: '#777' }}>{s.project}</div>
      {(s.city || s.state) && <div style={{ fontSize: 11.5, color: '#666', marginTop: 4, display: 'flex', gap: 4, alignItems: 'center' }}><MapPin size={12} />{[s.city, s.state].filter(Boolean).join(', ')}</div>}
      <div style={{ fontSize: 11.5, marginTop: 3, display: 'flex', gap: 4, alignItems: 'center', color: who ? '#555' : '#b45309', fontWeight: who ? 500 : 700 }}>
        {who ? <Users size={12} /> : <AlertCircle size={12} />}{who || 'No team yet'}
      </div>
    </button>
  );
}

function Kpi({ icon, label, value, tone, note }: { icon: React.ReactNode; label: string; value: string; tone?: 'ok' | 'warn' | 'act'; note?: string }) {
  const color = tone === 'warn' ? '#b45309' : tone === 'act' ? '#4338ca' : 'var(--teal)';
  const bg = tone === 'warn' ? 'rgba(245,158,11,0.12)' : tone === 'act' ? 'rgba(99,102,241,0.12)' : 'rgba(13,115,119,0.1)';
  return (
    <div className="glass card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: '#999', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: 21, fontWeight: 800, color }}>{value}</div>
        {note && <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700, marginTop: 1 }}>{note}</div>}
      </div>
    </div>
  );
}

const CARD: React.CSSProperties = {
  textAlign: 'left', width: '100%', cursor: 'pointer', background: 'white', border: '1px solid rgba(0,0,0,0.06)',
  borderRadius: 10, padding: '10px 11px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', fontFamily: 'inherit', color: 'inherit',
};
