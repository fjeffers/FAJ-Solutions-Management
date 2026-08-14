// ─── FAJ Email Templates ──────────────────────────────────────────────────────
// Pure functions — no browser APIs, safe to call from API routes.

import type { WorkOrder, Payment, Contractor } from './types';
import { fmtMoney, fmtDate } from './utils';

const TEAL = '#0D7377';
const GOLD  = '#C9A961';

// ─── Base wrapper ─────────────────────────────────────────────────────────────

function base(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f7f8fa;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#f7f8fa;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="max-width:600px;width:100%;">

        <!-- ── Header ── -->
        <tr>
          <td style="background:linear-gradient(135deg,#0D7377 0%,#0a5a5d 100%);
                     padding:28px 32px;border-radius:12px 12px 0 0;">
            <div style="color:${GOLD};font-size:10px;font-weight:700;
                        letter-spacing:3px;margin-bottom:6px;">FAJ SOLUTIONS</div>
            <div style="color:white;font-size:22px;font-weight:600;
                        line-height:1.3;">${title}</div>
          </td>
        </tr>

        <!-- ── Body ── -->
        <tr>
          <td style="background:white;padding:32px;
                     border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;">
            ${body}
            <hr style="border:none;border-top:1px solid #eee;margin:28px 0;" />
            <div style="font-size:11px;color:#bbb;text-align:center;line-height:1.6;">
              FAJ Solutions · Easton, PA<br />
              Sent via FAJ Business Manager
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function infoRow(label: string, value: string, bold = false): string {
  return `
  <tr>
    <td style="padding:8px 0;font-size:12px;color:#888;width:38%;vertical-align:top;
               border-bottom:1px solid #f5f5f5;">${label}</td>
    <td style="padding:8px 0;font-size:13px;color:${bold ? TEAL : '#333'};
               font-weight:${bold ? '700' : '500'};vertical-align:top;
               border-bottom:1px solid #f5f5f5;">${value}</td>
  </tr>`;
}

function section(heading: string, content: string): string {
  return `
  <div style="margin-bottom:24px;">
    <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#aaa;
                text-transform:uppercase;margin-bottom:10px;">${heading}</div>
    ${content}
  </div>`;
}

// ─── Work Order ───────────────────────────────────────────────────────────────

// Per-recipient extras for the assignment email. When present, the email shows
// the TECH's pay (never the client price) and one-click Accept / Decline links.
export type WorkOrderEmailOpts = {
  techPay?: number | null;
  portalUrl?: string | null;
  acceptUrl?: string | null;
  declineUrl?: string | null;
};

export function workOrderEmail(wo: WorkOrder, note?: string, opts: WorkOrderEmailOpts = {}): string {
  const site = [wo.site_name, wo.site_address, wo.site_city, wo.site_state, wo.site_zip]
    .filter(Boolean).join(', ');
  const schedule = [
    wo.start_date ? fmtDate(wo.start_date) : null,
    wo.start_time ?? null,
    wo.end_date ? `– ${fmtDate(wo.end_date)}` : null,
    wo.end_time ? `(end ${wo.end_time})` : null,
  ].filter(Boolean).join(' ');

  const deliverableLines = wo.deliverables
    ? wo.deliverables
        .split('\n')
        .filter(Boolean)
        .map((d) => `<li style="margin:4px 0;font-size:13px;color:#444;">${d}</li>`)
        .join('')
    : '';

  const noteBlock = note
    ? `<div style="background:rgba(13,115,119,0.07);border-left:3px solid ${TEAL};
                   padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:28px;
                   font-size:14px;color:#333;line-height:1.6;">${note}</div>`
    : '';

  // On-site reference: the number the tech gives the client's help desk
  // (e.g. the FieldNation or NetView work order ID), plus where it came from.
  const refId = wo.external_wo_id || wo.client_reference || null;
  const refLabel = refId
    ? `${wo.source_platform && wo.source_platform !== 'Internal' ? `${wo.source_platform} ` : ''}#${refId}`
    : null;

  // Accept / Decline / portal buttons — only when per-recipient links exist
  const respondBlock = (opts.acceptUrl && opts.declineUrl) ? `
    <div style="text-align:center;margin:28px 0;">
      <div style="font-size:13px;color:#555;margin-bottom:14px;font-weight:600;">Can you take this job?</div>
      <a href="${opts.acceptUrl}" style="display:inline-block;background:#047857;color:#fff;padding:14px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:0 6px 8px;">✓ Accept Job</a>
      <a href="${opts.declineUrl}" style="display:inline-block;background:#fff;color:#b91c1c;border:2px solid #b91c1c;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:0 6px 8px;">✗ Decline</a>
      ${opts.portalUrl ? `<div style="margin-top:10px;"><a href="${opts.portalUrl}" style="color:${TEAL};font-size:13px;font-weight:600;">Open my portal for full details ↗</a></div>` : ''}
    </div>` : (opts.portalUrl ? `
    <div style="text-align:center;margin:28px 0;">
      <a href="${opts.portalUrl}" style="display:inline-block;background:${TEAL};color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Open My Portal</a>
    </div>` : '');

  const body = `
    ${noteBlock}

    <div style="font-size:18px;font-weight:700;color:#111;margin-bottom:20px;">
      WO #${wo.wo_number}${wo.title ? ` — ${wo.title}` : ''}
    </div>

    ${respondBlock}

    ${section('Work Order Details', `
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Contractor', wo.contractor_name, true)}
        ${infoRow('Status', wo.wo_status)}
        ${refLabel ? infoRow('On-Site Reference', refLabel, true) : ''}
        ${wo.service_type ? infoRow('Service Type', wo.service_type) : ''}
        ${schedule ? infoRow('Schedule', schedule) : ''}
        ${site ? infoRow('Site', site) : ''}
        ${opts.techPay != null && opts.techPay > 0 ? infoRow('Your Pay', fmtMoney(opts.techPay), true) : ''}
      </table>
    `)}

    ${wo.description ? section('Description', `
      <div style="font-size:13px;color:#444;line-height:1.7;">${wo.description}</div>
    `) : ''}

    ${deliverableLines ? section('Deliverables', `
      <ul style="margin:0;padding:0 0 0 18px;">${deliverableLines}</ul>
    `) : ''}

    ${(wo.poc_name || wo.poc_phone || wo.poc_email) ? section('Point of Contact', `
      <div style="background:#f9f9f9;border-radius:8px;padding:16px;">
        ${wo.poc_name  ? `<div style="font-size:13px;font-weight:600;color:#333;margin-bottom:4px;">${wo.poc_name}</div>` : ''}
        ${wo.poc_phone ? `<div style="font-size:13px;color:#555;margin-bottom:2px;">${wo.poc_phone}</div>` : ''}
        ${wo.poc_email ? `<div style="font-size:13px;color:${TEAL};">${wo.poc_email}</div>` : ''}
      </div>
    `) : ''}

    ${wo.required_skills ? section('Required Skills', `
      <div style="font-size:13px;color:#555;">${wo.required_skills}</div>
    `) : ''}
  `;

  return base(`Work Order #${wo.wo_number}`, body);
}

// ─── Payment Confirmation ─────────────────────────────────────────────────────

export function paymentConfirmationEmail(payment: Payment, wo?: WorkOrder): string {
  const body = `
    <div style="text-align:center;padding:28px 0 24px;border-bottom:1px solid #eee;margin-bottom:28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:3px;color:#aaa;margin-bottom:10px;">
        PAYMENT CONFIRMED
      </div>
      <div style="font-size:44px;font-weight:700;color:#047857;line-height:1;">
        ${fmtMoney(Number(payment.amount))}
      </div>
      <div style="font-size:14px;color:#888;margin-top:8px;">
        ${payment.method} · ${fmtDate(payment.payment_date)}
      </div>
    </div>

    ${section('Payment Details', `
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Contractor', payment.contractor_name, true)}
        ${infoRow('Work Order', `#${payment.wo_number}`)}
        ${infoRow('Date', fmtDate(payment.payment_date))}
        ${infoRow('Method', payment.method)}
        ${infoRow('Amount', fmtMoney(Number(payment.amount)), true)}
        ${payment.notes ? infoRow('Notes', payment.notes) : ''}
      </table>
    `)}

    ${wo ? section('Work Order Info', `
      <div style="background:#f9f9f9;border-radius:8px;padding:16px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${wo.title        ? infoRow('Title',         wo.title)                       : ''}
          ${wo.service_type ? infoRow('Service',       wo.service_type)                : ''}
          ${infoRow('WO Total',  fmtMoney(Number(wo.total_amount)))}
        </table>
      </div>
    `) : ''}
  `;

  return base('Payment Confirmation', body);
}

// ─── W-9 Request ──────────────────────────────────────────────────────────────

export function w9RequestEmail(contractor: Contractor, note?: string): string {
  const addrLine = [contractor.address, contractor.city, contractor.state, contractor.zip]
    .filter(Boolean).join(', ');

  const noteBlock = note
    ? `<div style="background:rgba(13,115,119,0.07);border-left:3px solid ${TEAL};
                   padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:24px;
                   font-size:14px;color:#333;line-height:1.6;">${note}</div>`
    : '';

  const body = `
    ${noteBlock}

    <div style="font-size:15px;color:#333;line-height:1.8;margin-bottom:28px;">
      Hi <strong>${contractor.name}</strong>,<br /><br />
      We need a completed <strong>W-9 form</strong> on file before we can process
      1099-NEC filings for this tax year. Please fill out and return your W-9
      at your earliest convenience.
    </div>

    ${section('Your Info on File', `
      <div style="background:rgba(13,115,119,0.06);border-radius:10px;padding:20px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${infoRow('Name', contractor.name)}
          ${contractor.business_name ? infoRow('Business', contractor.business_name) : ''}
          ${contractor.entity_type   ? infoRow('Entity Type', contractor.entity_type) : ''}
          ${addrLine                 ? infoRow('Address', addrLine) : ''}
        </table>
      </div>
    `)}

    ${section('What to Include on Your W-9', `
      <ul style="margin:0;padding:0 0 0 18px;line-height:1.9;font-size:13px;color:#555;">
        <li>Legal name (Line 1) and business name if different (Line 2)</li>
        <li>Tax classification (individual, LLC, corporation, etc.)</li>
        <li>Taxpayer ID — SSN or EIN</li>
        <li>Current mailing address</li>
        <li>Signature and date</li>
      </ul>
    `)}
  `;

  return base('W-9 Request', body);
}

// ─── Accountant Summary ───────────────────────────────────────────────────────

export function accountantSummaryEmail(
  payments: Payment[],
  workOrders: WorkOrder[],
  year: number,
): string {
  const yearPayments = payments.filter((p) => p.payment_date?.startsWith(String(year)));
  const total = yearPayments.reduce((s, p) => s + Number(p.amount), 0);

  const byContractor: Record<string, { count: number; total: number }> = {};
  for (const p of yearPayments) {
    if (!byContractor[p.contractor_name]) {
      byContractor[p.contractor_name] = { count: 0, total: 0 };
    }
    byContractor[p.contractor_name].count++;
    byContractor[p.contractor_name].total += Number(p.amount);
  }

  const needs1099 = Object.values(byContractor).filter((c) => c.total >= 600).length;

  const contractorRows = Object.entries(byContractor)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, data]) => {
      const flag = data.total >= 600;
      return `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#333;">${name}</td>
        <td style="padding:10px 14px;font-size:13px;color:#777;text-align:center;">${data.count}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:700;text-align:right;
                   color:${flag ? '#047857' : '#555'};">
          ${fmtMoney(data.total)}${flag ? ' ✓' : ''}
        </td>
      </tr>`;
    }).join('');

  const body = `
    <div style="font-size:14px;color:#555;line-height:1.7;margin-bottom:28px;">
      Please find the contractor payment summary for tax year <strong>${year}</strong>.
      Contractors marked <strong style="color:#047857;">✓</strong> have received
      <strong>$600 or more</strong> and require a 1099-NEC filing.
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="padding-right:8px;">
          <div style="background:rgba(13,115,119,0.07);border-radius:10px;padding:18px;text-align:center;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#aaa;margin-bottom:6px;">TOTAL PAID</div>
            <div style="font-size:26px;font-weight:700;color:${TEAL};">${fmtMoney(total)}</div>
          </div>
        </td>
        <td style="padding-left:4px;padding-right:4px;">
          <div style="background:rgba(13,115,119,0.07);border-radius:10px;padding:18px;text-align:center;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#aaa;margin-bottom:6px;">PAYMENTS</div>
            <div style="font-size:26px;font-weight:700;color:${TEAL};">${yearPayments.length}</div>
          </div>
        </td>
        <td style="padding-left:8px;">
          <div style="background:rgba(16,185,129,0.09);border-radius:10px;padding:18px;text-align:center;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#aaa;margin-bottom:6px;">1099 REQUIRED</div>
            <div style="font-size:26px;font-weight:700;color:#047857;">${needs1099}</div>
          </div>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #eee;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:rgba(13,115,119,0.06);">
          <th style="padding:10px 14px;font-size:10px;font-weight:700;letter-spacing:1px;
                     color:#888;text-align:left;text-transform:uppercase;">Contractor</th>
          <th style="padding:10px 14px;font-size:10px;font-weight:700;letter-spacing:1px;
                     color:#888;text-align:center;text-transform:uppercase;">Payments</th>
          <th style="padding:10px 14px;font-size:10px;font-weight:700;letter-spacing:1px;
                     color:#888;text-align:right;text-transform:uppercase;">Total Paid (✓ = 1099)</th>
        </tr>
      </thead>
      <tbody>${contractorRows || `
        <tr><td colspan="3" style="padding:24px;text-align:center;color:#aaa;font-size:13px;">
          No payments found for ${year}
        </td></tr>`}
      </tbody>
    </table>
  `;

  return base(`${year} Contractor Payment Summary`, body);
}

