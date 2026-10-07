'use client';
// Customers — the ERP/CRM module (migration-046).
//
// One canonical record per client, and the first place in this app that can
// answer "what did Wendy's actually make me": revenue, tech cost, profit and
// margin per customer, plus what's unbilled and what's outstanding.
//
// The CRM half lives in the detail panel: contacts (who to call) and an activity
// timeline (what was said). Self-contained like NetworkView and SiteLogView —
// fetches its own data rather than taking props from page.tsx.
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import type {
  Customer, CustomerStatus, CustomerContact, CustomerActivity, CustomerActivityKind,
  WorkOrder, Invoice, InvoicePayment, SiteVisit, Quote,
} from '@/lib/types';
import { customerBooks, unlinkedCount, type CustomerBook } from '@/lib/customers';
import { siteReportCSV, toReportVisits } from '@/lib/site-report';
import { downloadCSVText } from '@/lib/export';
import { fmtMoney, fmtDate, todayISO } from '@/lib/utils';
import {
  Plus, X, Search, Trash2, Building2, Phone, Mail, User, MessageSquarePlus,
  AlertTriangle, ChevronLeft, Share2, Download,
} from 'lucide-react';
import { backdropClose } from '@/lib/backdrop';
import { asValues } from '@/lib/custom-fields';
import CustomFieldInputs, { CustomFieldList } from '@/components/CustomFieldInputs';

const STATUSES: CustomerStatus[] = ['lead', 'prospect', 'active', 'dormant', 'lost'];

