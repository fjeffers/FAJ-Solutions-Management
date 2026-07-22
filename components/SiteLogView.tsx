'use client';
// Site Log — phone-first tracker for where you went and how long you were
// on site (migration-038). Lighter than work orders: one card per visit,
// grouped by program (Wendys, State Farm...), with a live Check In/Check Out
// timer that fills hours automatically. Self-contained like NetworkView.
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import type { SiteVisit, SiteVisitType } from '@/lib/types';
import { SITE_VISIT_TYPES } from '@/lib/types';
import { visitLineItem, visitAmount } from '@/lib/visits';
import { fmtMoney } from '@/lib/utils';
import { roundTripMiles } from '@/lib/driving';
import { Plus, Trash2, X, Search, MapPin, Timer, Square as StopIcon, Navigation, Receipt, Home, Car, ChevronDown, Share2 } from 'lucide-react';

const TYPE_COLORS: Record<SiteVisitType, { color: string; bg: string }> = {
  'Project': { color: '#0D7377', bg: 'rgba(13,115,119,0.1)' },
  'T&M':     { color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
  'Revisit': { color: '#b45309', bg: 'rgba(245,158,11,0.12)' },
  'Survey':  { color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
  'Other':   { color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
};

function fmtElapsed(ms: number): string {
  const mins = Math.floor(ms / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function fmtShortDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

// Each site/project keeps its own log: every visit to Roselle #5798 stacks
// under one heading inside the customer's section. Grouped by site code
// (name/address as fallback), newest activity first.
function siteGroupsOf(list: SiteVisit[]): { key: string; title: string; visits: SiteVisit[] }[] {
  const m = new Map<string, SiteVisit[]>();
  for (const v of list) {
    const k = (v.site_code || v.site_name || v.address || 'unknown').toString().trim().toLowerCase();
    m.set(k, [...(m.get(k) ?? []), v]);
  }
  return [...m.entries()]
    .map(([key, visits]) => {
      const sorted = [...visits].sort((a, b) => (b.visit_date ?? '').localeCompare(a.visit_date ?? ''));
      const named = sorted.find((v) => v.site_name) ?? sorted[0];
      const title = [named.site_name, named.site_code ? `#${named.site_code}` : null].filter(Boolean).join(' ')
        || named.address || 'Unknown site';
      return { key, title, visits: sorted };
    })
    .sort((a, b) => (b.visits[0].visit_date ?? '').localeCompare(a.visits[0].visit_date ?? ''));
}

export default function SiteLogView() {
  const supabase = createClient();
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<SiteVisit> | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [q, setQ] = useState('');
  const [programFilter, setProgramFilter] = useState<string | null>(null);
  // Billing lens: what still needs an invoice / what's invoiced but unpaid / what's paid
  const [billing, setBilling] = useState<null | 'needs' | 'awaiting' | 'paid'>(null);
  const [invoicing, setInvoicing] = useState(false);
  const [homeBase, setHomeBase] = useState<string>('');
  const [mileageRate, setMileageRate] = useState<number>(0.7);
  // Per-customer overrides (site_programs.mileage_rate); null = use default.
  const [programRates, setProgramRates] = useState<Record<string, number | null>>({});
  const [collapsedProgs, setCollapsedProgs] = useState<Set<string>>(new Set());
  const [milesProgress, setMilesProgress] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = async () => {
    const [vRes, sRes, pRes] = await Promise.all([
      supabase.from('site_visits').select('*')
        .order('visit_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('user_settings').select('home_base_address, mileage_rate').maybeSingle(),
      supabase.from('site_programs').select('name, mileage_rate'),
    ]);
    if (vRes.error) toastError("Couldn't load the site log. Check your connection and refresh.");
    if (vRes.data) setVisits(vRes.data as SiteVisit[]);
    setHomeBase((sRes.data?.home_base_address as string | null) ?? '');
    setMileageRate(Number(sRes.data?.mileage_rate ?? 0.7));
    if (pRes.data) {
      const m: Record<string, number | null> = {};
      for (const p of pRes.data) m[p.name as string] = p.mileage_rate == null ? null : Number(p.mileage_rate);
      setProgramRates(m);
    }
    setLoading(false);
  };

  // Every customer is different: their rate wins, default fills the gaps.
  const rateFor = (program?: string | null) => {
    const r = program ? programRates[program] : null;
    return r ?? mileageRate;
  };
  const travelFor = (miles: number, program?: string | null) => {
    const rate = rateFor(program);
    return rate > 0 ? Math.round(miles * rate * 100) / 100 : null;
  };

  const saveProgramRate = async (name: string) => {
    const current = programRates[name];
    const raw = window.prompt(
      `Mileage rate for ${name}, $ per mile (blank = use your default $${mileageRate.toFixed(2)}):`,
      current != null ? String(current) : '',
    );
    if (raw == null) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const rate = raw.trim() === '' ? null : Number(raw.replace(/[^0-9.]/g, ''));
    if (rate != null && (isNaN(rate) || rate < 0)) { toastError('Enter a number like 0.70, or leave blank for default'); return; }
    const { error } = await supabase.from('site_programs')
      .upsert({ user_id: user.id, name, mileage_rate: rate, updated_at: new Date().toISOString() }, { onConflict: 'user_id,name' });
    if (error) { toastError(`Couldn't save ${name} rate: ${error.message}`); return; }
    setProgramRates((m) => ({ ...m, [name]: rate }));
    toastSuccess(rate == null ? `${name} uses your default rate` : `${name} mileage set to $${rate.toFixed(2)}/mi`);
  };

  const saveMileageRate = async () => {
    const raw = window.prompt('Customer mileage rate, $ per mile (travel charge = round-trip miles × this):', String(mileageRate));
    if (raw == null) return;
    const rate = Number(raw.replace(/[^0-9.]/g, ''));
    if (isNaN(rate) || rate < 0) { toastError('Enter a number like 0.70'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('user_settings')
      .upsert({ user_id: user.id, mileage_rate: rate, updated_at: new Date().toISOString() });
    if (error) { toastError(`Couldn't save rate: ${error.message}`); return; }
    setMileageRate(rate);
    toastSuccess(`Mileage rate set to $${rate.toFixed(2)}/mi`);
  };

  const saveHomeBase = async () => {
    const addr = window.prompt('Home base address (where your round trips start and end):', homeBase || '');
    if (addr == null) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('user_settings')
      .upsert({ user_id: user.id, home_base_address: addr.trim() || null, updated_at: new Date().toISOString() });
    if (error) { toastError(`Couldn't save home base: ${error.message}`); return; }
    setHomeBase(addr.trim());
    toastSuccess(addr.trim() ? 'Home base saved — mileage will auto-calculate' : 'Home base cleared');
  };

  // Fill round-trip miles (and the customer travel charge) for one saved
  // visit — used on check-out. Never overwrites an existing travel charge.
  const autoMilesFor = async (v: Pick<SiteVisit, 'id' | 'address' | 'travel_charge' | 'program'>) => {
    if (!homeBase || !v.address) return;
    const mi = await roundTripMiles(homeBase, v.address);
    if (mi == null) return;
    const travel = v.travel_charge ?? travelFor(mi, v.program);
    const { error } = await supabase.from('site_visits')
      .update({ miles: mi, travel_charge: travel, updated_at: new Date().toISOString() }).eq('id', v.id);
    if (!error) {
      toastSuccess(`Auto-logged ${mi} mi${travel != null && v.travel_charge == null ? ` · $${travel.toFixed(2)} travel` : ''}`);
      await load();
    }
  };

  // Backfill every filtered visit that has an address but no miles.
  // Nominatim asks for ~1 request/second, so this walks the list politely.
  const autoMilesBulk = async () => {
    if (!homeBase) { toastError('Set your Home Base first (car icon row).'); return; }
    const targets = filtered.filter((v) => v.address && v.miles == null);
    if (targets.length === 0) { toastSuccess('Every visit in view already has mileage (or no address).'); return; }
    let done = 0, failed = 0;
    for (const v of targets) {
      setMilesProgress(`${done + failed + 1}/${targets.length}`);
      const mi = await roundTripMiles(homeBase, v.address!);
      if (mi == null) { failed++; }
      else {
        const { error } = await supabase.from('site_visits')
          .update({ miles: mi, travel_charge: v.travel_charge ?? travelFor(mi, v.program), updated_at: new Date().toISOString() }).eq('id', v.id);
        if (error) failed++; else done++;
      }
      await new Promise((r) => setTimeout(r, 1100));
    }
    setMilesProgress(null);
    if (done > 0) toastSuccess(`Mileage filled for ${done} visit${done !== 1 ? 's' : ''}${failed ? ` (${failed} address${failed !== 1 ? 'es' : ''} couldn't be routed)` : ''}`);
    else toastError('No addresses could be routed — check they include city and state.');
    await load();
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Live timer tick while a visit is open. Check-ins older than 18h are stale
  // (imported rows or a forgotten checkout) — never surface those as "on site
  // now", or checking out would stamp days of hours.
  const openVisit = visits.find((v) =>
    v.time_in && !v.time_out && Date.now() - new Date(v.time_in).getTime() < 18 * 3600000) ?? null;
  useEffect(() => {
    if (!openVisit) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [openVisit]);

  const programs = useMemo(
    () => [...new Set(visits.map((v) => v.program).filter((p): p is string => !!p))].sort(),
    [visits],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return visits.filter((v) => {
      if (programFilter && v.program !== programFilter) return false;
      if (billing === 'needs' && v.invoice_status !== 'not_invoiced') return false;
      if (billing === 'awaiting' && !(v.invoice_status === 'invoiced' && v.payment_status === 'unpaid')) return false;
      if (billing === 'paid' && v.payment_status !== 'paid') return false;
      if (needle) {
        const hay = [v.program, v.site_code, v.site_name, v.address, v.notes, v.rate].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [visits, q, programFilter, billing]);

  // Customer-first: Wendys under Wendys, State Farm under State Farm — with
  // date groups inside each, like the old spreadsheet's per-client sheets.
  const programGroups = useMemo(() => {
    const m = new Map<string, SiteVisit[]>();
    for (const v of filtered) {
      const k = v.program || 'Other';
      m.set(k, [...(m.get(k) ?? []), v]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const toggleProg = (p: string) => setCollapsedProgs((s) => {
    const next = new Set(s);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const hoursSince = (since: string) =>
    visits.filter((v) => v.visit_date && v.visit_date >= since).reduce((s, v) => s + (v.hours ?? 0), 0);
  const unpaidCount = visits.filter((v) => v.payment_status === 'unpaid').length;

  // Money breakdown: labor (parsed from each visit's rate) + travel charge.
  const sumAmount = (list: SiteVisit[]) => Math.round(list.reduce((s, v) => s + visitAmount(v), 0) * 100) / 100;
  const money = useMemo(() => ({
    earned: sumAmount(visits),
    needsInvoice: sumAmount(visits.filter((v) => v.invoice_status === 'not_invoiced')),
    awaiting: sumAmount(visits.filter((v) => v.invoice_status === 'invoiced' && v.payment_status === 'unpaid')),
    paid: sumAmount(visits.filter((v) => v.payment_status === 'paid')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [visits]);

  // Billing helper link: a read-only /billing/<token> page listing only what
  // needs invoicing — for a second person, without a login or anything else.
  const shareBillingLink = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('user_settings').select('billing_share_token').maybeSingle();
    let token = (data?.billing_share_token as string | null) ?? null;
    if (!token) {
      token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
      const { error } = await supabase.from('user_settings')
        .upsert({ user_id: user.id, billing_share_token: token, updated_at: new Date().toISOString() });
      if (error) { toastError(`Couldn't create billing link: ${error.message}`); return; }
    }
    const url = `${window.location.origin}/billing/${token}`;
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: 'FAJ Solutions — Needs Invoicing', url }); return; } catch { /* closed share sheet */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess('Billing link copied — send it to your helper (they see only what needs invoicing)');
    } catch {
      window.prompt('Copy this billing link:', url);
    }
  };

  // ── Mutations ───────────────────────────────────────────────────────────
  const saveVisit = async (v: Partial<SiteVisit>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { id, created_at: _c, updated_at: _u, user_id: _uid, ...rest } = v;
    const clean = {
      ...rest,
      program: rest.program?.toString().trim() || null,
      site_code: rest.site_code?.toString().trim() || null,
      site_name: rest.site_name?.toString().trim() || null,
      address: rest.address?.toString().trim() || null,
      rate: rest.rate?.toString().trim() || null,
      notes: rest.notes?.toString().trim() || null,
      visit_date: rest.visit_date || null,
    };
    const res = id
      ? await supabase.from('site_visits').update({ ...clean, updated_at: new Date().toISOString() }).eq('id', id)
      : await supabase.from('site_visits').insert({ ...clean, user_id: user.id });
    if (res.error) { toastError(`Couldn't save visit: ${res.error.message}`); return; }
    toastSuccess('Visit saved');
    setEditing(null);
    setCheckinOpen(false);
    await load();
  };

  const deleteVisit = async (v: SiteVisit) => {
    if (!confirm(`Delete the visit to ${v.site_name || v.site_code || v.address || 'this site'}?`)) return;
    const { error } = await supabase.from('site_visits').delete().eq('id', v.id);
    if (error) { toastError(`Couldn't delete: ${error.message}`); return; }
    setEditing(null);
    await load();
  };

  const checkIn = async (v: Partial<SiteVisit>) => {
    await saveVisit({
      ...v,
      visit_date: new Date().toISOString().slice(0, 10),
      time_in: new Date().toISOString(),
      visit_type: v.visit_type ?? 'T&M',
    });
  };

  const checkOut = async (v: SiteVisit) => {
    const out = new Date();
    const hrs = Math.min(16, Math.max(0.25, Math.round(((out.getTime() - new Date(v.time_in!).getTime()) / 3600000) * 100) / 100));
    const { error } = await supabase.from('site_visits')
      .update({ time_out: out.toISOString(), hours: hrs, updated_at: out.toISOString() })
      .eq('id', v.id);
    if (error) { toastError(`Couldn't check out: ${error.message}`); return; }
    toastSuccess(`Checked out — ${hrs} hours on site`);
    await load();
    // Auto mileage: fill the round trip from home base in the background
    if (v.miles == null && v.address && homeBase) void autoMilesFor(v);
  };

  // Roll every uninvoiced visit in the current view into one draft invoice,
  // then mark those visits Invoiced. Hourly rates bill hours x rate; flat
  // rates bill once; unpriced lines land at $0 to fill in before sending.
  const invoiceVisits = async () => {
    const targets = filtered.filter((v) => v.invoice_status === 'not_invoiced');
    if (targets.length === 0) { toastError('No uninvoiced visits in the current view — adjust the filters.'); return; }
    const line_items: { id: string; description: string; quantity: number; rate: number }[] = [];
    for (const v of targets) {
      const li = visitLineItem(v);
      line_items.push({ id: `sv-${v.id}`, ...li });
      if (v.travel_charge) {
        line_items.push({ id: `svt-${v.id}`, description: `${v.site_name || v.site_code || 'Site'} — travel charge`, quantity: 1, rate: v.travel_charge });
      }
    }
    const subtotal = Math.round(line_items.reduce((s, li) => s + li.quantity * li.rate, 0) * 100) / 100;
    const client = programFilter ?? targets[0].program ?? null;
    if (!confirm(`Create a draft invoice${client ? ` for ${client}` : ''} from ${targets.length} uninvoiced visit${targets.length !== 1 ? 's' : ''} (subtotal $${subtotal.toFixed(2)})? They'll be marked Invoiced.`)) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setInvoicing(true);
    const year = new Date().getFullYear();
    const { data: inums } = await supabase.from('invoices').select('invoice_number');
    const nums = (inums ?? [])
      .map((i) => i.invoice_number as string)
      .filter((n) => n?.startsWith(`INV-${year}-`))
      .map((n) => parseInt(n.split('-')[2] ?? '0', 10))
      .filter((n) => !isNaN(n));
    const invoice_number = `INV-${year}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
    const { error } = await supabase.from('invoices').insert({
      user_id: user.id, invoice_number, client_name: client,
      title: `Site visits — ${client ?? 'field work'}`,
      description: `Generated from the Site Log (${targets.length} visit${targets.length !== 1 ? 's' : ''}).`,
      line_items, subtotal, tax_rate: 0, tax_amount: 0, total: subtotal, status: 'draft',
    });
    if (error) { setInvoicing(false); toastError(`Couldn't create invoice: ${error.message}`); return; }
    const upd = await supabase.from('site_visits')
      .update({ invoice_status: 'invoiced', updated_at: new Date().toISOString() })
      .in('id', targets.map((t) => t.id));
    setInvoicing(false);
    if (upd.error) toastError(`Invoice created but marking visits failed: ${upd.error.message}`);
    else toastSuccess(`Draft ${invoice_number} created (${line_items.length} lines) — review it in Invoices`);
    await load();
  };

  if (loading) {
    return <div className="view-inner" style={{ maxWidth: 900, margin: '0 auto', color: '#999', padding: 40 }}>Loading site log…</div>;
  }

  return (
    <div className="view-inner" style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>FIELD OPS</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Site Log</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
            {visits.length} visit{visits.length !== 1 ? 's' : ''} · {hoursSince(sevenDaysAgo).toFixed(1)}h last 7 days · {hoursSince(monthStart).toFixed(1)}h this month
            {unpaidCount > 0 && <span style={{ color: '#b45309', fontWeight: 600 }}> · {unpaidCount} unpaid</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!openVisit && (
            <button className="btn btn-primary" onClick={() => setCheckinOpen(true)} style={{ fontSize: 15, padding: '12px 18px' }}>
              <Timer size={16} /> Check In
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => setEditing({ visit_date: new Date().toISOString().slice(0, 10), visit_type: 'T&M', invoice_status: 'not_invoiced', payment_status: 'unpaid' })}>
            <Plus size={14} /> Add Visit
          </button>
          <button
            className="btn btn-ghost"
            onClick={invoiceVisits}
            disabled={invoicing}
            title="Roll all uninvoiced visits in the current view into one draft invoice (filter by program first to bill one client)"
          >
            <Receipt size={14} /> {invoicing ? 'Creating…' : 'Invoice Visits'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={shareBillingLink}
            title="Share a read-only link that shows ONLY what needs invoicing — for a helper, no login, nothing else visible"
          >
            <Share2 size={14} /> Billing Link
          </button>
        </div>
      </div>

      {/* Money breakdown — tap a tile to filter the list to that bucket */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <MoneyTile label="Total Earned" value={fmtMoney(money.earned)} color="var(--teal)" active={billing === null} onClick={() => setBilling(null)} />
        <MoneyTile label="Needs Invoice" value={fmtMoney(money.needsInvoice)} color="#b91c1c" active={billing === 'needs'} onClick={() => setBilling(billing === 'needs' ? null : 'needs')} />
        <MoneyTile label="Invoiced · Awaiting Pay" value={fmtMoney(money.awaiting)} color="#b45309" active={billing === 'awaiting'} onClick={() => setBilling(billing === 'awaiting' ? null : 'awaiting')} />
        <MoneyTile label="Paid" value={fmtMoney(money.paid)} color="#047857" active={billing === 'paid'} onClick={() => setBilling(billing === 'paid' ? null : 'paid')} />
      </div>

      {/* Live open visit */}
      {openVisit && (
        <div className="glass card" style={{ marginBottom: 16, border: '2px solid var(--teal)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--teal)', letterSpacing: 1.5, textTransform: 'uppercase' }}>● On Site Now</div>
            <div style={{ fontWeight: 800, fontSize: 18, marginTop: 2 }}>
              {openVisit.site_name || openVisit.site_code || 'Site'}
              {openVisit.program && <span style={{ color: '#999', fontWeight: 600, fontSize: 13 }}> · {openVisit.program}</span>}
            </div>
            {openVisit.address && <div style={{ fontSize: 12, color: '#888' }}>{openVisit.address}</div>}
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--teal)' }}>
            {fmtElapsed(now - new Date(openVisit.time_in!).getTime())}
          </div>
          <button className="btn btn-primary" style={{ background: '#b91c1c', fontSize: 15, padding: '12px 18px' }} onClick={() => checkOut(openVisit)}>
            <StopIcon size={15} /> Check Out
          </button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <button className={`filter-chip ${programFilter === null ? 'active' : ''}`} onClick={() => setProgramFilter(null)}>All</button>
        {programs.map((p) => (
          <button key={p} className={`filter-chip ${programFilter === p ? 'active' : ''}`} onClick={() => setProgramFilter(programFilter === p ? null : p)}>{p}</button>
        ))}
        <button className={`filter-chip ${billing === 'needs' ? 'active' : ''}`} onClick={() => setBilling(billing === 'needs' ? null : 'needs')}>Needs Invoice</button>
        <button className={`filter-chip ${billing === 'awaiting' ? 'active' : ''}`} onClick={() => setBilling(billing === 'awaiting' ? null : 'awaiting')}>Awaiting Pay</button>
        <button className={`filter-chip ${billing === 'paid' ? 'active' : ''}`} onClick={() => setBilling(billing === 'paid' ? null : 'paid')}>Paid</button>
        <span style={{ width: 1, height: 22, background: '#ddd', margin: '0 2px' }} />
        <button
          className="filter-chip"
          onClick={autoMilesBulk}
          disabled={milesProgress != null}
          title={homeBase ? `Fill missing round-trip miles (driving distance from ${homeBase})` : 'Set your home base first'}
        >
          <Car size={11} style={{ marginRight: 4, verticalAlign: -2 }} />{milesProgress ? `Miles ${milesProgress}…` : 'Auto Miles'}
        </button>
        <button
          className="filter-chip"
          onClick={saveHomeBase}
          title={homeBase ? `Home base: ${homeBase} — tap to change` : 'Set the address your round trips start and end at'}
        >
          <Home size={11} style={{ marginRight: 4, verticalAlign: -2 }} />{homeBase ? 'Home ✓' : 'Set Home Base'}
        </button>
        <button className="filter-chip" onClick={saveMileageRate} title="Default mileage rate — customers without their own rate use this (set per-customer rates on each section header)">
          Default ${mileageRate.toFixed(2)}/mi
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
          <input className="input" style={{ paddingLeft: 30, width: 190 }} placeholder="Search site, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {/* Visit cards grouped by date */}
      {programGroups.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          <MapPin size={28} color="#ddd" style={{ marginBottom: 8 }} />
          <div>No visits match. Check In when you land on site, or Add Visit to backfill one.</div>
        </div>
      ) : (
        programGroups.map(([prog, progVisits]) => {
          const isCollapsed = collapsedProgs.has(prog);
          const progHours = progVisits.reduce((s, x) => s + (x.hours ?? 0), 0);
          const progUnpaid = progVisits.filter((x) => x.payment_status === 'unpaid').length;
          const progPaid$ = sumAmount(progVisits.filter((x) => x.payment_status === 'paid'));
          const progOwed$ = sumAmount(progVisits.filter((x) => x.payment_status === 'unpaid'));
          return (
            <div key={prog} style={{ marginBottom: 24 }}>
              {/* Customer section header */}
              <div
                onClick={() => toggleProg(prog)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '10px 12px', background: 'rgba(13,115,119,0.07)', borderRadius: 10, marginBottom: 10, flexWrap: 'wrap' }}
              >
                <ChevronDown size={15} style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', color: 'var(--teal)' }} />
                <span style={{ fontWeight: 800, fontSize: 16 }}>{prog}</span>
                <span style={{ fontSize: 12, color: '#888' }}>{progVisits.length} visit{progVisits.length !== 1 ? 's' : ''} · {progHours.toFixed(1)}h</span>
                {progPaid$ > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: '#047857' }}>{fmtMoney(progPaid$)} paid</span>}
                {progOwed$ > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: '#b45309' }}>{fmtMoney(progOwed$)} owed{progUnpaid > 0 ? ` (${progUnpaid})` : ''}</span>}
                <div style={{ flex: 1 }} />
                {prog !== 'Other' && (
                  <button
                    className="filter-chip"
                    onClick={(e) => { e.stopPropagation(); saveProgramRate(prog); }}
                    title={`${prog} mileage rate — travel charges for ${prog} visits use this`}
                  >
                    ${rateFor(prog).toFixed(2)}/mi{programRates[prog] == null ? ' (default)' : ''}
                  </button>
                )}
              </div>
              {!isCollapsed && siteGroupsOf(progVisits).map((sg) => (
                <div key={sg.key} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#888', letterSpacing: 1, textTransform: 'uppercase', margin: '0 2px 8px' }}>
              {sg.title}
              <span style={{ color: '#bbb', fontWeight: 600 }}> · {sg.visits.length} visit{sg.visits.length !== 1 ? 's' : ''} · {sg.visits.reduce((s, v) => s + (v.hours ?? 0), 0).toFixed(1)}h · {fmtMoney(sumAmount(sg.visits))}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sg.visits.map((v) => {
                const tc = TYPE_COLORS[v.visit_type] ?? TYPE_COLORS.Other;
                return (
                  <div key={v.id} className="glass card" style={{ padding: '12px 14px', cursor: 'pointer' }} onClick={() => setEditing(v)}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: 15 }}>
                        {v.visit_date ? fmtShortDate(v.visit_date) : 'Date TBD'}
                      </span>
                      <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: tc.bg, color: tc.color }}>{v.visit_type}</span>
                      <div style={{ flex: 1 }} />
                      {v.hours != null && <span style={{ fontWeight: 800, color: 'var(--teal)', fontVariantNumeric: 'tabular-nums' }}>{v.hours}h</span>}
                      {v.miles != null && <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>🚗 {v.miles} mi</span>}
                      {v.rate && <span style={{ fontSize: 12, color: '#888' }}>{v.rate}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                      {v.address && (
                        <a
                          href={`https://maps.google.com/?q=${encodeURIComponent(v.address)}`}
                          target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 12, color: 'var(--teal)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                        >
                          <Navigation size={11} /> {v.address}
                        </a>
                      )}
                      {v.payment_status === 'unpaid' && v.invoice_status === 'invoiced' && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#b45309' }}>INVOICED · UNPAID</span>
                      )}
                      {v.payment_status === 'paid' && <span style={{ fontSize: 10, fontWeight: 700, color: '#047857' }}>PAID</span>}
                      {v.invoice_status === 'not_invoiced' && <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280' }}>NOT INVOICED</span>}
                    </div>
                    {v.notes && <div style={{ fontSize: 12, color: '#777', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{v.notes}</div>}
                  </div>
                );
              })}
            </div>
                </div>
              ))}
            </div>
          );
        })
      )}

      {/* Check-in modal */}
      {checkinOpen && (
        <VisitModal
          title="Check In — start the clock"
          quick
          item={{ program: programs[0] ?? '', visit_type: 'T&M', invoice_status: 'not_invoiced', payment_status: 'unpaid' }}
          programs={programs}
          homeBase={homeBase}
          rateFor={rateFor}
          onSave={checkIn}
          onDelete={undefined}
          onClose={() => setCheckinOpen(false)}
        />
      )}

      {/* Full edit modal */}
      {editing && (
        <VisitModal
          title={editing.id ? 'Edit Visit' : 'Add Visit'}
          item={editing}
          programs={programs}
          homeBase={homeBase}
          rateFor={rateFor}
          onSave={saveVisit}
          onDelete={editing.id ? () => deleteVisit(editing as SiteVisit) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function VisitModal({ title, item, programs, homeBase, rateFor, quick = false, onSave, onDelete, onClose }: {
  title: string;
  item: Partial<SiteVisit>;
  programs: string[];
  homeBase: string;
  rateFor: (program?: string | null) => number;
  quick?: boolean;
  onSave: (v: Partial<SiteVisit>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<SiteVisit>>({ ...item });
  const [calcing, setCalcing] = useState(false);
  const set = <K extends keyof SiteVisit>(k: K, v: SiteVisit[K]) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = !!(form.site_name?.trim() || form.site_code?.trim() || form.address?.trim());

  // Miles drive the travel charge: miles × this customer's rate, editable after.
  const setMiles = (mi: number | null) => setForm((f) => {
    const rate = rateFor(f.program);
    return {
      ...f,
      miles: mi,
      travel_charge: mi != null && rate > 0 ? Math.round(mi * rate * 100) / 100 : f.travel_charge,
    };
  });

  const autoMiles = async () => {
    if (!homeBase || !form.address?.trim()) return;
    setCalcing(true);
    const mi = await roundTripMiles(homeBase, form.address.trim());
    setCalcing(false);
    if (mi == null) toastError("Couldn't route that address — make sure it has street, city, and state.");
    else setMiles(mi);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div className="glass card modal-solid" style={{ width: 520, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {onDelete && <button onClick={onDelete} title="Delete visit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 6 }}><Trash2 size={15} /></button>}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Program / Client">
              <input className="input" list="sitelog-programs" value={form.program ?? ''} onChange={(e) => set('program', e.target.value)} placeholder="e.g. Wendys" />
              <datalist id="sitelog-programs">{programs.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="Site # / WO #"><input className="input" value={form.site_code ?? ''} onChange={(e) => set('site_code', e.target.value)} placeholder="e.g. 5798" /></Field>
          </div>
          <Field label="Site Name"><input className="input" value={form.site_name ?? ''} onChange={(e) => set('site_name', e.target.value)} placeholder="e.g. Roselle" /></Field>
          <Field label="Address"><input className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="Street, city, state" /></Field>
          {!quick && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <Field label="Date"><input className="input" type="date" value={form.visit_date ?? ''} onChange={(e) => set('visit_date', e.target.value)} /></Field>
                <Field label="Hours"><input className="input" type="number" step="0.25" value={form.hours ?? ''} onChange={(e) => set('hours', e.target.value === '' ? null : Number(e.target.value))} /></Field>
                <Field label="Rate"><input className="input" value={form.rate ?? ''} onChange={(e) => set('rate', e.target.value)} placeholder="$55/hr, 2600…" /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <Field label="Type">
                  <select className="input" value={form.visit_type ?? 'T&M'} onChange={(e) => set('visit_type', e.target.value as SiteVisitType)}>
                    {SITE_VISIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Invoiced?">
                  <select className="input" value={form.invoice_status ?? 'not_invoiced'} onChange={(e) => set('invoice_status', e.target.value as SiteVisit['invoice_status'])}>
                    <option value="not_invoiced">Not Invoiced</option>
                    <option value="invoiced">Invoiced</option>
                    <option value="na">N/A</option>
                  </select>
                </Field>
                <Field label="Paid?">
                  <select className="input" value={form.payment_status ?? 'unpaid'} onChange={(e) => set('payment_status', e.target.value as SiteVisit['payment_status'])}>
                    <option value="unpaid">Unpaid</option>
                    <option value="paid">Paid</option>
                    <option value="na">N/A</option>
                  </select>
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Round Trip Miles">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input" style={{ flex: 1, minWidth: 0 }} type="number" step="0.1" value={form.miles ?? ''} onChange={(e) => setMiles(e.target.value === '' ? null : Number(e.target.value))} />
                    <button
                      className="btn btn-ghost"
                      disabled={calcing || !homeBase || !form.address?.trim()}
                      title={!homeBase ? 'Set your home base on the Site Log first' : !form.address?.trim() ? 'Enter the site address first' : `Driving round trip from ${homeBase}`}
                      onClick={autoMiles}
                    >
                      {calcing ? '…' : 'Auto'}
                    </button>
                  </div>
                </Field>
                <Field label={`Travel Charge $ (auto: miles × $${rateFor(form.program).toFixed(2)})`}><input className="input" type="number" step="0.01" value={form.travel_charge ?? ''} onChange={(e) => set('travel_charge', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              </div>
              <Field label="Notes"><textarea className="input" rows={3} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="What you did on site, punch list, follow-ups…" /></Field>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!canSave} style={quick ? { fontSize: 15, padding: '12px 18px' } : undefined}>
            {quick ? <><Timer size={15} /> Start Timer</> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MoneyTile({ label, value, color, active = false, onClick }: {
  label: string; value: string; color: string; active?: boolean; onClick?: () => void;
}) {
  return (
    <div
      className="glass card"
      onClick={onClick}
      style={{ padding: '12px 16px', cursor: onClick ? 'pointer' : undefined, border: active ? `2px solid ${color}` : '2px solid transparent' }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#999' }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
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
