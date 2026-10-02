'use client';
import { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, Printer, CheckCircle2, FileText, Share2, FileCheck2, Layers } from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { printQuoteSheet } from '@/lib/signoff';
import { createClient } from '@/lib/supabase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import { kitCost, kitToQuoteLine, kitToQuoteLines } from '@/lib/material-kits';
import type { Material, MaterialKit, Quote, QuoteLineItem, QuoteStatus } from '@/lib/types';
import { backdropClose } from '@/lib/backdrop';

const STATUS_META: Record<QuoteStatus, { label: string; color: string; bg: string }> = {
  draft:    { label: 'Draft',    color: '#666',    bg: 'rgba(0,0,0,0.06)' },
  sent:     { label: 'Sent',     color: '#1D4ED8', bg: 'rgba(59,130,246,0.12)' },
  accepted: { label: 'Accepted', color: '#047857', bg: 'rgba(16,185,129,0.12)' },
  rejected: { label: 'Rejected', color: '#b91c1c', bg: 'rgba(239,68,68,0.12)' },
  expired:  { label: 'Expired',  color: '#999',    bg: 'rgba(0,0,0,0.04)' },
};

export function nextQuoteNumber(quotes: Quote[]): string {
  const year = new Date().getFullYear();
  const thisYear = quotes.filter((q) => q.quote_number?.startsWith(`Q-${year}-`));
  const nums = thisYear.map((q) => parseInt(q.quote_number.split('-')[2] ?? '0', 10)).filter((n) => !isNaN(n));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `Q-${year}-${String(next).padStart(3, '0')}`;
}

function newLineItem(): QuoteLineItem {
  return { id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, description: '', quantity: 1, rate: 0 };
}

