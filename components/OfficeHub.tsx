'use client';
// The Office hub (Fred, 2026-10-04 — Primio's Office screen): every screen in
// the owner app on one page, grouped like the sidebar, with a search box.
import { useEffect, useState } from 'react';
import {
  Award, BarChart3, BookOpen, Building2, Calendar, ChevronDown, ClipboardCheck, ClipboardList, CreditCard, ExternalLink, FileCheck2, Plus, SquarePlus,
  FileSignature, FileText, Inbox, LifeBuoy, Map as MapIcon, Network, Package, Receipt, Search, Settings, ShieldCheck,
  Timer, TrendingUp, UserCog, Users, Wallet, Workflow, Wrench, type LucideIcon,
} from 'lucide-react';
import { OFFICE_GROUPS, searchOffice, type OfficeItem } from '@/lib/office-menu';
import { Empty, Hero } from '@/components/wf/WfUi';

const ICONS: Record<string, LucideIcon> = {
  'new-order': SquarePlus,
  dashboard: BarChart3, sitelog: Timer, workorders: Workflow,
  payables: Wallet, team: UserCog, support: LifeBuoy, 'import-queue': Inbox,
  payments: CreditCard, financials: TrendingUp, ledger: BookOpen,
  customers: Building2, quickbooks: TrendingUp, netview: FileText, invoices: Receipt,
  contractors: Users, 'contractor-analytics': Award, 'portal-admin': ShieldCheck,
  statements: FileText, '1099': ClipboardCheck, w9: BookOpen,
  surveys: ClipboardList, quotes: FileSignature, contracts: FileCheck2,
  scheduling: Calendar, dispatch: MapIcon,
  materials: Package, maintenance: Wrench, network: Network, settings: Settings,
};

/** A screen's icon, by view (or 'netview' / 'new-order'). Also used by the left menu. */
export function OfficeIcon({ k, size = 20 }: { k: string; size?: number }) {
  const Icon = ICONS[k] ?? FileText;
  return <Icon size={size} />;
}

export default function OfficeHub({ onOpen, onNewOrder, netviewUrl, badges = {} }: {
  onOpen: (view: string) => void;
  onNewOrder: () => void;
  netviewUrl: string;
  /** Counts shown on a tile, by view (support tickets, imports waiting). */
  badges?: Record<string, number>;
}) {
  const [query, setQuery] = useState('');
  const groups = searchOffice(OFFICE_GROUPS, query);
  // Each section opens and closes; which ones are open is remembered on this device.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setOpen(JSON.parse(localStorage.getItem('office-open-sections') ?? '{}') as Record<string, boolean>); } catch { /* private window */ }
  }, []);
  const toggle = (title: string) => setOpen((o) => {
    const next = { ...o, [title]: !o[title] };
    try { localStorage.setItem('office-open-sections', JSON.stringify(next)); } catch { /* private window */ }
    return next;
  });
  const searching = query.trim().length > 0;

  const tile = (i: OfficeItem) => {
    const key = i.view ?? i.action ?? i.href ?? i.label;
    const badge = i.view ? badges[i.view] ?? 0 : 0;
    const body = (
      <>
        <span style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(14,27,46,0.06)', color: 'var(--wf-navy)',
        }}>
          <OfficeIcon k={key} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 14.5 }}>
            {i.label}
            {!i.view && !i.action && <ExternalLink size={13} color="var(--wf-subtle)" aria-label="Opens another site" />}
            {badge > 0 && (
              <span style={{ background: 'var(--wf-gold)', color: 'var(--wf-gold-ink)', borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '1px 7px' }}>{badge}</span>
            )}
          </span>
          <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5, lineHeight: 1.35 }}>{i.hint}</span>
        </span>
      </>
    );
    const style = { display: 'flex', alignItems: 'center', gap: 12, padding: 12, textAlign: 'left' as const, textDecoration: 'none', color: 'inherit' };
    if (i.action === 'new-order') {
      return <button key={key} className="wf-card wf-card-click" style={style} onClick={onNewOrder}>{body}</button>;
    }
    return i.view ? (
      <button key={key} className="wf-card wf-card-click" style={style} onClick={() => onOpen(i.view!)}>{body}</button>
    ) : (
      <a key={key} className="wf-card wf-card-click" style={style} href={netviewUrl} target="_blank" rel="noopener noreferrer">{body}</a>
    );
  };

  return (
    <div className="wf" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Hero
        eyebrow="FAJ Solutions"
        title="Office"
        actions={<button className="wf-btn wf-btn-gold" onClick={onNewOrder}><Plus size={17} /> New order</button>}
        stats={[
          { value: String(badges.support ?? 0), label: 'Support to approve', onClick: () => onOpen('support') },
          { value: String(badges['import-queue'] ?? 0), label: 'Imports waiting', onClick: () => onOpen('import-queue') },
        ]}
      />
      <div style={{ position: 'relative' }}>
        <Search size={18} color="var(--wf-subtle)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input className="wf-input" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a screen: pay, invoices, W-9, map…" aria-label="Find a screen" style={{ paddingLeft: 40 }} />
      </div>
      {groups.length === 0 && <Empty title="Nothing matches" message="Try another word, or clear the search." />}
      {groups.map((g) => {
        const isOpen = searching || !!open[g.title];
        const waiting = g.items.reduce((n, i) => n + (i.view ? badges[i.view] ?? 0 : 0), 0);
        return (
          <section key={g.title} className="wf-card" style={{ overflow: 'hidden' }}>
            <button
              onClick={() => toggle(g.title)}
              aria-expanded={isOpen}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '14px 16px', border: 'none',
                background: 'transparent', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer',
              }}
            >
              <span className="wf-title" style={{ fontSize: 16, flex: 1 }}>{g.title}</span>
              {waiting > 0 && (
                <span style={{ background: 'var(--wf-gold)', color: 'var(--wf-gold-ink)', borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '1px 8px' }}>{waiting}</span>
              )}
              <span className="wf-subtle" style={{ fontSize: 12.5 }}>{g.items.length} {g.items.length === 1 ? 'screen' : 'screens'}</span>
              <ChevronDown size={18} color="var(--wf-subtle)" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
            {isOpen && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 10, padding: '0 16px 16px' }}>
                {g.items.map(tile)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
