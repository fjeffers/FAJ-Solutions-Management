'use client';
// The Office hub (Fred, 2026-10-04 — Primio's Office screen): every screen in
// the owner app on one page, grouped like the sidebar, with a search box.
import { useEffect, useState } from 'react';
import {
  Award, Banknote, BarChart3, BookOpen, Building2, Calendar, ChevronDown, ChevronRight, ClipboardCheck, ClipboardList, Construction, CreditCard, ExternalLink, FileCheck2, HardHat, Plus, SquarePlus, Sun, Trophy,
  FileSignature, FileText, Inbox, LifeBuoy, Map as MapIcon, Network, Package, Receipt, Search, Settings, ShieldCheck,
  Timer, TrendingUp, UserCog, Users, Wallet, Workflow, Wrench, type LucideIcon,
} from 'lucide-react';
import { OFFICE_GROUPS, searchOffice, type OfficeItem } from '@/lib/office-menu';
import { Empty } from '@/components/wf/WfUi';
import { PrimioBar } from '@/components/wf/PrimioScreens';

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

const GROUP_ICONS: Record<string, LucideIcon> = {
  'Every day': Sun, Money: Banknote, Techs: HardHat, 'Winning work': Trophy, 'On site': Construction, Settings,
};

/**
 * Primio's Office screen (lib/screens/office_screen.dart): an app bar, "Search
 * tools", then one card per group that opens and closes — a gold group icon,
 * the name, "N tools", and a row per screen. "Every day" starts open; what
 * Fred opens or closes is remembered on this device. A search opens them all.
 */
export default function OfficeHub({ onOpen, onNewOrder, netviewUrl, badges = {} }: {
  onOpen: (view: string) => void;
  onNewOrder: () => void;
  netviewUrl: string;
  /** Counts shown on a row, by view (support tickets, imports waiting). */
  badges?: Record<string, number>;
}) {
  const [query, setQuery] = useState('');
  const groups = searchOffice(OFFICE_GROUPS, query);
  const [open, setOpen] = useState<Record<string, boolean>>({ 'Every day': true });
  useEffect(() => {
    try {
      const saved = localStorage.getItem('office-open-sections');
      if (saved) setOpen(JSON.parse(saved) as Record<string, boolean>);
    } catch { /* private window */ }
  }, []);
  const toggle = (title: string) => setOpen((o) => {
    const next = { ...o, [title]: !o[title] };
    try { localStorage.setItem('office-open-sections', JSON.stringify(next)); } catch { /* private window */ }
    return next;
  });
  const searching = query.trim().length > 0;

  const row = (i: OfficeItem) => {
    const key = i.view ?? i.action ?? i.href ?? i.label;
    const badge = i.view ? badges[i.view] ?? 0 : 0;
    const body = (
      <>
        <span style={{ color: 'var(--wf-subtle)', display: 'inline-flex' }}><OfficeIcon k={key} size={20} /></span>
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.label}</span>
        {badge > 0 && (
          <span style={{ background: 'var(--wf-gold)', color: 'var(--wf-gold-ink)', borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '1px 7px' }}>{badge}</span>
        )}
        {!i.view && !i.action
          ? <ExternalLink size={16} color="var(--wf-subtle)" aria-label="Opens another site" />
          : <ChevronRight size={20} color="var(--wf-subtle)" />}
      </>
    );
    if (i.action === 'new-order') return <button key={key} className="wf-office-row" onClick={onNewOrder}>{body}</button>;
    return i.view
      ? <button key={key} className="wf-office-row" onClick={() => onOpen(i.view!)}>{body}</button>
      : <a key={key} className="wf-office-row" href={netviewUrl} target="_blank" rel="noopener noreferrer">{body}</a>;
  };

  return (
    <div className="wf" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PrimioBar title="Office" right={<button className="wf-btn wf-btn-gold wf-btn-sm" onClick={onNewOrder}><Plus size={16} /> New order</button>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 640, margin: '0 auto' }}>
      <div style={{ position: 'relative' }}>
        <Search size={18} color="var(--wf-subtle)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input className="wf-input" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools" aria-label="Search tools" style={{ paddingLeft: 40 }} />
      </div>
      {groups.length === 0 && <Empty title="Nothing matches" message="Try another word, or clear the search." />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {groups.map((g) => {
          const isOpen = searching || !!open[g.title];
          const GroupIcon = GROUP_ICONS[g.title] ?? Settings;
          const waiting = g.items.reduce((n, i) => n + (i.view ? badges[i.view] ?? 0 : 0), 0);
          return (
            <section key={g.title} className="wf-card" style={{ overflow: 'hidden' }}>
              <button onClick={() => toggle(g.title)} aria-expanded={isOpen}
                style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', padding: '12px 16px', border: 'none', background: 'transparent', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                <GroupIcon size={22} color="var(--wf-gold)" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="wf-p-title" style={{ display: 'block' }}>{g.title}</span>
                  <span className="wf-p-small wf-subtle">{g.items.length} tools</span>
                </span>
                {!isOpen && waiting > 0 && (
                  <span style={{ background: 'var(--wf-gold)', color: 'var(--wf-gold-ink)', borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '1px 8px' }}>{waiting}</span>
                )}
                <ChevronDown size={20} color="var(--wf-subtle)" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
              </button>
              {isOpen && <div style={{ paddingBottom: 6 }}>{g.items.map(row)}</div>}
            </section>
          );
        })}
      </div>
      </div>
    </div>
  );
}
