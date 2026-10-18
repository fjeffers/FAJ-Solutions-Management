// ─── FAJ Email Templates ──────────────────────────────────────────────────────
// Pure functions — no browser APIs, safe to call from API routes.

import type { WorkOrder, Payment, Contractor, Invoice } from './types';
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

/** "08:00" / "17:30" → "8:00 AM" / "5:30 PM"; anything else as written. */
export function clock12(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(text);
  if (!m || Number(m[1]) > 23) return text;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The status a tech reads (Fred, 2026-10-18, testing as a tech: the email
 * said "Open" on a job already assigned to him). An Open job with a tech on
 * it is that tech's job.
 */
export function techStatusWord(wo: Pick<WorkOrder, 'wo_status' | 'contractor_name' | 'contractor_names'>): string {
  const s = wo.wo_status || 'Open';
  const hasTech = !!wo.contractor_name || (wo.contractor_names?.length ?? 0) > 0;
  return (s === 'Open' || s === 'Assigned') && hasTech ? 'Assigned to you' : s;
}

/** "Oct 19, 2026, 8:00 AM – Oct 24, 2026", or "Oct 19, 2026, 10:00 AM – 5:00 PM" on one day. */
export function scheduleLine(wo: Partial<Pick<WorkOrder, 'start_date' | 'start_time' | 'end_date' | 'end_time'>>): string {
  const start = [wo.start_date ? fmtDate(wo.start_date) : null, wo.start_time ? clock12(wo.start_time) : null].filter(Boolean).join(', ');
  const end = [
    wo.end_date && wo.end_date !== wo.start_date ? fmtDate(wo.end_date) : null,
    wo.end_time ? clock12(wo.end_time) : null,
  ].filter(Boolean).join(', ');
  return [start, end].filter(Boolean).join(' – ');
}

export function workOrderEmail(wo: WorkOrder, note?: string, opts: WorkOrderEmailOpts = {}): string {
  const site = [wo.site_name, wo.site_address, wo.site_city, wo.site_state, wo.site_zip]
    .filter(Boolean).join(', ');
  const schedule = scheduleLine(wo);

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
        ${infoRow('Status', techStatusWord(wo))}
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

// Goes to the tech who was paid, so it never shows the job's price (WO Total
// was here until 2026-10-18: Fred, "why I as a tech see the money").
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

// ─── Invoice ──────────────────────────────────────────────────────────────────

/**
 * The client-facing invoice email. Carries the headline number and a link to
 * the shareable invoice page — line items live there, not in the email, so a
 * long site-visit roll-up doesn't turn into a wall of text in Outlook.
 */
export function invoiceEmail(
  invoice: Invoice,
  shareUrl: string | null,
  note?: string,
): string {
  const lineCount = invoice.line_items?.length ?? 0;
  const preview = (invoice.line_items ?? []).slice(0, 6);
  const hidden = lineCount - preview.length;

  const rows = preview
    .map((li) =>
      infoRow(
        li.description || 'Work performed',
        fmtMoney(Number(li.quantity ?? 1) * Number(li.rate ?? 0)),
      ),
    )
    .join('');

  const body = `
  <p style="font-size:14px;color:#333;line-height:1.7;margin:0 0 22px;">
    Please find invoice <strong>${invoice.invoice_number}</strong> below${
      invoice.client_name ? ` for ${invoice.client_name}` : ''
    }.
  </p>

  ${note ? `<div style="font-size:13px;color:#444;line-height:1.7;background:#f7f8fa;
              border-left:3px solid ${TEAL};padding:12px 16px;margin-bottom:22px;">
              ${note.replace(/\n/g, '<br />')}
            </div>` : ''}

  ${section('Summary', `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    ${infoRow('Invoice number', invoice.invoice_number)}
    ${invoice.due_date ? infoRow('Due', fmtDate(invoice.due_date)) : ''}
    ${infoRow('Amount due', fmtMoney(Number(invoice.total)), true)}
  </table>`)}

  ${lineCount ? section(`Work covered (${lineCount} line${lineCount !== 1 ? 's' : ''})`,
    `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table>
     ${hidden > 0 ? `<div style="font-size:12px;color:#888;padding-top:10px;">
        …and ${hidden} more line${hidden !== 1 ? 's' : ''} — see the full invoice.
     </div>` : ''}`) : ''}

  ${shareUrl ? `<div style="text-align:center;margin:28px 0 8px;">
    <a href="${shareUrl}"
       style="display:inline-block;background:${TEAL};color:#fff;text-decoration:none;
              font-size:14px;font-weight:600;padding:13px 30px;border-radius:8px;">
      View &amp; print invoice
    </a>
    <div style="font-size:11px;color:#aaa;margin-top:10px;">
      No login needed — the link opens the invoice directly.
    </div>
  </div>` : ''}

  <p style="font-size:13px;color:#666;line-height:1.7;margin:22px 0 0;">
    Any questions on this invoice, just reply to this email.
  </p>`;

  return base(`Invoice ${invoice.invoice_number}`, body);
}
