'use client';
import { useState, useRef, useEffect } from 'react';
import { Search, X, Briefcase, Users, CreditCard } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import type { EnrichedWorkOrder, Contractor, Payment } from '@/lib/types';

type Result =
  | { type: 'wo'; data: EnrichedWorkOrder }
  | { type: 'contractor'; data: Contractor }
  | { type: 'payment'; data: Payment };

export default function GlobalSearch({
  open, onClose, workOrders, contractors, payments, onSelect,
}: {
  open: boolean;
  onClose: () => void;
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  payments: Payment[];
  onSelect: (r: Result) => void;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); setQ(''); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  if (!open) return null;

  const query = q.toLowerCase();
  const results: Result[] = [];

  if (query.length >= 2) {
    for (const w of workOrders) {
      if (results.length >= 12) break;
      if (
        w.wo_number.includes(q) ||
        w.contractor_name.toLowerCase().includes(query) ||
        (w.title ?? '').toLowerCase().includes(query) ||
        (w.site_city ?? '').toLowerCase().includes(query)
      ) results.push({ type: 'wo', data: w });
    }
    for (const c of contractors) {
      if (results.length >= 12) break;
      if (
        c.name.toLowerCase().includes(query) ||
        (c.email ?? '').toLowerCase().includes(query) ||
        (c.phone ?? '').includes(q)
      ) results.push({ type: 'contractor', data: c });
    }
    for (const p of payments) {
      if (results.length >= 12) break;
      if (
        p.wo_number.includes(q) ||
        p.contractor_name.toLowerCase().includes(query) ||
        (p.notes ?? '').toLowerCase().includes(query)
      ) results.push({ type: 'payment', data: p });
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 120 }}
      onClick={() => { onClose(); setQ(''); }}
    >
      <div
        style={{ width: '100%', maxWidth: 560, background: 'white', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid #eee' }}>
          <Search size={18} color="var(--teal)" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search work orders, contractors, payments..."
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontFamily: 'Lato, sans-serif', background: 'transparent', color: 'inherit' }}
          />
          <button onClick={() => { onClose(); setQ(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa' }}>
            <X size={18} />
          </button>
        </div>

        {results.length > 0 && (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => { onSelect(r); onClose(); setQ(''); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #f5f5f5', fontFamily: 'Lato, sans-serif' }}
                onMouseOver={(e) => (e.currentTarget.style.background = '#f9fafb')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
              >
                {r.type === 'wo' && <Briefcase size={14} color="var(--teal)" />}
                {r.type === 'contractor' && <Users size={14} color="var(--teal)" />}
                {r.type === 'payment' && <CreditCard size={14} color="var(--teal)" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.type === 'wo' && `#${r.data.wo_number} — ${r.data.title || r.data.contractor_name}`}
                    {r.type === 'contractor' && r.data.name}
                    {r.type === 'payment' && `Payment — WO#${r.data.wo_number} · ${r.data.contractor_name}`}
                  </div>
                  <div style={{ fontSize: 11, color: '#888' }}>
                    {r.type === 'wo' && `${r.data.contractor_name} · ${fmtMoney(Number(r.data.total_amount))}`}
                    {r.type === 'contractor' && (r.data.email || r.data.phone || '')}
                    {r.type === 'payment' && `${fmtMoney(Number(r.data.amount))} · ${r.data.method}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {q.length >= 2 && results.length === 0 && (
          <div style={{ padding: '24px 20px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
            No results for &ldquo;{q}&rdquo;
          </div>
        )}

        <div style={{ padding: '10px 20px', borderTop: '1px solid #eee', fontSize: 11, color: '#aaa', display: 'flex', gap: 16 }}>
          <span><kbd style={{ padding: '2px 6px', background: '#f0f0f0', borderRadius: 4, fontSize: 10 }}>Ctrl+K</kbd> to open</span>
          <span><kbd style={{ padding: '2px 6px', background: '#f0f0f0', borderRadius: 4, fontSize: 10 }}>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