// ─── Portal Invite ────────────────────────────────────────────────────────────

export type PortalWOSummary = {
  wo_number: string;
  title?: string | null;
  start_date?: string | null;
  start_time?: string | null;
  site_address?: string | null;
  site_city?: string | null;
  site_state?: string | null;
};

export function portalInviteEmail(
  contractorName: string,
  portalUrl: string,
  workOrders: PortalWOSummary[],
): string {
  const woRows = workOrders.map((wo) => {
    const site = [wo.site_address, wo.site_city, wo.site_state].filter(Boolean).join(', ');
    const schedule = [
      wo.start_date ? fmtDate(wo.start_date) : null,
      wo.start_time ?? null,
    ].filter(Boolean).join(' ');
    return `
    <div style="padding:14px 16px;border-radius:8px;background:#fafafa;border:1px solid #eee;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <span style="font-size:12px;font-weight:800;color:${TEAL};font-family:'Segoe UI',sans-serif;">
          WO #${wo.wo_number}
        </span>
        ${wo.title ? `<span style="font-size:13px;font-weight:600;color:#333;">${wo.title}</span>` : ''}
      </div>
      ${schedule ? `<div style="font-size:12px;color:#666;margin-bottom:2px;">📅 ${schedule}</div>` : ''}
      ${site    ? `<div style="font-size:12px;color:#666;">📍 ${site}</div>` : ''}
    </div>`;
  }).join('');

  const body = `
    <div style="font-size:15px;color:#333;line-height:1.8;margin-bottom:24px;">
      Hi <strong>${contractorName}</strong>,<br /><br />
      You have work orders assigned to you. Click the button below to view your
      job details, confirm your schedule, and accept each work order.
    </div>

    ${workOrders.length > 0 ? section('Your Upcoming Jobs', woRows) : ''}

    <div style="text-align:center;margin:32px 0 24px;">
      <a
        href="${portalUrl}"
        style="display:inline-block;padding:16px 36px;
               background:linear-gradient(135deg,#0D7377 0%,#0a5a5d 100%);
               color:white;text-decoration:none;border-radius:10px;
               font-size:15px;font-weight:700;letter-spacing:0.4px;
               box-shadow:0 4px 14px rgba(13,115,119,0.35);">
        ✓ View &amp; Accept My Work Orders
      </a>
    </div>

    <div style="background:rgba(13,115,119,0.06);border-radius:10px;padding:16px;
                font-size:12px;color:#888;text-align:center;line-height:1.7;">
      No login required — your link is unique to you.<br />
      Bookmark it to check back anytime.
    </div>
  `;

  return base('Your Work Orders — FAJ Solutions', body);
}