const STATUS_COLORS: Record<CustomerStatus, { color: string; bg: string }> = {
  lead:     { color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
  prospect: { color: '#2563eb', bg: 'rgba(37,99,235,0.12)' },
  active:   { color: '#047857', bg: 'rgba(5,150,105,0.14)' },
  dormant:  { color: '#b45309', bg: 'rgba(245,158,11,0.14)' },
  lost:     { color: '#6b7280', bg: 'rgba(107,114,128,0.14)' },
};

const ACTIVITY_KINDS: CustomerActivityKind[] = ['call', 'email', 'meeting', 'note', 'quote', 'invoice', 'job'];

const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

export default function CustomersView({ startNew, onStarted }: {
  /** Open a new customer straight away (Dispatch -> Create -> New customer). */
  startNew?: boolean;
  onStarted?: () => void;
} = {}) {
  const supabase = createClient();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [activity, setActivity] = useState<CustomerActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  useEffect(() => {
    if (!startNew) return;
    setEditing({ status: 'active' });
    onStarted?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNew]);
  const [contactDraft, setContactDraft] = useState<Partial<CustomerContact> | null>(null);
  const [noteDraft, setNoteDraft] = useState<Partial<CustomerActivity> | null>(null);

  const load = async () => {
    const [c, w, i, p, v, qu, ct, ac] = await Promise.all([
      supabase.from('customers').select('*').order('name'),
      supabase.from('work_orders').select('*'),
      supabase.from('invoices').select('*'),
      supabase.from('invoice_payments').select('*'),
      supabase.from('site_visits').select('*'),
      supabase.from('quotes').select('*'),
      supabase.from('customer_contacts').select('*').order('is_primary', { ascending: false }),
      supabase.from('customer_activity').select('*').order('occurred_at', { ascending: false }),
    ]);
    setCustomers((c.data ?? []) as Customer[]);
    setWorkOrders((w.data ?? []) as WorkOrder[]);
    setInvoices((i.data ?? []) as Invoice[]);
    setInvoicePayments((p.data ?? []) as InvoicePayment[]);
    setVisits((v.data ?? []) as SiteVisit[]);
    setQuotes((qu.data ?? []) as Quote[]);
    setContacts((ct.data ?? []) as CustomerContact[]);
    setActivity((ac.data ?? []) as CustomerActivity[]);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const inputs = useMemo(
    () => ({ workOrders, invoices, invoicePayments, visits, quotes }),
    [workOrders, invoices, invoicePayments, visits, quotes],
  );

  const books = useMemo(() => customerBooks(customers, inputs), [customers, inputs]);
  const orphans = useMemo(() => unlinkedCount(inputs), [inputs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return books;
    return books.filter((b) =>
      b.customer.name.toLowerCase().includes(needle) ||
      (b.customer.city ?? '').toLowerCase().includes(needle) ||
      (b.customer.industry ?? '').toLowerCase().includes(needle));
  }, [books, q]);

  const totals = useMemo(() => ({
    revenue: books.reduce((s, b) => s + b.woRevenue, 0),
    profit: books.reduce((s, b) => s + b.profit, 0),
    unbilled: books.reduce((s, b) => s + b.unbilled, 0),
    outstanding: books.reduce((s, b) => s + b.outstanding, 0),
    neverSent: books.reduce((s, b) => s + b.neverSent, 0),
  }), [books]);

  const selected = books.find((b) => b.customer.id === selectedId) ?? null;

  // ── Writes ──────────────────────────────────────────────────────────────
  const saveCustomer = async () => {
    if (!editing?.name?.trim()) return toastError('Name is required');
    const row = { ...editing, name: editing.name.trim() };
    const { error } = row.id
      ? await supabase.from('customers').update({ ...row, updated_at: new Date().toISOString() }).eq('id', row.id)
      : await supabase.from('customers').insert(row);
    if (error) return toastError(error.message);
    toastSuccess(row.id ? 'Customer updated' : 'Customer added');
    setEditing(null);
    void load();
  };

  const removeCustomer = async (c: Customer) => {
    // Financial records survive: the FKs are ON DELETE SET NULL, so invoices and
    // work orders are kept and simply unlinked. Say so plainly before deleting.
    if (!confirm(`Delete ${c.name}?\n\nTheir work orders and invoices are kept — they just stop being linked to a customer.`)) return;
    const { error } = await supabase.from('customers').delete().eq('id', c.id);
    if (error) return toastError(error.message);
    toastSuccess('Customer deleted');
    if (selectedId === c.id) setSelectedId(null);
    void load();
  };

  const saveContact = async () => {
    if (!contactDraft?.name?.trim() || !selectedId) return toastError('Name is required');
    const row = { ...contactDraft, customer_id: selectedId, name: contactDraft.name.trim() };
    const { error } = row.id
      ? await supabase.from('customer_contacts').update({ ...row, updated_at: new Date().toISOString() }).eq('id', row.id)
      : await supabase.from('customer_contacts').insert(row);
    if (error) return toastError(error.message);
    toastSuccess('Contact saved');
    setContactDraft(null);
    void load();
  };

  const removeContact = async (id: string) => {
    const { error } = await supabase.from('customer_contacts').delete().eq('id', id);
    if (error) return toastError(error.message);
    void load();
  };

  const saveNote = async () => {
    if (!noteDraft?.body?.trim() || !selectedId) return toastError('Write something first');
    const { error } = await supabase.from('customer_activity').insert({
      customer_id: selectedId,
      kind: noteDraft.kind ?? 'note',
      subject: noteDraft.subject ?? null,
      body: noteDraft.body.trim(),
      occurred_at: noteDraft.occurred_at ?? new Date().toISOString(),
    });
    if (error) return toastError(error.message);
    toastSuccess('Logged');
    setNoteDraft(null);
    void load();
  };

  // ── Site activity report: spreadsheet + share link ──────────────────────
  const downloadSiteCSV = (c: Customer) => {
    const mine = visits.filter((v) => v.customer_id === c.id);
    if (mine.length === 0) return toastError('No site visits logged for this customer yet');

    downloadCSVText(
      `${c.name.replace(/[^\w\s-]/g, '')} site activity ${todayISO()}.csv`,
      siteReportCSV(toReportVisits(mine)),
    );
    toastSuccess('Spreadsheet downloaded');
  };

  const shareSiteReport = async (c: Customer) => {
    // Reuse an existing token — regenerating would break links already sent.
    const { data: fresh } = await supabase
      .from('customers').select('share_token').eq('id', c.id).single();

    let tok = fresh?.share_token as string | null | undefined;
    if (!tok) {
      tok = crypto.randomUUID().replace(/-/g, '');
      const { error } = await supabase.from('customers')
        .update({ share_token: tok, updated_at: new Date().toISOString() }).eq('id', c.id);
      if (error) return toastError(error.message);
      void load();
    }

    const url = `${window.location.origin}/site-report/${tok}`;
    try {
      if (navigator.share) await navigator.share({ title: `${c.name} — site activity`, url });
      else {
        await navigator.clipboard.writeText(url);
        toastSuccess('Share link copied');
      }
    } catch {
      // User dismissed the share sheet — not an error worth shouting about.
    }
  };

  if (loading) return <div style={{ padding: 24, color: 'var(--muted)' }}>Loading customers…</div>;

  // ── Detail ──────────────────────────────────────────────────────────────
  if (selected) {
    const c = selected.customer;
    const myContacts = contacts.filter((x) => x.customer_id === c.id);
    const myActivity = activity.filter((x) => x.customer_id === c.id);
    const myWOs = workOrders.filter((w) => w.customer_id === c.id);
    const myInvoices = invoices.filter((i) => i.customer_id === c.id);
    const myVisits = visits.filter((v) => v.customer_id === c.id);
    const sc = STATUS_COLORS[c.status] ?? STATUS_COLORS.active;

    return (
      <div style={{ padding: '16px 4px', maxWidth: 1100 }}>
        <button className="btn btn-ghost" onClick={() => setSelectedId(null)} style={{ marginBottom: 12 }}>
          <ChevronLeft size={15} /> All customers
        </button>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h2 className="serif" style={{ fontSize: 26, fontWeight: 600, margin: 0 }}>{c.name}</h2>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: sc.color, background: sc.bg, borderRadius: 999, padding: '3px 10px' }}>
            {c.status}
          </span>
          <div style={{ flex: 1 }} />
          {/* Wraps rather than overflowing on phone widths. */}
          <button className="btn btn-ghost" onClick={() => downloadSiteCSV(c)} title="Download site activity as a spreadsheet">
            <Download size={14} /> Spreadsheet
          </button>
          <button className="btn btn-ghost" onClick={() => void shareSiteReport(c)} title="Share a read-only site activity report">
            <Share2 size={14} /> Share report
          </button>
          <button className="btn btn-ghost" onClick={() => setEditing(c)}>Edit</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          {[c.industry, [c.city, c.state].filter(Boolean).join(', '), c.payment_terms].filter(Boolean).join(' · ') || 'No details yet'}
        </div>

        {/* P&L — the whole point of the customer master */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 18 }}>
          <Tile label="Revenue" value={fmtMoney(selected.woRevenue)} />
          <Tile label="Tech cost" value={fmtMoney(selected.techCost)} />
          <Tile label="Profit" value={fmtMoney(selected.profit)} color="#047857" />
          <Tile label="Margin" value={pct(selected.margin)} color="#047857" />
          <Tile label="Unbilled" value={fmtMoney(selected.unbilled)} color={selected.unbilled > 0 ? '#b91c1c' : undefined} />
          <Tile label="Outstanding" value={fmtMoney(selected.outstanding)} color={selected.outstanding > 0 ? '#b45309' : undefined} />
        </div>

        {selected.neverSent > 0 && (
          <Banner tone="danger">
            {fmtMoney(selected.neverSent)} is sitting in draft invoices that were never sent.
          </Banner>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
          {/* Contacts */}
          <Panel
            title="Contacts"
            action={<button className="btn btn-ghost" onClick={() => setContactDraft({ customer_id: c.id })}><Plus size={14} /> Add</button>}
          >
            {myContacts.length === 0 && <Empty>Nobody yet. Add the person you actually call.</Empty>}
            {myContacts.map((ct) => (
              <div key={ct.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <User size={14} style={{ marginTop: 3, color: 'var(--muted)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {ct.name}{ct.is_primary && <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--teal)', marginLeft: 6 }}>PRIMARY</span>}
                  </div>
                  {ct.title && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ct.title}</div>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 3 }}>
                    {ct.phone && <a href={`tel:${ct.phone}`} style={{ fontSize: 11, color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: 3 }}><Phone size={11} /> {ct.phone}</a>}
                    {ct.email && <a href={`mailto:${ct.email}`} style={{ fontSize: 11, color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: 3 }}><Mail size={11} /> {ct.email}</a>}
                  </div>
                </div>
                <button className="btn btn-ghost" onClick={() => setContactDraft(ct)} style={{ padding: 4 }}>Edit</button>
                <button className="btn btn-ghost" onClick={() => void removeContact(ct.id)} style={{ padding: 4 }}><Trash2 size={13} /></button>
              </div>
            ))}
          </Panel>

          {/* Activity */}
          <Panel
            title="Activity"
            action={<button className="btn btn-ghost" onClick={() => setNoteDraft({ kind: 'note' })}><MessageSquarePlus size={14} /> Log</button>}
          >
            {myActivity.length === 0 && <Empty>No history logged. Every call worth remembering goes here.</Empty>}
            {myActivity.slice(0, 25).map((a) => (
              <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--teal)' }}>{a.kind}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDate(a.occurred_at)}</span>
                </div>
                {a.subject && <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{a.subject}</div>}
                {a.body && <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', marginTop: 2 }}>{a.body}</div>}
              </div>
            ))}
          </Panel>
        </div>

        {/* What they've bought */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16, marginTop: 16 }}>
          <Panel title={`Work orders (${myWOs.length})`}>
            {myWOs.length === 0 && <Empty>None linked.</Empty>}
            {myWOs.slice(0, 12).map((w) => (
              <Row key={w.id}
                left={<><b>{w.wo_number}</b>{w.title ? ` · ${w.title}` : ''}</>}
                right={fmtMoney(Number(w.total_amount ?? 0))} sub={w.wo_status} />
            ))}
          </Panel>
          <Panel title={`Invoices (${myInvoices.length})`}>
            {myInvoices.length === 0 && <Empty>None yet.</Empty>}
            {myInvoices.map((i) => (
              <Row key={i.id}
                left={<><b>{i.invoice_number}</b></>}
                right={fmtMoney(Number(i.total ?? 0))}
                sub={i.status === 'draft' ? 'draft — never sent' : i.status} />
            ))}
          </Panel>
          <Panel title={`Site visits (${myVisits.length})`}>
            {myVisits.length === 0 && <Empty>None logged.</Empty>}
            {myVisits.slice(0, 12).map((v) => (
              <Row key={v.id}
                left={[v.site_name, v.site_code ? `#${v.site_code}` : null].filter(Boolean).join(' ') || 'Visit'}
                right={v.hours ? `${v.hours}h` : ''}
                sub={`${v.visit_date ?? ''}${v.invoice_status === 'not_invoiced' ? ' · not invoiced' : ''}`} />
            ))}
          </Panel>
        </div>

        {editing && <CustomerModal editing={editing} setEditing={setEditing} onSave={saveCustomer} />}
        {contactDraft && <ContactModal draft={contactDraft} setDraft={setContactDraft} onSave={saveContact} />}
        {noteDraft && <NoteModal draft={noteDraft} setDraft={setNoteDraft} onSave={saveNote} />}
      </div>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '16px 4px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <h2 className="serif" style={{ fontSize: 26, fontWeight: 600, margin: 0 }}>Customers</h2>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--muted)' }} />
          <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 30, minWidth: 180 }} />
        </div>
        <button className="btn" onClick={() => setEditing({ status: 'active' })}><Plus size={15} /> New Customer</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
        <Tile label="Revenue" value={fmtMoney(totals.revenue)} />
        <Tile label="Profit" value={fmtMoney(totals.profit)} color="#047857" />
        <Tile label="Never sent" value={fmtMoney(totals.neverSent)} color={totals.neverSent > 0 ? '#b91c1c' : undefined} />
        <Tile label="Unbilled" value={fmtMoney(totals.unbilled)} color={totals.unbilled > 0 ? '#b91c1c' : undefined} />
        <Tile label="Outstanding" value={fmtMoney(totals.outstanding)} color={totals.outstanding > 0 ? '#b45309' : undefined} />
      </div>

      {orphans > 0 && (
        <Banner tone="warn">
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {orphans} record{orphans !== 1 ? 's' : ''} name a customer that isn&apos;t linked yet, so they&apos;re missing from these totals.
          Open the record and pick a customer to fold it in.
        </Banner>
      )}

      {filtered.length === 0 && <Empty>No customers match.</Empty>}

      <div style={{ display: 'grid', gap: 10 }}>
        {filtered.map((b) => <CustomerCard key={b.customer.id} book={b} onOpen={() => setSelectedId(b.customer.id)} onDelete={() => void removeCustomer(b.customer)} />)}
      </div>

      {editing && <CustomerModal editing={editing} setEditing={setEditing} onSave={saveCustomer} />}
    </div>
  );
}

