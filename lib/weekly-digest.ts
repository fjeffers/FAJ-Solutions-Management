// Monday money email — the week's field work and the state of the money.
// Composed server-side by the weekly-digest cron from site_visits + invoices.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SiteVisit, Invoice, InvoicePayment } from './types';
import { visitAmount } from './visits';
import { todayISO, addDaysISO } from './utils';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export type WeeklyDigest = {
  subject: string;
  html: string;
  stats: Record<string, number>;
};

export async function buildWeeklyDigest(admin: SupabaseClient): Promise<WeeklyDigest> {
  const [vRes, iRes, pRes] = await Promise.all([
    admin.from('site_visits').select('*'),
    admin.from('invoices').select('*'),
    admin.from('invoice_payments').select('*'),
  ]);
  // Archived visits are merged or duplicate log entries, never work still to bill
  // (same rule as the daily brief and the dashboard's "Needs you").
  const visits = ((vRes.data ?? []) as SiteVisit[]).filter((v) => !v.archived_at);
  const invoices = (iRes.data ?? []) as Invoice[];
  const payments = (pRes.data ?? []) as InvoicePayment[];

  const today = todayISO();
  const weekAgo = addDaysISO(todayISO(), -7);

  // ── This week's field work ──
  const week = visits.filter((v) => v.visit_date && v.visit_date >= weekAgo);
  const weekHours = week.reduce((s, v) => s + Number(v.hours ?? 0), 0);
  const weekMiles = week.reduce((s, v) => s + Number(v.miles ?? 0), 0);
  const weekEarned = week.reduce((s, v) => s + visitAmount(v), 0);

  // ── Needs invoicing (all-time backlog), by customer ──
  const needs = visits.filter((v) => v.invoice_status === 'not_invoiced');
  const needsTotal = needs.reduce((s, v) => s + visitAmount(v), 0);
  const byProgram = new Map<string, { count: number; total: number }>();
  for (const v of needs) {
    const k = v.program || 'Other';
    const cur = byProgram.get(k) ?? { count: 0, total: 0 };
    cur.count++; cur.total += visitAmount(v);
    byProgram.set(k, cur);
  }
  const programRows = [...byProgram.entries()].sort((a, b) => b[1].total - a[1].total);

  // ── Invoices outstanding ──
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
  const overdue = open.filter((x) => x.inv.due_date && x.inv.due_date < today);
  const drafts = invoices.filter((i) => i.status === 'draft').length;

  const app = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fajsolutions.com';
  const weekLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const tile = (label: string, value: string, color: string) => `
    <td style="padding:6px;">
      <div style="background:#ffffff;border-radius:12px;padding:14px 16px;border:1px solid #eee;">
        <div style="font-size:10px;font-weight:800;letter-spacing:1px;color:#999;text-transform:uppercase;">${label}</div>
        <div style="font-size:22px;font-weight:800;color:${color};">${value}</div>
      </div>
    </td>`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f1ea;padding:24px 12px;">
    <div style="max-width:640px;margin:0 auto;">
      <div style="padding:4px 6px 14px;">
        <span style="font-size:18px;font-weight:800;color:#0D7377;letter-spacing:3px;">FAJ SOLUTIONS</span><br>
        <span style="font-size:11px;color:#8a6d2f;font-weight:700;letter-spacing:2px;">MONDAY MONEY BRIEF · ${weekLabel.toUpperCase()}</span>
      </div>

      <div style="background:linear-gradient(135deg,#0D7377,#0a5a5d);border-radius:16px 16px 0 0;color:#fff;padding:20px 24px;">
        <div style="font-size:22px;font-weight:700;">Good morning, Fred ☕</div>
        <div style="font-size:13px;opacity:.85;margin-top:4px;">Here's your week and where the money stands.</div>
      </div>
      <div style="background:#faf9f6;border-radius:0 0 16px 16px;padding:14px;border:1px solid #eee;border-top:none;">

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
          ${tile('Visits this week', String(week.length), '#0D7377')}
          ${tile('Hours', weekHours.toFixed(1), '#0D7377')}
        </tr><tr>
          ${tile('Miles driven', weekMiles.toFixed(0), '#2563eb')}
          ${tile('Earned this week', money(weekEarned), '#047857')}
        </tr></table>

        <div style="background:#fff;border-radius:12px;border:1px solid #eee;margin:10px 6px;padding:16px 18px;">
          <div style="font-size:12px;font-weight:800;letter-spacing:1px;color:#b91c1c;text-transform:uppercase;">Needs invoicing — ${money(needsTotal)}</div>
          ${programRows.length === 0
            ? '<div style="font-size:13px;color:#999;padding:8px 0;">Nothing waiting. 🎉</div>'
            : programRows.map(([prog, g]) => `
              <div style="display:block;font-size:13px;padding:7px 0;border-bottom:1px solid #f5f2ea;">
                <b>${prog}</b> — ${g.count} visit${g.count !== 1 ? 's' : ''} ·
                <b style="color:#b91c1c;">${money(g.total)}</b>
              </div>`).join('')}
          <a href="${app}/admin?view=sitelog" style="display:inline-block;margin-top:10px;background:#0D7377;color:#fff;text-decoration:none;font-weight:700;font-size:13px;border-radius:8px;padding:9px 16px;">Open Site Log → Invoice Visits</a>
        </div>

        <div style="background:#fff;border-radius:12px;border:1px solid #eee;margin:10px 6px;padding:16px 18px;">
          <div style="font-size:12px;font-weight:800;letter-spacing:1px;color:#b45309;text-transform:uppercase;">Invoiced · awaiting payment — ${money(outstanding)}</div>
          ${open.length === 0
            ? '<div style="font-size:13px;color:#999;padding:8px 0;">No open invoices.</div>'
            : open.slice(0, 8).map(({ inv, balance }) => `
              <div style="font-size:13px;padding:7px 0;border-bottom:1px solid #f5f2ea;">
                <b>${inv.invoice_number}</b> · ${inv.client_name ?? 'Client'} ·
                <b>${money(balance)}</b>
                ${inv.due_date && inv.due_date < today ? '<span style="color:#b91c1c;font-weight:800;"> · OVERDUE</span>' : ''}
              </div>`).join('')}
          ${drafts > 0 ? `<div style="font-size:12px;color:#8a6d2f;margin-top:8px;">✍️ ${drafts} draft invoice${drafts !== 1 ? 's' : ''} still need${drafts === 1 ? 's' : ''} to be sent.</div>` : ''}
          <a href="${app}/admin?view=invoices" style="display:inline-block;margin-top:10px;background:#fff;color:#0D7377;border:1px solid #0D7377;text-decoration:none;font-weight:700;font-size:13px;border-radius:8px;padding:9px 16px;">Open Invoices</a>
        </div>

        <div style="text-align:center;font-size:11px;color:#aaa;padding:12px 0 4px;">
          Sent every Monday by your FAJ Business Manager · <a href="${app}" style="color:#0D7377;">app.fajsolutions.com</a>
        </div>
      </div>
    </div>
  </div>`;

  const subject = `☕ Monday Brief — ${money(needsTotal)} to invoice, ${money(outstanding)} awaiting payment`;
  return {
    subject,
    html,
    stats: {
      weekVisits: week.length, weekHours, weekMiles,
      needsInvoiceTotal: Math.round(needsTotal * 100) / 100,
      outstanding: Math.round(outstanding * 100) / 100,
      overdueCount: overdue.length,
    },
  };
}
