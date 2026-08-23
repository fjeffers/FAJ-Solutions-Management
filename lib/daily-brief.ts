// Weekday morning brief — the short "what needs you today" email, across BOTH of
// Fred's businesses. Sibling of weekly-digest.ts, which is the fuller Monday
// retrospective; this one is deliberately narrower and answers one question:
// what is costing money by sitting still?
//
// Three things earn a spot here, in order:
//   1. Invoices never sent      — money not even asked for; Fred's own bottleneck
//   2. FHJ leads with no reply  — commission lost to silence
//   3. Invoices past due        — a client being slow
//
// The travel section is omitted entirely when FHJ isn't configured (see lib/fhj.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SiteVisit, Invoice, InvoicePayment } from './types';
import { visitAmount } from './visits';
import { fetchFhjSnapshot, fhjConfigured } from './fhj';
import { todayISO } from './utils';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export type DailyBrief = {
  subject: string;
  html: string;
  stats: Record<string, number>;
  /** True when there is genuinely nothing to act on — caller may skip the send. */
  quiet: boolean;
};

export async function buildDailyBrief(admin: SupabaseClient): Promise<DailyBrief> {
  const [vRes, iRes, pRes, fhj] = await Promise.all([
    admin.from('site_visits').select('*'),
    admin.from('invoices').select('*'),
    admin.from('invoice_payments').select('*'),
    fetchFhjSnapshot(),
  ]);
  const visits = (vRes.data ?? []) as SiteVisit[];
  const invoices = (iRes.data ?? []) as Invoice[];
  const payments = (pRes.data ?? []) as InvoicePayment[];

  const today = todayISO();

  // ── 1. Never sent. status 'draft' means Fred built it and stopped. ──
  const drafts = invoices
    .filter((i) => i.status === 'draft')
    .map((i) => ({ inv: i, amount: Number(i.total ?? 0) }))
    .sort((a, b) => b.amount - a.amount);
  const draftTotal = drafts.reduce((s, d) => s + d.amount, 0);

  // ── 2. Sent, still owed. Drafts excluded here — they're their own bucket. ──
  const paidByInvoice = new Map<string, number>();
  for (const p of payments) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount));
  }
  const open = invoices
    .filter((i) => i.status !== 'void' && i.status !== 'draft')
    .map((i) => ({ inv: i, balance: Number(i.total) - (paidByInvoice.get(i.id) ?? 0) }))
    .filter((x) => x.balance > 0.005)
    .sort((a, b) => b.balance - a.balance);
  const outstanding = open.reduce((s, x) => s + x.balance, 0);
  const overdue = open
    .filter((x) => x.inv.due_date && x.inv.due_date < today)
    .map((x) => ({
      ...x,
      daysLate: Math.floor(
        (Date.parse(today) - Date.parse(x.inv.due_date as string)) / 86400000,
      ),
    }))
    .sort((a, b) => b.daysLate - a.daysLate);
  const overdueTotal = overdue.reduce((s, x) => s + x.balance, 0);

  // ── 3. Work finished, never billed. 'na' means deliberately not billable. ──
  const needs = visits.filter((v) => v.invoice_status === 'not_invoiced');
  const needsTotal = needs.reduce((s, v) => s + visitAmount(v), 0);

  // ── Forgotten checkouts. >18h is a missed checkout, not someone still on site. ──
  const stuck = visits.filter((v) => {
    if (!v.time_in || v.time_out) return false;
    return Date.now() - Date.parse(v.time_in) > 18 * 3600 * 1000;
  });

  const app = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com';
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const agingLeads = fhj?.leads.filter((l) => l.daysWaiting >= 2) ?? [];
  const quiet =
    drafts.length === 0 &&
    overdue.length === 0 &&
    needs.length === 0 &&
    stuck.length === 0 &&
    (fhj?.leads.length ?? 0) === 0 &&
    (fhj?.unreadMessages ?? 0) === 0;

  const card = (accent: string, label: string, body: string, cta?: string) => `
    <div style="background:#fff;border-radius:12px;border:1px solid #eee;border-left:4px solid ${accent};margin:10px 0;padding:16px 18px;">
      <div style="font-size:12px;font-weight:800;letter-spacing:1px;color:${accent};text-transform:uppercase;">${label}</div>
      ${body}
      ${cta ?? ''}
    </div>`;

  const btn = (href: string, text: string) => `
    <a href="${href}" style="display:inline-block;margin-top:10px;background:#0D7377;color:#fff;text-decoration:none;font-weight:700;font-size:13px;border-radius:8px;padding:9px 16px;">${text}</a>`;

  const row = (text: string) =>
    `<div style="font-size:13px;padding:7px 0;border-bottom:1px solid #f5f2ea;">${text}</div>`;

  const sections: string[] = [];

  if (drafts.length > 0) {
    sections.push(
      card(
        '#b91c1c',
        `Never sent — ${money(draftTotal)}`,
        `<div style="font-size:13px;color:#555;margin:6px 0 2px;">You built ${
          drafts.length === 1 ? 'this invoice' : 'these invoices'
        } but ${drafts.length === 1 ? 'it was' : 'they were'} never sent. This is the fastest money in the business.</div>` +
          drafts
            .slice(0, 6)
            .map(({ inv, amount }) =>
              row(
                `<b>${inv.invoice_number}</b> · ${inv.client_name ?? 'Client'} · <b style="color:#b91c1c;">${money(amount)}</b>`,
              ),
            )
            .join(''),
        btn(`${app}/?view=invoices`, 'Open Invoices → Send'),
      ),
    );
  }

  if (agingLeads.length > 0) {
    sections.push(
      card(
        '#7c3aed',
        `${agingLeads.length} travel lead${agingLeads.length !== 1 ? 's' : ''} waiting on you`,
        `<div style="font-size:13px;color:#555;margin:6px 0 2px;">FHJ earns commission on booked trips — an unanswered lead is the whole loss.</div>` +
          agingLeads
            .slice(0, 6)
            .map((l) =>
              row(
                `<b>${l.name}</b>${l.destination ? ` · ${l.destination}` : ''}${
                  l.budget ? ` · ${l.budget}` : ''
                } · <b style="color:#7c3aed;">${l.daysWaiting} day${l.daysWaiting !== 1 ? 's' : ''} waiting</b>` +
                  (l.occasion
                    ? `<div style="font-size:11px;color:#888;">${l.occasion}</div>`
                    : ''),
              ),
            )
            .join(''),
        btn('https://www.fhjdreamdestinations.com/admin', 'Open FHJ Admin'),
      ),
    );
  }

  if (overdue.length > 0) {
    sections.push(
      card(
        '#b45309',
        `Overdue — ${money(overdueTotal)}`,
        overdue
          .slice(0, 6)
          .map(({ inv, balance, daysLate }) =>
            row(
              `<b>${inv.invoice_number}</b> · ${inv.client_name ?? 'Client'} · <b>${money(balance)}</b> · <span style="color:#b91c1c;font-weight:800;">${daysLate} day${daysLate !== 1 ? 's' : ''} late</span>`,
            ),
          )
          .join(''),
        btn(`${app}/?view=invoices`, 'Open Invoices'),
      ),
    );
  }

  if (needs.length > 0) {
    sections.push(
      card(
        '#0D7377',
        `Ready to bill — ${money(needsTotal)}`,
        `<div style="font-size:13px;color:#555;margin:6px 0;">${needs.length} visit${
          needs.length !== 1 ? 's' : ''
        } finished and not yet invoiced.</div>`,
        btn(`${app}/?view=sitelog`, 'Open Site Log → Invoice Visits'),
      ),
    );
  }

  if (stuck.length > 0) {
    sections.push(
      card(
        '#6b7280',
        `${stuck.length} forgotten checkout${stuck.length !== 1 ? 's' : ''}`,
        stuck
          .slice(0, 5)
          .map((v) => row(`${v.program ?? 'Visit'}${v.site_code ? ` #${v.site_code}` : ''} — still checked in`))
          .join(''),
        btn(`${app}/?view=sitelog`, 'Open Site Log'),
      ),
    );
  }

  if (fhj && fhj.unreadMessages > 0) {
    sections.push(
      card(
        '#7c3aed',
        `${fhj.unreadMessages} unread concierge message${fhj.unreadMessages !== 1 ? 's' : ''}`,
        `<div style="font-size:13px;color:#555;margin:6px 0;">Existing FHJ clients are waiting in the portal chat.</div>`,
      ),
    );
  }

  if (fhj && fhj.appointments.length > 0) {
    sections.push(
      card(
        '#7c3aed',
        `${fhj.appointments.length} consultation request${fhj.appointments.length !== 1 ? 's' : ''}`,
        fhj.appointments
          .slice(0, 5)
          .map((a) =>
            row(`<b>${a.name}</b>${a.type ? ` · ${a.type}` : ''}${a.date ? ` · ${a.date}` : ''}`),
          )
          .join(''),
      ),
    );
  }

  if (quiet) {
    sections.push(
      card(
        '#047857',
        'All clear',
        `<div style="font-size:13px;color:#555;margin:6px 0;">Nothing sitting still this morning. ${money(
          outstanding,
        )} is out with clients and not yet due.</div>`,
      ),
    );
  }

  const fhjNote = fhjConfigured()
    ? ''
    : `<div style="font-size:11px;color:#b45309;background:#fffbeb;border-radius:8px;padding:10px 12px;margin:10px 0;">
         FHJ Dream Destinations isn't connected yet, so travel leads aren't included.
         Add <b>FHJ_SUPABASE_URL</b> and <b>FHJ_SUPABASE_SERVICE_ROLE_KEY</b> in Vercel to switch it on.
       </div>`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f1ea;padding:24px 12px;">
    <div style="max-width:640px;margin:0 auto;">
      <div style="padding:4px 6px 14px;">
        <span style="font-size:18px;font-weight:800;color:#0D7377;letter-spacing:3px;">FAJ SOLUTIONS</span><br>
        <span style="font-size:11px;color:#8a6d2f;font-weight:700;letter-spacing:2px;">MORNING BRIEF · ${dateLabel.toUpperCase()}</span>
      </div>

      <div style="background:linear-gradient(135deg,#0D7377,#0a5a5d);border-radius:16px 16px 0 0;color:#fff;padding:20px 24px;">
        <div style="font-size:22px;font-weight:700;">Good morning, Fred ☕</div>
        <div style="font-size:13px;opacity:.85;margin-top:4px;">${
          quiet ? 'Nothing needs you this morning.' : 'Here’s what needs you today.'
        }</div>
      </div>
      <div style="background:#faf9f6;border-radius:0 0 16px 16px;padding:14px 18px;border:1px solid #eee;border-top:none;">
        ${sections.join('')}
        ${fhjNote}
        <div style="text-align:center;font-size:11px;color:#aaa;padding:12px 0 4px;">
          Sent weekday mornings by your business manager · <a href="${app}" style="color:#0D7377;">app.fajsolutions.com</a>
        </div>
      </div>
    </div>
  </div>`;

  // Subject leads with the most urgent number so it reads on a phone lock screen.
  let subject: string;
  if (draftTotal > 0) subject = `☕ ${money(draftTotal)} never sent — morning brief`;
  else if (agingLeads.length > 0)
    subject = `☕ ${agingLeads.length} travel lead${agingLeads.length !== 1 ? 's' : ''} waiting — morning brief`;
  else if (overdueTotal > 0) subject = `☕ ${money(overdueTotal)} overdue — morning brief`;
  else if (needsTotal > 0) subject = `☕ ${money(needsTotal)} ready to bill — morning brief`;
  else subject = '☕ Morning brief — all clear';

  return {
    subject,
    html,
    quiet,
    stats: {
      draftCount: drafts.length,
      draftTotal: Math.round(draftTotal),
      overdueCount: overdue.length,
      overdueTotal: Math.round(overdueTotal),
      outstanding: Math.round(outstanding),
      needsInvoiceCount: needs.length,
      needsInvoiceTotal: Math.round(needsTotal),
      stuckCheckouts: stuck.length,
      fhjLeads: fhj?.leads.length ?? 0,
      fhjAgingLeads: agingLeads.length,
      fhjUnread: fhj?.unreadMessages ?? 0,
    },
  };
}