export default function QuotesView({
  quotes,
  materials = [],
  kits = [],
  onSave,
  onDelete,
  onAccept,
  onBuildContract,
}: {
  quotes: Quote[];
  materials?: Material[];
  kits?: MaterialKit[];
  onSave: (q: Partial<Quote>) => Promise<void>;
  onDelete: (id: string) => void;
  onAccept: (quote: Quote) => Promise<void>;
  onBuildContract: (quote: Quote) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Partial<Quote> | null>(null);
  const supabase = createClient();

  // Share a client-facing link (/quote/<token>) — token created once and
  // reused forever, so a link you already sent never breaks.
  const shareQuote = async (q: Quote) => {
    const { data } = await supabase.from('quotes').select('share_token').eq('id', q.id).single();
    let token = (data?.share_token as string | null) ?? null;
    if (!token) {
      token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
      const { error } = await supabase.from('quotes')
        .update({ share_token: token, updated_at: new Date().toISOString() }).eq('id', q.id);
      if (error) { toastError(`Couldn't create share link: ${error.message}`); return; }
    }
    const url = `${window.location.origin}/quote/${token}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Quote ${q.quote_number} — FAJ Solutions LLC`, url });
        return;
      } catch { /* user closed the share sheet — fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess('Quote link copied — text or email it to your client');
    } catch {
      window.prompt('Copy this quote link:', url);
    }
  };

  const sorted = useMemo(
    () => [...quotes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [quotes],
  );

  return (
    <div className="view-inner" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>QUOTES</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Quotes</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>{quotes.length} quote{quotes.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ quote_number: nextQuoteNumber(quotes) })}>
          <Plus size={14} /> New Quote
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          <FileText size={28} color="#ddd" style={{ marginBottom: 8 }} />
          <div>No quotes yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sorted.map((q) => {
            const sm = STATUS_META[q.status] ?? STATUS_META.draft;
            return (
              <div key={q.id} className="glass card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--teal)' }}>{q.quote_number}</span>
                    <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: sm.bg, color: sm.color }}>{sm.label}</span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{q.title || q.client_name || 'Untitled'}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                    {q.client_name}{q.client_email ? ` · ${q.client_email}` : ''} · {fmtDate(q.created_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(q.total)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button title="Share with client — public link, no login needed" onClick={() => shareQuote(q)} style={{ ...ICON_BTN, color: 'var(--teal)' }}><Share2 size={15} /></button>
                    <button title="Print" onClick={() => printQuoteSheet(q)} style={ICON_BTN}><Printer size={15} /></button>
                    <button title="Edit" onClick={() => setEditing(q)} style={ICON_BTN}><Edit2 size={15} /></button>
                    {q.status !== 'accepted' && (
                      <button title="Accept & Create Work Order" onClick={() => onAccept(q)} style={{ ...ICON_BTN, color: '#047857' }}><CheckCircle2 size={15} /></button>
                    )}
                    <button
                      title={q.contract_id ? 'Contract already built — see the Contracts tab' : 'Build Contract from this quote'}
                      onClick={() => { if (!q.contract_id) onBuildContract(q); }}
                      disabled={!!q.contract_id}
                      style={{ ...ICON_BTN, color: '#7c3aed', opacity: q.contract_id ? 0.35 : 1 }}
                    ><FileCheck2 size={15} /></button>
                    <button title="Delete" onClick={() => { if (confirm(`Delete quote ${q.quote_number}?`)) onDelete(q.id); }} style={{ ...ICON_BTN, color: '#b91c1c' }}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <QuoteModal
          item={editing}
          materials={materials}
          kits={kits}
          onSave={async (q) => { await onSave(q); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const ICON_BTN: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#888' };

function QuoteModal({
  item, materials, kits, onSave, onClose,
}: {
  item: Partial<Quote>;
  materials: Material[];
  kits: MaterialKit[];
  onSave: (q: Partial<Quote>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Quote>>({
    quote_number: '', client_name: '', client_email: '', client_phone: '',
    title: '', description: '', line_items: [newLineItem()], tax_rate: 0,
    status: 'draft', notes: '', valid_until: '',
    ...item,
  });
  const set = <K extends keyof Quote>(k: K, v: Quote[K]) => setForm((f) => ({ ...f, [k]: v }));

  const lineItems = form.line_items ?? [];
  const subtotal = lineItems.reduce((s, li) => s + Number(li.quantity) * Number(li.rate), 0);
  const taxAmount = subtotal * (Number(form.tax_rate ?? 0) / 100);
  const total = subtotal + taxAmount;

  const updateLine = (id: string, patch: Partial<QuoteLineItem>) =>
    set('line_items', lineItems.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  const addLine = () => set('line_items', [...lineItems, newLineItem()]);
  const removeLine = (id: string) => set('line_items', lineItems.filter((li) => li.id !== id));

  // A saved materials kit, priced into the quote before the work starts.
  // Rolled into ONE line by default: a quote is a client-facing document, and
  // an itemised parts list publishes what FAJ pays for every part on it.
  const [itemiseKit, setItemiseKit] = useState(false);
  const addKit = (kitId: string) => {
    const kit = kits.find((k) => k.id === kitId);
    if (!kit) return;
    const added = itemiseKit
      ? kitToQuoteLines(kit.items, materials)
      : [kitToQuoteLine(kit.name, kit.items, materials)];
    if (added.length === 0) { toastError(kit.name + ' has nothing in it yet'); return; }
    // A quote starts with one blank line; drop it rather than leave a stray row.
    const kept = lineItems.filter((li) => li.description.trim() !== '' || li.quantity !== 1 || li.rate !== 0);
    set('line_items', [...kept, ...added]);
  };

  const handleSave = () => onSave({ ...form, subtotal, tax_amount: taxAmount, total });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} {...backdropClose(onClose)}>
      <div className="glass card" style={{ width: 620, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item.id ? `Edit ${form.quote_number}` : `New Quote — ${form.quote_number}`}</div>
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
            <Field label="Valid Until"><input className="input" type="date" value={form.valid_until ?? ''} onChange={(e) => set('valid_until', e.target.value)} /></Field>
          </div>
          <Field label="Description / Scope"><textarea className="input" rows={2} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Line Items</label>
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
            {kits.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 8, background: 'rgba(14,27,46,0.04)', border: '1px solid rgba(14,27,46,0.15)' }}>
                <Layers size={13} style={{ color: 'var(--teal)', flexShrink: 0 }} />
                <select
                  className="select input"
                  value=""
                  onChange={(e) => { if (e.target.value) addKit(e.target.value); e.target.value = ''; }}
                  style={{ fontSize: 12, flex: '1 1 200px' }}
                >
                  <option value="">Price in a materials kit&hellip;</option>
                  {[...kits].sort((a, b) => a.name.localeCompare(b.name)).map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({fmtMoney(kitCost(k.items))} at cost)
                    </option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555', whiteSpace: 'nowrap' }} title="Off: one line for the whole kit, so the client does not see what each part costs you. On: every part listed separately.">
                  <input type="checkbox" checked={itemiseKit} onChange={(e) => setItemiseKit(e.target.checked)} />
                  List every part
                </label>
              </div>
            )}
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
              Kit lines come in at your cost. Set the rate to what the client pays before you send it.
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 13, padding: '10px 0', borderTop: '1px solid #eee' }}>
            <div>Subtotal: <strong>{fmtMoney(subtotal)}</strong></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Tax %: <input className="input" type="number" step="0.1" style={{ width: 60 }} value={form.tax_rate ?? 0} onChange={(e) => set('tax_rate', Number(e.target.value))} />
            </div>
            <div style={{ color: 'var(--teal)' }}>Total: <strong>{fmtMoney(total)}</strong></div>
          </div>

          <Field label="Status">
            <select className="select input" value={form.status ?? 'draft'} onChange={(e) => set('status', e.target.value as QuoteStatus)}>
              {(['draft', 'sent', 'accepted', 'rejected', 'expired'] as QuoteStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Notes"><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!form.client_name}>Save Quote</button>
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
