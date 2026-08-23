'use client';
import { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, Printer, Receipt, DollarSign, Briefcase, Share2, Send } from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { printInvoiceSheet } from '@/lib/signoff';
import EmailModal, { type EmailPayload } from '@/components/EmailModal';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import { PAYMENT_METHODS } from '@/lib/types';
import type { Invoice, InvoiceLineItem, InvoicePayment, InvoiceStatus, WorkOrder } from '@/lib/types';

// Display statuses go beyond the four stored ones: partial and overdue are
// derived from payments and due_date at render time.
type DisplayStatus = InvoiceStatus | 'partial' | 'overdue';

const STATUS_META: Record<DisplayStatus, { label: string; color: string; bg: string }> = {
  draft:   { label: 'Draft',    color: '#666',    bg: 'rgba(0,0,0,0.06)' },
  sent:    { label: 'Sent',     color: '#1D4ED8', bg: 'rgba(59,130,246,0.12)' },
  partial: { label: 'Partial',  color: '#b45309', bg: 'rgba(245,158,11,0.14)' },
  overdue: { label: 'Overdue',  color: '#b91c1c', bg: 'rgba(239,68,68,0.12)' },
  paid:    { label: 'Paid',     color: '#047857', bg: 'rgba(16,185,129,0.12)' },
  void:    { label: 'Void',     color: '#999',    bg: 'rgba(0,0,0,0.04)' },
};

/** Whole days a draft invoice has been sitting unsent — nothing can be paid
 *  until it goes out, so the list calls this out once it starts to age. */
function draftAgeDays(inv: Invoice): number {
  const created = new Date(inv.created_at).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
}

function displayStatus(inv: Invoice, paid: number): DisplayStatus {
  if (inv.status === 'draft' || inv.status === 'paid' || inv.status === 'void') return inv.status;
  const today = new Date().toISOString().slice(0, 10);
  if (inv.due_date && inv.due_date < today) return 'overdue';
  if (paid > 0 && paid < Number(inv.total)) return 'partial';
  return 'sent';
}

function nextInvoiceNumber(invoices: Invoice[]): string {
  const year = new Date().getFullYear();
  const thisYear = invoices.filter((i) => i.invoice_number?.startsWith(`INV-${year}-`));
  const nums = thisYear.map((i) => parseInt(i.invoice_number.split('-')[2] ?? '0', 10)).filter((n) => !isNaN(n));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `INV-${year}-${String(next).padStart(3, '0')}`;
}

function newLineItem(): InvoiceLineItem {
  return { id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, description: '', quantity: 1, rate: 0 };
}

