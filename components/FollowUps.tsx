'use client';
// "Follow up" on Home (lib/follow-ups.ts): reminders already written. Text or Email opens Fred's own app
// with the message filled in; nothing is sent until he presses send there.
import { useMemo, useState } from 'react';
import { Mail, MessageSquare, BellRing } from 'lucide-react';
import { followUps, mailLink, smsLink, type FuInvoice, type FuJob, type FuQuote, type FuTech } from '@/lib/follow-ups';
import { todayISO } from '@/lib/utils';

const SHOW = 4;
const DONE_KEY = 'faj.followups.sent';

export default function FollowUps({ invoices, invoicePayments, quotes, jobs, techs }: {
  invoices: FuInvoice[]; invoicePayments: { invoice_id: string; amount: number }[];
  quotes: FuQuote[]; jobs: FuJob[]; techs: FuTech[];
}) {
  const [all, setAll] = useState(false);
  // Tapped today: hide it until tomorrow so the list shrinks as you go.
  const [done, setDone] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch { return {}; }
  });
  const today = todayISO();
  const items = useMemo(() => {
    const paid = new Map<string, number>();
    for (const p of invoicePayments) paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + Number(p.amount || 0));
    const base = typeof window === 'undefined' ? '' : window.location.origin;
    return followUps({ invoices, paidByInvoice: paid, quotes, jobs, techs, today, base }).filter((f) => done[f.key] !== today);
  }, [invoices, invoicePayments, quotes, jobs, techs, today, done]);
  if (items.length === 0) return null;

  const sent = (key: string) => {
    const next = { ...Object.fromEntries(Object.entries(done).filter(([, d]) => d === today)), [key]: today };
    setDone(next);
    try { localStorage.setItem(DONE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const shown = all ? items : items.slice(0, SHOW);
  return (
    <div style={{ marginTop: 14 }}>
      <h2 className="serif" style={{ fontSize: 21, fontWeight: 600, margin: '0 0 10px' }}>
        Follow up <span style={{ fontSize: 13, fontWeight: 400, color: '#8a8578' }}>({items.length}) · written for you, you press send</span>
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 9 }}>
        {shown.map((f) => {
          const sms = smsLink(f);
          const mail = mailLink(f);
          return (
            <div key={f.key} style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', borderRadius: 13, background: 'white',
              border: '1px solid rgba(14,27,46,0.25)', boxShadow: '0 1px 6px rgba(0,0,0,0.03)',
            }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(14,27,46,0.10)' }}>
                <BellRing size={16} color="var(--teal)" />
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{f.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: '#8a8578', marginTop: 2 }}>
                  {sms || mail ? f.detail : `${f.detail} · no phone or email on file`}
                </span>
              </span>
              {sms && <a href={sms} onClick={() => sent(f.key)} className="wf-btn wf-btn-outline wf-btn-sm" title={f.body}><MessageSquare size={13} /> Text</a>}
              {mail && <a href={mail} onClick={() => sent(f.key)} className="wf-btn wf-btn-outline wf-btn-sm" title={f.body}><Mail size={13} /> Email</a>}
            </div>
          );
        })}
      </div>
      {items.length > SHOW && (
        <button onClick={() => setAll(!all)} className="wf-btn wf-btn-sm" style={{ marginTop: 8, background: 'none', color: 'var(--teal)' }}>
          {all ? 'Show less' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