// ── Presentational bits ────────────────────────────────────────────────────

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: color ?? 'inherit', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)' }}>{title}</div>
        <div style={{ flex: 1 }} />
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ left, right, sub }: { left: React.ReactNode; right?: React.ReactNode; sub?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
        {left}
        {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
      </div>
      {right && <div style={{ fontSize: 13, fontWeight: 700 }}>{right}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 0' }}>{children}</div>;
}

function Banner({ tone, children }: { tone: 'warn' | 'danger'; children: React.ReactNode }) {
  const c = tone === 'danger'
    ? { color: '#b91c1c', bg: 'rgba(185,28,28,0.08)' }
    : { color: '#b45309', bg: 'rgba(245,158,11,0.10)' };
  return (
    <div style={{ background: c.bg, color: c.color, borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function CustomerCard({ book, onOpen, onDelete }: { book: CustomerBook; onOpen: () => void; onDelete: () => void }) {
  const c = book.customer;
  const sc = STATUS_COLORS[c.status] ?? STATUS_COLORS.active;
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      {/* Wraps on phone widths — Fred runs this from the field. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Building2 size={16} style={{ color: 'var(--teal)' }} />
        <button onClick={onOpen} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 16, fontWeight: 700, color: 'inherit', textAlign: 'left' }}>
          {c.name}
        </button>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: sc.color, background: sc.bg, borderRadius: 999, padding: '2px 8px' }}>
          {c.status}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={onDelete} style={{ padding: 4 }}><Trash2 size={14} /></button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 10, fontSize: 12 }}>
        <Stat label="Revenue" value={fmtMoney(book.woRevenue)} />
        <Stat label="Profit" value={fmtMoney(book.profit)} color="#047857" />
        <Stat label="Margin" value={pct(book.margin)} />
        <Stat label="Visits" value={String(book.visitCount)} />
        {book.unbilled > 0 && <Stat label="Unbilled" value={fmtMoney(book.unbilled)} color="#b91c1c" />}
        {book.outstanding > 0 && <Stat label="Outstanding" value={fmtMoney(book.outstanding)} color="#b45309" />}
        {book.neverSent > 0 && <Stat label="Never sent" value={fmtMoney(book.neverSent)} color="#b91c1c" />}
      </div>
      {/* Fred's own fields (Settings -> Custom fields), when answered. */}
      <div style={{ marginTop: 8 }}><CustomFieldList target="customers" values={c.custom} compact /></div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? 'inherit' }}>{value}</div>
    </div>
  );
}

function Modal({ title, onClose, onSave, children }: { title: string; onClose: () => void; onSave: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-overlay" {...backdropClose(onClose)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div className="serif" style={{ fontSize: 19, fontWeight: 600 }}>{title}</div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 4 }}><X size={16} /></button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>{children}</div>
        <div className="save-bar">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      {children}
    </label>
  );
}

function CustomerModal({ editing, setEditing, onSave }: {
  editing: Partial<Customer>;
  setEditing: (c: Partial<Customer> | null) => void;
  onSave: () => void;
}) {
  const set = <K extends keyof Customer>(k: K, v: Customer[K]) => setEditing({ ...editing, [k]: v });
  return (
    <Modal title={editing.id ? 'Edit customer' : 'New customer'} onClose={() => setEditing(null)} onSave={onSave}>
      <Field label="Name"><input className="input" value={editing.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
      <Field label="Status">
        <select className="input" value={editing.status ?? 'active'} onChange={(e) => set('status', e.target.value as CustomerStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Industry"><input className="input" value={editing.industry ?? ''} onChange={(e) => set('industry', e.target.value)} /></Field>
        <Field label="How they found you"><input className="input" value={editing.source ?? ''} onChange={(e) => set('source', e.target.value)} /></Field>
        <Field label="Billing email"><input className="input" type="email" value={editing.billing_email ?? ''} onChange={(e) => set('billing_email', e.target.value)} /></Field>
        <Field label="Billing phone"><input className="input" value={editing.billing_phone ?? ''} onChange={(e) => set('billing_phone', e.target.value)} /></Field>
      </div>
      <Field label="Address"><input className="input" value={editing.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
        <Field label="City"><input className="input" value={editing.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="State"><input className="input" value={editing.state ?? ''} onChange={(e) => set('state', e.target.value)} /></Field>
        <Field label="ZIP"><input className="input" value={editing.zip ?? ''} onChange={(e) => set('zip', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Payment terms"><input className="input" placeholder="Net 30" value={editing.payment_terms ?? ''} onChange={(e) => set('payment_terms', e.target.value)} /></Field>
        <Field label="Mileage rate ($/mi)">
          <input className="input" type="number" step="0.01" placeholder="default"
            value={editing.default_mileage_rate ?? ''}
            onChange={(e) => set('default_mileage_rate', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Notes"><textarea className="input" rows={3} value={editing.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      <CustomFieldInputs target="customers" values={asValues(editing.custom)} onChange={(v) => set('custom', v)} />
    </Modal>
  );
}

function ContactModal({ draft, setDraft, onSave }: {
  draft: Partial<CustomerContact>;
  setDraft: (c: Partial<CustomerContact> | null) => void;
  onSave: () => void;
}) {
  const set = <K extends keyof CustomerContact>(k: K, v: CustomerContact[K]) => setDraft({ ...draft, [k]: v });
  return (
    <Modal title={draft.id ? 'Edit contact' : 'Add contact'} onClose={() => setDraft(null)} onSave={onSave}>
      <Field label="Name"><input className="input" value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
      <Field label="Title"><input className="input" value={draft.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Phone"><input className="input" value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input className="input" type="email" value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={draft.is_primary ?? false} onChange={(e) => set('is_primary', e.target.checked)} />
        Primary contact
      </label>
      <Field label="Notes"><textarea className="input" rows={2} value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
    </Modal>
  );
}

function NoteModal({ draft, setDraft, onSave }: {
  draft: Partial<CustomerActivity>;
  setDraft: (c: Partial<CustomerActivity> | null) => void;
  onSave: () => void;
}) {
  return (
    <Modal title="Log activity" onClose={() => setDraft(null)} onSave={onSave}>
      <Field label="Kind">
        <select className="input" value={draft.kind ?? 'note'} onChange={(e) => setDraft({ ...draft, kind: e.target.value as CustomerActivityKind })}>
          {ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>
      <Field label="Subject"><input className="input" value={draft.subject ?? ''} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
      <Field label="What happened">
        <textarea className="input" rows={4} value={draft.body ?? ''} onChange={(e) => setDraft({ ...draft, body: e.target.value })} autoFocus />
      </Field>
    </Modal>
  );
}
