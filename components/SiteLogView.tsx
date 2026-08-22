'use client';
// Site Log — phone-first tracker for where you went and how long you were
// on site (migration-038). Lighter than work orders: one card per visit,
// grouped by program (Wendys, State Farm...), with a live Check In/Check Out
// timer that fills hours automatically. Self-contained like NetworkView.
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import type { SiteVisit, SiteVisitType, VisitSession } from '@/lib/types';
import { SITE_VISIT_TYPES } from '@/lib/types';
import { visitLineItem, visitAmount, billableHours, actualHours, MINIMUM_BILLABLE_HOURS } from '@/lib/visits';
import { techsOn, techSummary, techNames, normalizeCrew, toggleTech } from '@/lib/visit-techs';
import { fmtMoney } from '@/lib/utils';
import { extractWorkOrderFields } from '@/lib/wo-extract';
import { roundTripMiles } from '@/lib/driving';
import { buildStatementRows, statementMatrix, statementTotal } from '@/lib/site-statement';
import { downloadXLSX, downloadCSVText } from '@/lib/export';
import { toCSV } from '@/lib/csv';
import SiteSheetView from './SiteSheetView';
import { Plus, Trash2, X, Search, MapPin, Timer, Square as StopIcon, Navigation, Receipt, Home, Car, ChevronDown, Share2, FileSpreadsheet, Table2, LayoutGrid, Briefcase, Users } from 'lucide-react';

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

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** ISO timestamp ⇄ the browser's datetime-local input format (local tz). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
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
  /** Just id + name — the Site Log never needs pay or banking details. */
  const [contractors, setContractors] = useState<{ id: string; name: string }[]>([]);
  /**
   * Hand-picked visits for the client statement. Empty means "no opinion" and
   * the export uses the filtered view, so the old behaviour is untouched until
   * a box is actually ticked.
   */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Cards on a phone, grid at a desk. Remembered so it doesn't reset each visit. */
  const [sheetMode, setSheetMode] = useState(false);
  useEffect(() => {
    setSheetMode(localStorage.getItem('sitelog-sheet') === '1');
  }, []);
  const toggleSheet = () => setSheetMode((m) => {
    localStorage.setItem('sitelog-sheet', m ? '0' : '1');
    return !m;
  });
  const togglePicked = (id: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [now, setNow] = useState(() => Date.now());

  const load = async () => {
    const [vRes, sRes, pRes, cRes] = await Promise.all([
      supabase.from('site_visits').select('*')
        .order('visit_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('user_settings').select('home_base_address, mileage_rate').maybeSingle(),
      supabase.from('site_programs').select('name, mileage_rate'),
      supabase.from('contractors').select('id, name').order('name'),
    ]);
    if (vRes.error) toastError("Couldn't load the site log. Check your connection and refresh.");
    if (vRes.data) setVisits(vRes.data as SiteVisit[]);
    if (cRes.data) setContractors(cRes.data as { id: string; name: string }[]);
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
        // visit_type is in the haystack so typing "T&M" narrows to T&M work —
        // which is how a client asks for it, and what the statement then exports.
        const hay = [v.program, v.site_code, v.site_name, v.address, v.notes, v.rate, v.visit_type]
          .join(' ').toLowerCase();
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

  // The spreadsheet that goes to the client to get paid: whatever is on screen
  // right now, so filtering to one program first bills one client. Refuses to
  // write an empty file rather than sending a client a header row.
  const exportStatement = async (format: 'xlsx' | 'csv') => {
    // Ticked rows win over the filters — that is the whole point of ticking.
    // Picks are honoured even when the filters have since hidden them, so a
    // statement assembled across two searches doesn't silently lose sites.
    const chosen = picked.size > 0
      ? visits.filter((v) => picked.has(v.id))
      : filtered;
    if (chosen.length === 0) { toastError('Nothing to export — tick some sites, or adjust the filters.'); return; }
    const rows = buildStatementRows(chosen);
    const client = programFilter ?? 'All Clients';
    const stamp = new Date().toISOString().slice(0, 10);
    const safeName = `${client} statement ${stamp}`.replace(/[\\/:*?"<>|]/g, '-');
    const matrix = statementMatrix(rows);
    try {
      if (format === 'xlsx') {
        await downloadXLSX(`${safeName}.xlsx`, 'Statement', matrix,
          [12, 9, 20, 32, 40, 10, 10, 10, 12, 12, 11, 13, 12]);
      } else {
        downloadCSVText(`${safeName}.csv`, toCSV(matrix.map((r) => r.map(String))));
      }
      toastSuccess(`${rows.length} visit${rows.length !== 1 ? 's' : ''} · ${fmtMoney(statementTotal(rows))} exported`);
    } catch {
      toastError("Couldn't build the statement file.");
    }
  };

  /**
   * One cell, one column. Deliberately not routed through saveVisit, which
   * writes the whole row from a form — sending a stale copy of every other
   * field back would quietly undo edits made since the grid last loaded.
   * Updated in place first so the cell doesn't flicker back while the round
   * trip completes.
   */
  const saveCell = async (id: string, patch: Partial<SiteVisit>) => {
    const row = visits.find((v) => v.id === id);
    const next = { ...row, ...patch } as SiteVisit;
    const derived: Partial<SiteVisit> = {};

    // The two formulas the Projects sheet carried in its cells. Each only fires
    // when its own inputs were the thing that changed, so a figure typed over
    // the top of a calculated one stays typed — the override a spreadsheet
    // user expects, rather than the cell fighting back.
    if (('time_in' in patch || 'time_out' in patch) && next.time_in && next.time_out) {
      // On a multi-day job time_in/time_out are only mirrors of first-in and
      // last-out, so the gap between them counts every night nobody was on
      // site. One job read 94.79 hours for 6.73 hours of actual work. Where
      // stints exist they are the truth; the gap is the fallback.
      const fromStints = actualHours(next.sessions ?? null);
      const gap = (new Date(next.time_out).getTime() - new Date(next.time_in).getTime()) / 3600000;
      const h = fromStints ?? (gap > 0 ? Math.round(gap * 100) / 100 : null);
      // Stored at the two-hour minimum, same as the timer and the invoice.
      if (h != null && h > 0) derived.hours = billableHours(h);
    }
    if ('miles' in patch) {
      const rate = rateFor(next.program);
      derived.travel_charge = next.miles != null && rate > 0
        ? Math.round(Number(next.miles) * rate * 100) / 100
        : null;
    }

    const full = { ...patch, ...derived };
    setVisits((list) => list.map((v) => (v.id === id ? { ...v, ...full } : v)));
    const { error } = await supabase.from('site_visits')
      .update({ ...full, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toastError(`Couldn't save: ${error.message}`); await load(); }
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
    const stint = Math.min(16, Math.max(0.25, Math.round(((out.getTime() - new Date(v.time_in!).getTime()) / 3600000) * 100) / 100));
    // Multi-day jobs: this stint joins any earlier sessions; hours = the sum.
    const prior = (v.sessions ?? []).filter((s) => s.in && s.out);
    const priorHours = prior.reduce((s, x) => s + (new Date(x.out!).getTime() - new Date(x.in).getTime()) / 3600000, 0);
    const sessions = [...prior, { in: v.time_in!, out: out.toISOString() }];
    const onSite = Math.round((priorHours + stint) * 100) / 100;
    // The minimum applies to what gets recorded, not just what gets billed.
    // sessions still holds every real in/out, so the true time is not lost.
    const hrs = billableHours(onSite) ?? onSite;
    const { error } = await supabase.from('site_visits')
      .update({ time_out: out.toISOString(), hours: hrs, sessions, updated_at: out.toISOString() })
      .eq('id', v.id);
    if (error) { toastError(`Couldn't check out: ${error.message}`); return; }
    toastSuccess(
      hrs > onSite
        ? `Checked out — ${onSite}h on site, recorded as the ${hrs}h minimum`
        : `Checked out — ${stint}h this stint${prior.length > 0 ? ` · ${hrs}h total across ${sessions.length} days` : ''}`
    );
    await load();
    // Auto mileage: fill the round trip from home base in the background
    if (v.miles == null && v.address && homeBase) void autoMilesFor(v);
  };

  // Site Log visit → real work order. The visit's free-text rate becomes the
  // pay setup ($55/hr → Hourly, flat/project price → Fixed), the address is
  // split into site fields, and the visit keeps a link to the WO so it can't
  // be converted twice. Assigning a tech happens on the WO afterward.
  const convertToWorkOrder = async (v: SiteVisit) => {
    if (v.work_order_id) { toastError('This visit already has a work order — see the Work Orders board.'); return; }
    const amount = visitAmount(v);
    const label = v.site_name || v.site_code || v.address || 'this visit';
    if (!confirm(`Create a work order from ${label}?${amount > 0 ? `\n\nClient price will start at ${fmtMoney(amount)} (editable).` : ''}`)) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: wos } = await supabase.from('work_orders').select('wo_number');
    const nums = (wos ?? []).map((w) => parseInt(w.wo_number, 10)).filter((n) => !isNaN(n));
    const nextWo = String((nums.length ? Math.max(...nums) : 1000) + 1);

    const addr = extractWorkOrderFields(v.address ?? '');
    const hourly = (v.rate ?? '').match(/\$?\s*(\d+(?:\.\d+)?)\s*\/\s*h/i);

    const { data: created, error } = await supabase.from('work_orders').insert({
      user_id: user.id,
      wo_number: nextWo,
      // Carry the crew across. This used to be blank, so the tech recorded on
      // the visit was lost the moment it became a work order.
      contractor_name: techNames(techsOn(v, contractors)),
      title: [v.program, v.site_name || v.site_code].filter(Boolean).join(' — ') || 'Site visit',
      customer_name: v.program ?? null,
      client_reference: v.site_code ?? null,
      description: [
        `Converted from Site Log${v.visit_date ? ` — visit on ${v.visit_date}` : ''}${v.hours ? ` (${v.hours}h logged)` : ''}.`,
        v.notes ?? '',
      ].filter(Boolean).join('\n'),
      site_name: v.site_name ?? null,
      site_address: addr.site_address ?? v.address ?? null,
      site_city: addr.site_city ?? null,
      site_state: addr.site_state ?? null,
      site_zip: addr.site_zip ?? null,
      start_date: v.visit_date ?? null,
      total_amount: amount,
      pay_type: hourly ? 'Hourly' : 'Fixed',
      hourly_rate: hourly ? Number(hourly[1]) : null,
      hours_worked: hourly ? (v.hours ?? null) : null,
      wo_status: 'Open',
      source_platform: 'Internal',
      assignment_type: 'Internal',
      priority: 'Normal',
      schedule_type: 'Exact Time',
    }).select('id').single();
    if (error || !created) { toastError(`Couldn't create the work order: ${error?.message ?? 'unknown error'}`); return; }

    const upd = await supabase.from('site_visits')
      .update({ work_order_id: created.id, updated_at: new Date().toISOString() })
      .eq('id', v.id);
    if (upd.error) toastError(`WO #${nextWo} created, but linking the visit failed: ${upd.error.message}`);
    else toastSuccess(`WO #${nextWo} created from ${label} — it's on the Work Orders board, ready to assign`);
    await load();
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
    // 900px suits a column of cards. The spreadsheet has sixteen columns and
    // needs the whole window, so the wrapper widens with the mode rather than
    // the grid scrolling sideways inside a narrow well.
    <div className="view-inner" style={{ maxWidth: sheetMode ? '100%' : 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>FIELD OPS</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Site Log</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
            {visits.length} visit{visits.length !== 1 ? 's' : ''} · {hoursSince(sevenDaysAgo).toFixed(1)}h last 7 days · {hoursSince(monthStart).toFixed(1)}h this month
            {unpaidCount > 0 && <span style={{ color: '#b45309', fontWeight: 600 }}> · {unpaidCount} unpaid</span>}
          </p>
          <p style={{ margin: '2px 0 0', color: '#999', fontSize: 12 }}>
            All time: <b style={{ color: '#666' }}>{visits.reduce((s, v) => s + Number(v.hours ?? 0), 0).toFixed(1)} hours</b>
            {' · '}<b style={{ color: '#666' }}>{visits.reduce((s, v) => s + Number(v.miles ?? 0), 0).toFixed(0)} miles</b>
            {' · '}<b style={{ color: '#666' }}>{fmtMoney(visits.reduce((s, v) => s + Number(v.travel_charge ?? 0), 0))} travel billed</b>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!openVisit && (
            <button className="btn btn-primary" onClick={() => setCheckinOpen(true)} style={{ fontSize: 15, padding: '12px 18px' }}>
              <Timer size={16} /> Check In
            </button>
          )}
          <button className="btn btn-ghost" onClick={toggleSheet}
            title={sheetMode ? 'Back to cards' : 'Edit every site in one grid, like a spreadsheet'}>
            {sheetMode ? <><LayoutGrid size={14} /> Cards</> : <><Table2 size={14} /> Spreadsheet</>}
          </button>
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
            onClick={() => exportStatement('xlsx')}
            title={picked.size > 0
              ? `Excel statement of the ${picked.size} site${picked.size !== 1 ? 's' : ''} you've ticked`
              : 'Excel statement of the visits on screen, with amounts and a total — the one you send a client to get paid. Tick sites to choose them by hand.'}
          >
            <FileSpreadsheet size={14} /> Client Statement{picked.size > 0 ? ` (${picked.size})` : ''}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => exportStatement('csv')}
            title="Same statement as CSV — opens in Excel, or File → Import in Google Sheets"
          >
            <FileSpreadsheet size={14} /> Statement CSV
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

      {/* Hand-built statement: what's ticked, and how to add or drop the rest. */}
      {(picked.size > 0 || filtered.length > 0) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          marginBottom: 12, padding: '8px 12px', borderRadius: 10,
          background: picked.size > 0 ? 'rgba(13,115,119,0.06)' : 'transparent',
          border: picked.size > 0 ? '1px solid rgba(13,115,119,0.2)' : '1px solid transparent',
        }}>
          <span style={{ fontSize: 12.5, color: picked.size > 0 ? 'var(--teal)' : '#999', fontWeight: picked.size > 0 ? 700 : 500 }}>
            {picked.size > 0
              ? `${picked.size} site${picked.size !== 1 ? 's' : ''} picked for the statement · ${fmtMoney(statementTotal(buildStatementRows(visits.filter((v) => picked.has(v.id)))))}`
              : `Tick sites to build a statement by hand — otherwise it exports all ${filtered.length} on screen.`}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
            onClick={() => setPicked((s) => new Set([...s, ...filtered.map((v) => v.id)]))}>
            Add all {filtered.length} on screen
          </button>
          {picked.size > 0 && (
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
              onClick={() => setPicked(new Set())}>
              Clear picks
            </button>
          )}
        </div>
      )}

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

      {/* Spreadsheet: every filtered site in one editable grid. */}
      {sheetMode ? (
        <SiteSheetView
          visits={filtered}
          techRoster={contractors}
          picked={picked}
          onTogglePicked={togglePicked}
          onSave={saveCell}
          onDelete={deleteVisit}
          onAdd={() => setEditing({
            visit_date: new Date().toISOString().slice(0, 10), visit_type: 'T&M',
            invoice_status: 'not_invoiced', payment_status: 'unpaid',
            program: programFilter ?? programs[0] ?? '',
          })}
        />
      ) : programGroups.length === 0 ? (
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
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(sumAmount(progVisits))} total</span>
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
                  <div key={v.id} className="glass card"
                    style={{
                      padding: '12px 14px', cursor: 'pointer',
                      border: picked.has(v.id) ? '1.5px solid var(--teal)' : undefined,
                      background: picked.has(v.id) ? 'rgba(13,115,119,0.05)' : undefined,
                    }}
                    onClick={() => setEditing(v)}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      {/* Ticking a visit builds the statement by hand. Untouched,
                          nothing is ticked and the export falls back to the whole
                          filtered view — the way it worked before. */}
                      <input
                        type="checkbox"
                        checked={picked.has(v.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => togglePicked(v.id)}
                        title="Include this site on the client statement"
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--teal)' }}
                      />
                      <span style={{ fontWeight: 800, fontSize: 15 }}>
                        {v.visit_date ? fmtShortDate(v.visit_date) : 'Date TBD'}
                      </span>
                      <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: tc.bg, color: tc.color }}>{v.visit_type}</span>
                      <div style={{ flex: 1 }} />
                      {v.hours != null && <span style={{ fontWeight: 800, color: 'var(--teal)', fontVariantNumeric: 'tabular-nums' }}>{v.hours}h</span>}
                      {/* Hours already carry the minimum. Show the real clock
                          time when it was shorter, so the number is explained
                          rather than just asserted. */}
                      {(() => {
                        const onSite = actualHours(v.sessions);
                        if (onSite == null || v.hours == null || onSite >= Number(v.hours)) return null;
                        return (
                          <span
                            title={`On site ${onSite}h — recorded at the ${MINIMUM_BILLABLE_HOURS}h minimum`}
                            style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#fff4e5', color: '#b45309', whiteSpace: 'nowrap' }}
                          >
                            {MINIMUM_BILLABLE_HOURS}h min · {onSite}h on site
                          </span>
                        );
                      })()}
                      {v.miles != null && <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>🚗 {v.miles} mi</span>}
                      {v.rate && <span style={{ fontSize: 12, color: '#888' }}>{v.rate}</span>}
                      {(() => {
                        const crew = techsOn(v, contractors);
                        if (crew.length === 0) return null;
                        return (
                          <span
                            title={crew.length > 1 ? `On site: ${techNames(crew)} (lead ${crew[0].name})` : crew[0].name}
                            style={{
                              fontSize: 12, color: 'var(--teal)', fontWeight: 600,
                              whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}
                          >
                            <Users size={12} /> {techSummary(crew)}
                          </span>
                        );
                      })()}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                      {(v.sessions?.length ?? 0) > 1 ? (
                        <span style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>
                          ⏱ {v.sessions!.slice(0, 3).map((s) =>
                            `${new Date(s.in).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} ${fmtClock(s.in)}–${s.out ? fmtClock(s.out) : '…'}`
                          ).join(' · ')}{v.sessions!.length > 3 ? ` +${v.sessions!.length - 3} more` : ''}
                        </span>
                      ) : v.time_in ? (
                        <span style={{ fontSize: 12, color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          ⏱ {fmtClock(v.time_in)} – {v.time_out ? fmtClock(v.time_out) : 'on site'}
                        </span>
                      ) : null}
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
                      {v.work_order_id ? (
                        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--teal)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <Briefcase size={10} /> HAS WORK ORDER
                        </span>
                      ) : (
                        <button
                          title="Create a work order from this visit"
                          onClick={(e) => { e.stopPropagation(); convertToWorkOrder(v); }}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                            border: '1.5px solid rgba(13,115,119,0.35)', background: 'rgba(13,115,119,0.06)',
                            fontSize: 10, fontWeight: 800, color: 'var(--teal)', fontFamily: 'Lato, sans-serif',
                          }}
                        >
                          <Briefcase size={10} /> → WORK ORDER
                        </button>
                      )}
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
          contractors={contractors}
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
          contractors={contractors}
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

function VisitModal({ title, item, programs, contractors, homeBase, rateFor, quick = false, onSave, onDelete, onClose }: {
  title: string;
  item: Partial<SiteVisit>;
  programs: string[];
  contractors: { id: string; name: string }[];
  homeBase: string;
  rateFor: (program?: string | null) => number;
  quick?: boolean;
  onSave: (v: Partial<SiteVisit>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<SiteVisit>>(() => {
    const f = { ...item };
    // Back-compat: older visits carry a single time_in/out pair, not sessions.
    if ((!f.sessions || f.sessions.length === 0) && f.time_in) {
      f.sessions = [{ in: f.time_in, out: f.time_out ?? null }];
    }
    return f;
  });
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

  // Sessions drive the times: hours = sum of completed stints, and
  // time_in/time_out mirror first-in / last-out for the cards and timer.
  const sessions = (form.sessions ?? []) as VisitSession[];
  const setSessions = (next: VisitSession[]) => setForm((f) => {
    const total = next.reduce((s, x) =>
      x.in && x.out ? s + Math.max(0, (new Date(x.out).getTime() - new Date(x.in).getTime()) / 3600000) : s, 0);
    const ins = next.filter((x) => x.in).map((x) => x.in).sort();
    const outs = next.filter((x) => x.out).map((x) => x.out!).sort();
    return {
      ...f,
      sessions: next,
      hours: total > 0 ? billableHours(Math.round(total * 100) / 100) : f.hours,
      time_in: ins[0] ?? null,
      time_out: next.some((x) => x.in && !x.out) ? null : (outs[outs.length - 1] ?? null),
    };
  });

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
                {/* Snaps up on blur, so a typed 0.75 becomes the 2h minimum
                    while you are still looking at the field. */}
                <Field label="Hours"><input className="input" type="number" step="0.25" value={form.hours ?? ''}
                  onChange={(e) => set('hours', e.target.value === '' ? null : Number(e.target.value))}
                  onBlur={() => set('hours', billableHours(form.hours))} /></Field>
                <Field label="Rate"><input className="input" value={form.rate ?? ''} onChange={(e) => set('rate', e.target.value)} placeholder="$55/hr, 2600…" /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Project Price $ (fixed jobs — overrides Rate)">
                  <input className="input" type="number" step="0.01" value={form.total_project_price ?? ''}
                    onChange={(e) => set('total_project_price', e.target.value === '' ? null : Number(e.target.value))}
                    placeholder="Leave blank for hourly" />
                </Field>
              </div>

              {/* Whole crew, not just one name. Tick everyone who was on site;
                  the first ticked is the lead. Recording a second tech does
                  not change what the client is billed. */}
              <Field label="Techs on site">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {contractors.length === 0 && (
                    <span style={{ fontSize: 12.5, color: '#888' }}>No techs on file yet.</span>
                  )}
                  {contractors.map((c) => {
                    const crew = form.tech_ids ?? [];
                    const on = crew.includes(c.id);
                    const lead = crew[0] === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          const next = normalizeCrew(toggleTech(crew, c.id));
                          setForm((f) => ({ ...f, tech_ids: next.tech_ids, contractor_id: next.contractor_id }));
                        }}
                        title={on ? (lead ? `${c.name} — lead tech` : `${c.name} — on site`) : `Add ${c.name}`}
                        style={{
                          padding: '5px 11px',
                          border: `1px solid ${on ? 'var(--teal)' : '#ddd'}`,
                          background: on ? 'rgba(13,115,119,0.09)' : '#fff',
                          color: on ? 'var(--teal)' : '#666',
                          fontWeight: on ? 700 : 500,
                          fontSize: 13,
                          borderRadius: 20,
                          cursor: 'pointer',
                        }}
                      >
                        {on ? '✓ ' : ''}{c.name}{lead && (form.tech_ids?.length ?? 0) > 1 ? ' · lead' : ''}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Days & Times on Site">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sessions.map((s, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 30px', gap: 6, alignItems: 'center' }}>
                      <input
                        className="input" type="datetime-local" title="Time in"
                        value={toLocalInput(s.in)}
                        onChange={(e) => { const n = [...sessions]; n[i] = { ...n[i], in: e.target.value ? new Date(e.target.value).toISOString() : '' }; setSessions(n); }}
                      />
                      <input
                        className="input" type="datetime-local" title="Time out"
                        value={toLocalInput(s.out)}
                        onChange={(e) => { const n = [...sessions]; n[i] = { ...n[i], out: e.target.value ? new Date(e.target.value).toISOString() : null }; setSessions(n); }}
                      />
                      <button
                        onClick={() => setSessions(sessions.filter((_, j) => j !== i))}
                        title="Remove this day/session"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 4 }}
                      ><X size={14} /></button>
                    </div>
                  ))}
                  <button className="btn btn-ghost" onClick={() => setSessions([...sessions, { in: '', out: null }])} style={{ justifyContent: 'center' }}>
                    <Plus size={13} /> Add Day / Session
                  </button>
                  <div style={{ fontSize: 11, color: '#999' }}>Hours totals every completed session automatically — multi-day jobs welcome.</div>
                </div>
              </Field>
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
              {/* migration-050: the client-facing line. Notes are internal and can
                  be a whole imported email; this is what a shared report shows. */}
              <Field label="Client summary (shows on shared reports)">
                <textarea className="input" rows={2} value={form.client_summary ?? ''}
                  onChange={(e) => set('client_summary', e.target.value)}
                  placeholder="Leave blank to use your notes — long imported notes are hidden from clients" />
              </Field>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave({ ...form, sessions: (form.sessions ?? []).filter((s) => s.in) })} disabled={!canSave} style={quick ? { fontSize: 15, padding: '12px 18px' } : undefined}>
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