export default function InvoicesView({
  invoices,
  invoicePayments,
  workOrders,
  onSave,
  onDelete,
  onRecordPayment,
  onDeletePayment,
}: {
  invoices: Invoice[];
  invoicePayments: InvoicePayment[];
  workOrders: WorkOrder[];
  onSave: (inv: Partial<Invoice>) => Promise<void>;
  onDelete: (id: string) => void;
  onRecordPayment: (invoice: Invoice, p: { amount: number; payment_date: string; method: string; reference: string }) => Promise<void>;
  onDeletePayment: (invoice: Invoice, paymentId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Partial<Invoice> | null>(null);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [emailing, setEmailing] = useState<{ payload: EmailPayload; invoice: Invoice } | null>(null);
  const supabase = createClient();

  // One share token per invoice, minted on first use and reused forever so a
  // link already sitting in a client's inbox never stops working.
  const ensureShareToken = async (inv: Invoice): Promise<string | null> => {
    const { data } = await supabase.from('invoices').select('share_token').eq('id', inv.id).single();
    let token = (data?.share_token as string | null) ?? null;
    if (token) return token;
    token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
    const { error } = await supabase.from('invoices')
      .update({ share_token: token, updated_at: new Date().toISOString() }).eq('id', inv.id);
    if (error) { toastError(`Couldn't create share link: ${error.message}`); return null; }
    return token;
  };

  // Email the invoice to the client and, only once Resend accepts it, move the
  // invoice from draft to sent. Nothing is sent without Fred pressing Send in
  // the modal — this just prepares the message.
  const sendInvoice = async (inv: Invoice) => {
    const token = await ensureShareToken(inv);
    const shareUrl = token ? `${window.location.origin}/invoice/${token}` : null;
    setEmailing({
      invoice: inv,
      payload: {
        type: 'invoice',
        to: inv.client_email ?? '',
        subject: `Invoice ${inv.invoice_number} from FAJ Solutions${inv.client_name ? ` — ${inv.client_name}` : ''}`,
        data: { invoice: inv, shareUrl },
      },
    });
  };

  const markSent = async (inv: Invoice) => {
    if (inv.status !== 'draft') return;
    await onSave({ id: inv.id, status: 'sent', sent_at: new Date().toISOString() });
    toastSuccess(`${inv.invoice_number} marked as sent`);
  };

  // Share a client-facing link (/invoice/<token>) — creates the token once,
  // reuses it forever so a link you already sent never breaks. Uses the
  // phone's native share sheet when available, else copies to clipboard.
  const shareInvoice = async (inv: Invoice) => {
    const token = await ensureShareToken(inv);
    if (!token) return;
    const url = `${window.location.origin}/invoice/${token}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Invoice ${inv.invoice_number} — FAJ Solutions LLC`, url });
        return;
      } catch { /* user closed the share sheet — fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess('Invoice link copied — text or email it to your client');
    } catch {
      window.prompt('Copy this invoice link:', url);
    }
  };

  const paidByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of invoicePayments) m.set(p.invoice_id, (m.get(p.invoice_id) ?? 0) + Number(p.amount));
    return m;
  }, [invoicePayments]);

  const sorted = useMemo(
    () => [...invoices].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [invoices],
  );

  const stats = useMemo(() => {
    let outstanding = 0, overdue = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const inv of invoices) {
      if (inv.status !== 'sent') continue;
      const bal = Number(inv.total) - (paidByInvoice.get(inv.id) ?? 0);
      if (bal <= 0) continue;
      outstanding += bal;
      if (inv.due_date && inv.due_date < today) overdue += bal;
    }
    const year = String(new Date().getFullYear());
    const collectedYtd = invoicePayments
      .filter((p) => p.payment_date?.startsWith(year))
      .reduce((s, p) => s + Number(p.amount), 0);
    return { outstanding, overdue, collectedYtd };
  }, [invoices, invoicePayments, paidByInvoice]);

  return (
    <div className="view-inner" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>INVOICES</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Invoices</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ invoice_number: nextInvoiceNumber(invoices) })}>
          <Plus size={14} /> New Invoice
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatTile label="Outstanding" value={fmtMoney(stats.outstanding)} color="var(--teal)" />
        <StatTile label="Overdue" value={fmtMoney(stats.overdue)} color={stats.overdue > 0 ? '#b91c1c' : '#047857'} />
        <StatTile label={`Collected ${new Date().getFullYear()}`} value={fmtMoney(stats.collectedYtd)} color="#047857" />
      </div>

      {sorted.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          <Receipt size={28} color="#ddd" style={{ marginBottom: 8 }} />
          <div>No invoices yet. Bill a client to start tracking what you&apos;re owed.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sorted.map((inv) => {
            const paid = paidByInvoice.get(inv.id) ?? 0;
            const ds = displayStatus(inv, paid);
            const sm = STATUS_META[ds];
            const balance = Math.max(0, Number(inv.total) - paid);
            return (
              <div key={inv.id} className="glass card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--teal)' }}>{inv.invoice_number}</span>
                    <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: sm.bg, color: sm.color }}>{sm.label}</span>
                    {inv.status === 'draft' && draftAgeDays(inv) >= 3 && (
                      <span title="This invoice has never been sent — the client cannot pay it yet." style={{ fontSize: 10, fontWeight: 700, color: '#b91c1c' }}>
                        never sent · {draftAgeDays(inv)}d
                      </span>
                    )}
                    {inv.work_order_ids.length > 0 && (
                      <span title={`${inv.work_order_ids.length} linked work order${inv.work_order_ids.length !== 1 ? 's' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#888' }}>
                        <Briefcase size={11} /> {inv.work_order_ids.length}
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{inv.title || inv.client_name || 'Untitled'}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                    {inv.client_name}{inv.client_email ? ` · ${inv.client_email}` : ''} · {fmtDate(inv.created_at)}
                    {inv.due_date ? ` · Due ${fmtDate(inv.due_date)}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(inv.total)}</div>
                    {inv.status !== 'draft' && inv.status !== 'void' && balance > 0 && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: ds === 'overdue' ? '#b91c1c' : '#888' }}>{fmtMoney(balance)} due</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {inv.status !== 'void' && inv.status !== 'draft' && (
                      <button title="Record Payment" onClick={() => setPaying(inv)} style={{ ...ICON_BTN, color: '#047857' }}><DollarSign size={15} /></button>
                    )}
                    {inv.status !== 'void' && inv.status !== 'paid' && (
                      <button title={inv.status === 'draft' ? 'Email this invoice to the client' : 'Email this invoice again'} onClick={() => sendInvoice(inv)} style={{ ...ICON_BTN, color: '#1D4ED8' }}><Send size={15} /></button>
                    )}
                    <button title="Share with client — public link, no login needed" onClick={() => shareInvoice(inv)} style={{ ...ICON_BTN, color: 'var(--teal)' }}><Share2 size={15} /></button>
                    <button title="Print" onClick={() => printInvoiceSheet(inv, paid)} style={ICON_BTN}><Printer size={15} /></button>
                    <button title="Edit" onClick={() => setEditing(inv)} style={ICON_BTN}><Edit2 size={15} /></button>
                    <button title="Delete" onClick={() => { if (confirm(`Delete invoice ${inv.invoice_number}? Recorded payments on it are deleted too.`)) onDelete(inv.id); }} style={{ ...ICON_BTN, color: '#b91c1c' }}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <InvoiceModal
          item={editing}
          workOrders={workOrders}
          onSave={async (inv) => { await onSave(inv); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
      {paying && (
        <RecordPaymentModal
          invoice={paying}
          payments={invoicePayments.filter((p) => p.invoice_id === paying.id)}
          onRecord={async (p) => { await onRecordPayment(paying, p); setPaying(null); }}
          onDeletePayment={async (pid) => { await onDeletePayment(paying, pid); setPaying(null); }}
          onClose={() => setPaying(null)}
        />
      )}
      {emailing && (
        <EmailModal
          payload={emailing.payload}
          onSent={() => markSent(emailing.invoice)}
          onClose={() => setEmailing(null)}
        />
      )}
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="glass card" style={{ padding: '14px 18px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

const ICON_BTN: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#888' };

function InvoiceModal({
  item, workOrders, onSave, onClose,
}: {
  item: Partial<Invoice>;
  workOrders: WorkOrder[];
  onSave: (inv: Partial<Invoice>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Invoice>>({
    invoice_number: '', client_name: '', client_email: '', client_phone: '',
    title: '', description: '', line_items: [newLineItem()], tax_rate: 0,
    status: 'draft', notes: '', due_date: '',
    ...item,
  });
  const set = <K extends keyof Invoice>(k: K, v: Invoice[K]) => setForm((f) => ({ ...f, [k]: v }));

  const lineItems = form.line_items ?? [];
  const subtotal = lineItems.reduce((s, li) => s + Number(li.quantity) * Number(li.rate), 0);
  const taxAmount = subtotal * (Number(form.tax_rate ?? 0) / 100);
  const total = subtotal + taxAmount;

  const updateLine = (id: string, patch: Partial<InvoiceLineItem>) =>
    set('line_items', lineItems.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  const addLine = () => set('line_items', [...lineItems, newLineItem()]);
  const removeLine = (id: string) => set('line_items', lineItems.filter((li) => li.id !== id));

  // Work orders already billed on this invoice (line id carries the WO id).
  const linkedWoIds = new Set(lineItems.filter((li) => li.id.startsWith('wo-')).map((li) => li.id.slice(3)));
  const addWorkOrderLine = (woId: string) => {
    const wo = workOrders.find((w) => w.id === woId);
    if (!wo || linkedWoIds.has(wo.id)) return;
    const desc = `WO#${wo.wo_number}${wo.title ? ` — ${wo.title}` : ''}`;
    const line: InvoiceLineItem = { id: `wo-${wo.id}`, description: desc, quantity: 1, rate: Number(wo.total_amount ?? 0) };
    // Replace a single untouched blank line instead of appending after it.
    const meaningful = lineItems.filter((li) => li.description || Number(li.rate) !== 0);
    set('line_items', [...meaningful, line]);
    if (!form.client_name && wo.customer_name) set('client_name', wo.customer_name);
  };

  const handleSave = () => {
    const work_order_ids = (form.line_items ?? []).filter((li) => li.id.startsWith('wo-')).map((li) => li.id.slice(3));
    onSave({ ...form, subtotal, tax_amount: taxAmount, total, work_order_ids });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={onClose}>
      <div className="glass card" style={{ width: 640, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item.id ? `Edit ${form.invoice_number}` : `New Invoice — ${form.invoice_number}`}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Title"><input className="input" value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Client Name"><input className="input" value={form.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} /></Field>
            <Field label="Client Email"><input className="input" value={form.client_email ?? ''} onChange={(e) => set('client_email', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Client Phone"><input className="input" value={form.client_phone ?? ''} onChange={(e) => set('client_phone', e.target.value)} /></Field>
            <Field label="Due Date"><input className="input" type="date" value={form.due_date ?? ''} onChange={(e) => set('due_date', e.target.value)} /></Field>
          </div>
          <Field label="Description / Work Performed"><textarea className="input" rows={2} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase' }}>Line Items</label>
              <select
                className="select input"
                style={{ width: 240, fontSize: 12 }}
                value=""
                onChange={(e) => { if (e.target.value) addWorkOrderLine(e.target.value); }}
              >
                <option value="">+ Bill a work order…</option>
                {workOrders
                  .filter((w) => !linkedWoIds.has(w.id))
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      WO#{w.wo_number} · {w.customer_name || w.title || 'Untitled'} · {fmtMoney(w.total_amount ?? 0)}
                    </option>
                  ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lineItems.map((li) => (
                <div key={li.id} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 90px 24px', gap: 6, alignItems: 'center' }}>
                  <input className="input" placeholder="Description" value={li.description} onChange={(e) => updateLine(li.id, { description: e.target.value })} />
                  <input className="input" type="number" placeholder="Qty" value={li.quantity} onChange={(e) => updateLine(li.id, { quantity: Number(e.target.value) })} />
                  <input className="input" type="number" step="0.01" placeholder="Rate" value={li.rate} onChange={(e) => updateLine(li.id, { rate: Number(e.target.value) })} />
                  <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtMoney(li.quantity * li.rate)}</div>
                  <button onClick={() => removeLine(li.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c' }}><X size={14} /></button>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={addLine}><Plus size={12} /> Add Line</button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 13, padding: '10px 0', borderTop: '1px solid #eee' }}>
            <div>Subtotal: <strong>{fmtMoney(subtotal)}</strong></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Tax %: <input className="input" type="number" step="0.1" style={{ width: 60 }} value={form.tax_rate ?? 0} onChange={(e) => set('tax_rate', Number(e.target.value))} />
            </div>
            <div style={{ color: 'var(--teal)' }}>Total: <strong>{fmtMoney(total)}</strong></div>
          </div>

          <Field label="Status">
            <select className="select input" value={form.status ?? 'draft'} onChange={(e) => set('status', e.target.value as InvoiceStatus)}>
              {(['draft', 'sent', 'paid', 'void'] as InvoiceStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Notes"><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!form.client_name}>Save Invoice</button>
        </div>
      </div>
    </div>
  );
}

function RecordPaymentModal({
  invoice, payments, onRecord, onDeletePayment, onClose,
}: {
  invoice: Invoice;
  payments: InvoicePayment[];
  onRecord: (p: { amount: number; payment_date: string; method: string; reference: string }) => void;
  onDeletePayment: (paymentId: string) => void;
  onClose: () => void;
}) {
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(0, Number(invoice.total) - paid);
  const [amount, setAmount] = useState<number>(balance);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<string>('Zelle');
  const [reference, setReference] = useState<string>('');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={onClose}>
      <div className="glass card" style={{ width: 440, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Record Payment — {invoice.invoice_number}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
          {fmtMoney(invoice.total)} total · {fmtMoney(paid)} paid · <strong style={{ color: balance > 0 ? '#b91c1c' : '#047857' }}>{fmtMoney(balance)} due</strong>
        </div>

        {payments.length > 0 && (
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, padding: '6px 10px', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
                <span>{fmtDate(p.payment_date)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <strong>{fmtMoney(p.amount)}</strong>
                  <button title="Delete payment" onClick={() => { if (confirm(`Delete this ${fmtMoney(p.amount)} payment?`)) onDeletePayment(p.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 2 }}><Trash2 size={12} /></button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Amount"><input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
            <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Method">
              <select className="select input" value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Reference / Check #"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onRecord({ amount, payment_date: date, method, reference })} disabled={!(amount > 0)}>
            Record {fmtMoney(amount || 0)}
          </button>
        </div>
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
