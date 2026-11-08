// Auto follow-up (Fred, 2026-11-08): the reminders FAJ would send, already written, waiting for one tap.
// Nothing goes out on its own: each opens Fred's own text or email app with the message filled in, and he
// presses send. Pure; components/FollowUps.tsx shows them on Home.
import { fmtMoney } from './utils';

export type FollowUp = {
  key: string;
  kind: 'invoice' | 'quote' | 'tech';
  who: string;
  title: string;
  detail: string;
  phone: string | null;
  email: string | null;
  subject: string;
  body: string;
};

type Client = { client_name: string | null; client_email: string | null; client_phone: string | null; share_token: string | null; total: number };
export type FuInvoice = Client & { id: string; invoice_number: string; status: string; due_date: string | null };
export type FuQuote = Client & { id: string; quote_number: string; status: string; created_at: string; sent_at: string | null };
export type FuJob = {
  id: string; wo_number: string; title?: string | null; contractor_name: string; wo_status: string;
  archived_at?: string | null; assignment_responses?: Record<string, unknown> | null;
};
export type FuTech = { name: string; phone: string | null; email: string | null; portal_token: string | null };

const QUOTE_QUIET_DAYS = 7;
const SIGN = 'Thank you,\nFAJ Solutions';
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from.slice(0, 10))) / 86_400_000);
const first = (name: string | null) => (name ?? '').trim().split(/\s+/)[0] || 'there';
const clean = (s: string | null | undefined) => (s ?? '').trim() || null;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function followUps(input: {
  invoices: FuInvoice[];
  paidByInvoice: Map<string, number>;
  quotes: FuQuote[];
  jobs: FuJob[];
  techs: FuTech[];
  today: string;
  base: string;
}): FollowUp[] {
  const { today, base } = input;
  const out: FollowUp[] = [];

  for (const inv of input.invoices) {
    if (inv.status !== 'sent' || !inv.due_date || inv.due_date >= today) continue;
    const owed = Number(inv.total || 0) - (input.paidByInvoice.get(inv.id) ?? 0);
    if (owed <= 0.005) continue;
    const late = days(inv.due_date, today);
    const link = inv.share_token ? `\nView and pay it here: ${base}/invoice/${inv.share_token}` : '';
    out.push({
      key: `inv-${inv.id}`, kind: 'invoice', who: inv.client_name || 'Client',
      title: `Invoice ${inv.invoice_number}: ${fmtMoney(owed)} overdue`,
      detail: `${inv.client_name || 'Client'} · ${late} ${late === 1 ? 'day' : 'days'} late`,
      phone: clean(inv.client_phone), email: clean(inv.client_email),
      subject: `Reminder: invoice ${inv.invoice_number} is past due`,
      body: `Hi ${first(inv.client_name)}, a friendly reminder that invoice ${inv.invoice_number} for ${fmtMoney(owed)} was due ${shortDate(inv.due_date)}.${link}\n${SIGN}`,
    });
  }

  for (const q of input.quotes) {
    if (q.status !== 'sent') continue;
    const quiet = days(q.sent_at || q.created_at, today);
    if (quiet < QUOTE_QUIET_DAYS) continue;
    const link = q.share_token ? `\nYou can review and accept it here: ${base}/quote/${q.share_token}` : '';
    out.push({
      key: `quote-${q.id}`, kind: 'quote', who: q.client_name || 'Client',
      title: `Quote ${q.quote_number}: ${fmtMoney(Number(q.total || 0))} with no answer`,
      detail: `${q.client_name || 'Client'} · sent ${quiet} days ago`,
      phone: clean(q.client_phone), email: clean(q.client_email),
      subject: `Following up on quote ${q.quote_number}`,
      body: `Hi ${first(q.client_name)}, just following up on quote ${q.quote_number} for ${fmtMoney(Number(q.total || 0))}.${link}\nAny questions, just reply. ${SIGN}`,
    });
  }

  const techs = new Map(input.techs.map((t) => [t.name.trim().toLowerCase(), t]));
  for (const j of input.jobs) {
    const name = (j.contractor_name ?? '').trim();
    if (!name || j.archived_at || j.wo_status === 'Approved' || j.wo_status === 'Paid') continue;
    if ((j.assignment_responses ?? {})[name]) continue;
    const t = techs.get(name.toLowerCase());
    // Never the pay: the tech sees their own amount in the app.
    const link = t?.portal_token ? `\nAccept or decline here: ${base}/portal/${t.portal_token}` : '';
    out.push({
      key: `tech-${j.id}`, kind: 'tech', who: name,
      title: `${name} hasn't answered WO ${j.wo_number}`,
      detail: j.title || 'Sent, not accepted or declined',
      phone: clean(t?.phone), email: clean(t?.email),
      subject: `Can you take WO ${j.wo_number}?`,
      body: `Hi ${first(name)}, can you accept or decline WO ${j.wo_number}${j.title ? ` (${j.title})` : ''}?${link}\nThanks, FAJ Solutions`,
    });
  }
  return out;
}

/** Opens the phone's text app with the message written. `?&body=` works on both iPhone and Android. */
export const smsLink = (f: FollowUp) => (f.phone ? `sms:${f.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(f.body)}` : null);
export const mailLink = (f: FollowUp) =>
  (f.email ? `mailto:${f.email}?subject=${encodeURIComponent(f.subject)}&body=${encodeURIComponent(f.body)}` : null);
