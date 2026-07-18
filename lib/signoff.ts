import type { WorkOrder, Quote, Invoice } from '@/lib/types';

/**
 * Opens a new browser window with a print-ready Work Order Sign-Off Sheet
 * and immediately triggers the print dialog.
 */
export function printSignOffSheet(wo: WorkOrder) {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const woDate = wo.start_date
    ? new Date(wo.start_date + 'T00:00:00').toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '___________________________';

  const deliverableItems: string[] = wo.deliverables
    ? wo.deliverables.split('\n').map((s) => s.trim()).filter(Boolean)
    : [];

  const siteLines = [
    wo.site_name,
    wo.site_address,
    [wo.site_city, wo.site_state, wo.site_zip].filter(Boolean).join(', '),
  ].filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign-Off Sheet — WO# ${wo.wo_number}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Arial', sans-serif;
      font-size: 11pt;
      color: #1a1a1a;
      background: #fff;
      padding: 0.5in;
    }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #0D7377;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .company-name {
      font-size: 22pt;
      font-weight: 900;
      color: #0D7377;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .company-sub {
      font-size: 9pt;
      color: #666;
      margin-top: 2px;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .doc-title {
      text-align: right;
    }
    .doc-title h1 {
      font-size: 16pt;
      font-weight: 700;
      color: #1a1a1a;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .doc-title .wo-num {
      font-size: 12pt;
      color: #0D7377;
      font-weight: 700;
      margin-top: 4px;
    }

    /* ── Info Grid ── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
    }
    .info-section {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 12px 14px;
    }
    .info-section.full {
      grid-column: 1 / -1;
    }
    .section-label {
      font-size: 8pt;
      font-weight: 700;
      color: #0D7377;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 4px;
    }
    .field-row {
      display: flex;
      gap: 4px;
      margin-bottom: 4px;
      font-size: 10pt;
    }
    .field-label {
      font-weight: 700;
      color: #374151;
      min-width: 90px;
      flex-shrink: 0;
    }
    .field-value {
      color: #1a1a1a;
    }

    /* ── Deliverables ── */
    .deliverables-section {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 20px;
    }
    .deliverable-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 5px 0;
      border-bottom: 1px solid #f3f4f6;
      font-size: 10pt;
    }
    .deliverable-item:last-child {
      border-bottom: none;
    }
    .checkbox {
      width: 16px;
      height: 16px;
      border: 2px solid #374151;
      border-radius: 3px;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .no-deliverables {
      font-size: 10pt;
      color: #9ca3af;
      font-style: italic;
    }

    /* ── Notes line ── */
    .notes-section {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 20px;
    }
    .notes-lines {
      margin-top: 8px;
    }
    .notes-lines .line {
      border-bottom: 1px solid #9ca3af;
      height: 22px;
      margin-bottom: 6px;
    }

    /* ── Signature Block ── */
    .sig-section {
      margin-top: 20px;
      border: 1.5px solid #0D7377;
      border-radius: 6px;
      padding: 16px 18px;
      background: #f0fafa;
    }
    .sig-section-title {
      font-size: 9pt;
      font-weight: 700;
      color: #0D7377;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 16px;
      padding-bottom: 6px;
      border-bottom: 1px solid #b2dfdf;
    }
    .sig-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    .sig-box {}
    .sig-role {
      font-size: 8.5pt;
      font-weight: 700;
      color: #374151;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .sig-line {
      border-bottom: 1.5px solid #374151;
      height: 36px;
      margin-bottom: 6px;
    }
    .sig-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 4px;
    }
    .sig-field {}
    .sig-field-label {
      font-size: 8pt;
      color: #6b7280;
      margin-bottom: 2px;
    }
    .sig-field-line {
      border-bottom: 1px solid #9ca3af;
      height: 18px;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      font-size: 8pt;
      color: #9ca3af;
    }

    @media print {
      body { padding: 0.4in; }
      @page { margin: 0.4in; size: letter portrait; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div>
      <div class="company-name">FAJ Solutions</div>
      <div class="company-sub">Field Services &amp; Work Order Management</div>
    </div>
    <div class="doc-title">
      <h1>Work Order Sign-Off</h1>
      <div class="wo-num">WO# ${escHtml(wo.wo_number)}</div>
    </div>
  </div>

  <!-- Info Grid -->
  <div class="info-grid">

    <!-- Work Order Info -->
    <div class="info-section">
      <div class="section-label">Work Order Information</div>
      ${wo.title ? `<div class="field-row"><span class="field-label">Title:</span><span class="field-value">${escHtml(wo.title)}</span></div>` : ''}
      ${wo.customer_name ? `<div class="field-row"><span class="field-label">Client:</span><span class="field-value">${escHtml(wo.customer_name)}</span></div>` : ''}
      ${wo.buyer_company ? `<div class="field-row"><span class="field-label">Company:</span><span class="field-value">${escHtml(wo.buyer_company)}</span></div>` : ''}
      <div class="field-row"><span class="field-label">WO#:</span><span class="field-value">${escHtml(wo.wo_number)}</span></div>
      ${wo.project_name ? `<div class="field-row"><span class="field-label">Project:</span><span class="field-value">${escHtml(wo.project_name)}</span></div>` : ''}
      ${wo.external_wo_id ? `<div class="field-row"><span class="field-label">Ext. WO#:</span><span class="field-value">${escHtml(wo.external_wo_id)}</span></div>` : ''}
      ${wo.service_type ? `<div class="field-row"><span class="field-label">Service:</span><span class="field-value">${escHtml(wo.service_type)}</span></div>` : ''}
      <div class="field-row"><span class="field-label">Date:</span><span class="field-value">${woDate}</span></div>
    </div>

    <!-- Site / Contractor -->
    <div class="info-section">
      <div class="section-label">Site &amp; Technician</div>
      ${siteLines.length > 0
        ? siteLines.map((l) => `<div class="field-row"><span class="field-value">${escHtml(l)}</span></div>`).join('')
        : '<div class="field-row"><span class="field-value" style="color:#9ca3af">No site information</span></div>'
      }
      ${wo.contractor_name ? `<div class="field-row" style="margin-top:8px"><span class="field-label">Technician:</span><span class="field-value">${escHtml(wo.contractor_name)}</span></div>` : ''}
      ${(wo.contractor_names && wo.contractor_names.length > 0)
        ? `<div class="field-row"><span class="field-label">Team:</span><span class="field-value">${wo.contractor_names.map(escHtml).join(', ')}</span></div>`
        : ''
      }
    </div>

    <!-- Description -->
    ${wo.description ? `
    <div class="info-section full">
      <div class="section-label">Scope of Work</div>
      <div style="font-size:10pt;line-height:1.5;white-space:pre-wrap;">${escHtml(wo.description)}</div>
    </div>` : ''}

  </div>

  <!-- Deliverables Checklist -->
  <div class="deliverables-section">
    <div class="section-label">Deliverables Checklist</div>
    ${deliverableItems.length > 0
      ? deliverableItems.map((item) => `
      <div class="deliverable-item">
        <div class="checkbox"></div>
        <div>${escHtml(item)}</div>
      </div>`).join('')
      : `<div class="no-deliverables">No deliverables specified for this work order.</div>`
    }
  </div>

  <!-- Notes -->
  <div class="notes-section">
    <div class="section-label">Client Notes / Comments</div>
    <div class="notes-lines">
      <div class="line"></div>
      <div class="line"></div>
      <div class="line"></div>
    </div>
  </div>

  <!-- Signature Block -->
  <div class="sig-section">
    <div class="sig-section-title">Authorization &amp; Sign-Off</div>
    <div class="sig-grid">

      <!-- Client Signature -->
      <div class="sig-box">
        <div class="sig-role">Client / Authorized Representative</div>
        <div class="sig-line"></div>
        <div class="sig-fields">
          <div class="sig-field">
            <div class="sig-field-label">Printed Name</div>
            <div class="sig-field-line"></div>
          </div>
          <div class="sig-field">
            <div class="sig-field-label">Date</div>
            <div class="sig-field-line"></div>
          </div>
        </div>
        <div class="sig-field" style="margin-top:8px">
          <div class="sig-field-label">Title / Role</div>
          <div class="sig-field-line"></div>
        </div>
      </div>

      <!-- Technician Signature -->
      <div class="sig-box">
        <div class="sig-role">Technician / Field Representative</div>
        <div class="sig-line"></div>
        <div class="sig-fields">
          <div class="sig-field">
            <div class="sig-field-label">Printed Name</div>
            <div class="sig-field-line"></div>
          </div>
          <div class="sig-field">
            <div class="sig-field-label">Date</div>
            <div class="sig-field-line"></div>
          </div>
        </div>
        <div class="sig-field" style="margin-top:8px">
          <div class="sig-field-label">Company</div>
          <div class="sig-field-line"></div>
        </div>
      </div>

    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <span>FAJ Solutions — Field Services Management</span>
    <span>Printed: ${today} &nbsp;|&nbsp; WO# ${escHtml(wo.wo_number)}</span>
  </div>

  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=850,height=1100');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

/**
 * Opens a new browser window with a print-ready Quote sheet and triggers the print dialog.
 * Mirrors printSignOffSheet's pattern — no PDF library dependency, relies on the browser's
 * native "Save as PDF" print destination.
 */
export function printQuoteSheet(q: Quote) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const validUntil = q.valid_until
    ? new Date(q.valid_until + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const rows = (q.line_items ?? []).map((li) => `
    <tr>
      <td>${escHtml(li.description)}</td>
      <td style="text-align:center">${li.quantity}</td>
      <td style="text-align:right">$${Number(li.rate).toFixed(2)}</td>
      <td style="text-align:right">$${(Number(li.quantity) * Number(li.rate)).toFixed(2)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Quote ${escHtml(q.quote_number)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #1a1a1a; padding: 0.6in; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0D7377; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { font-size: 20pt; font-weight: 700; color: #0D7377; }
    .quote-num { font-size: 13pt; font-weight: 700; text-align: right; }
    .meta { color: #666; font-size: 9pt; margin-top: 4px; }
    .section { margin-bottom: 20px; }
    .label { font-size: 8pt; font-weight: 700; letter-spacing: 0.5px; color: #888; text-transform: uppercase; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #0D7377; color: white; text-align: left; padding: 8px 10px; font-size: 9pt; }
    th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
    th:nth-child(2) { text-align: center; }
    td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 10pt; }
    .totals { display: flex; justify-content: flex-end; margin-top: 12px; }
    .totals table { width: 260px; }
    .totals td { border: none; padding: 4px 10px; }
    .totals .grand { font-weight: 700; font-size: 13pt; color: #0D7377; border-top: 2px solid #0D7377; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-size: 8pt; color: #999; }
    @media print { .footer { position: fixed; bottom: 0.4in; left: 0.6in; right: 0.6in; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">FAJ SOLUTIONS</div>
      <div class="meta">fajsolutions@gmail.com</div>
    </div>
    <div>
      <div class="quote-num">Quote ${escHtml(q.quote_number)}</div>
      <div class="meta">Issued ${today}${validUntil ? ` · Valid until ${validUntil}` : ''}</div>
    </div>
  </div>

  <div class="section">
    <div class="label">Prepared For</div>
    <div>${escHtml(q.client_name)}</div>
    ${q.client_email ? `<div class="meta">${escHtml(q.client_email)}</div>` : ''}
    ${q.client_phone ? `<div class="meta">${escHtml(q.client_phone)}</div>` : ''}
  </div>

  ${q.title ? `<div class="section"><div class="label">Title</div><div>${escHtml(q.title)}</div></div>` : ''}
  ${q.description ? `<div class="section"><div class="label">Scope of Work</div><div>${escHtml(q.description)}</div></div>` : ''}

  <table>
    <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Subtotal</td><td style="text-align:right">$${Number(q.subtotal).toFixed(2)}</td></tr>
      ${Number(q.tax_rate) > 0 ? `<tr><td>Tax (${q.tax_rate}%)</td><td style="text-align:right">$${Number(q.tax_amount).toFixed(2)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td style="text-align:right">$${Number(q.total).toFixed(2)}</td></tr>
    </table>
  </div>

  ${q.notes ? `<div class="section"><div class="label">Notes</div><div>${escHtml(q.notes)}</div></div>` : ''}

  <div class="footer">
    <span>FAJ Solutions — Field Services Management</span>
    <span>Printed: ${today} &nbsp;|&nbsp; ${escHtml(q.quote_number)}</span>
  </div>

  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=850,height=1100');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

export function printInvoiceSheet(inv: Invoice, amountPaid: number) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const dueDate = inv.due_date
    ? new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;
  const balance = Math.max(0, Number(inv.total) - amountPaid);

  const rows = (inv.line_items ?? []).map((li) => `
    <tr>
      <td>${escHtml(li.description)}</td>
      <td style="text-align:center">${li.quantity}</td>
      <td style="text-align:right">$${Number(li.rate).toFixed(2)}</td>
      <td style="text-align:right">$${(Number(li.quantity) * Number(li.rate)).toFixed(2)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${escHtml(inv.invoice_number)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #1a1a1a; padding: 0.6in; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0D7377; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { font-size: 20pt; font-weight: 700; color: #0D7377; }
    .inv-num { font-size: 13pt; font-weight: 700; text-align: right; }
    .meta { color: #666; font-size: 9pt; margin-top: 4px; }
    .section { margin-bottom: 20px; }
    .label { font-size: 8pt; font-weight: 700; letter-spacing: 0.5px; color: #888; text-transform: uppercase; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #0D7377; color: white; text-align: left; padding: 8px 10px; font-size: 9pt; }
    th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
    th:nth-child(2) { text-align: center; }
    td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 10pt; }
    .totals { display: flex; justify-content: flex-end; margin-top: 12px; }
    .totals table { width: 280px; }
    .totals td { border: none; padding: 4px 10px; }
    .totals .grand { font-weight: 700; font-size: 13pt; color: #0D7377; border-top: 2px solid #0D7377; }
    .totals .balance { font-weight: 700; font-size: 13pt; color: ${balance > 0 ? '#b91c1c' : '#047857'}; }
    .paid-stamp { display: inline-block; margin-top: 8px; padding: 4px 14px; border: 2px solid #047857; border-radius: 6px; color: #047857; font-weight: 700; font-size: 12pt; letter-spacing: 2px; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-size: 8pt; color: #999; }
    @media print { .footer { position: fixed; bottom: 0.4in; left: 0.6in; right: 0.6in; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">FAJ SOLUTIONS</div>
      <div class="meta">fajsolutions@gmail.com</div>
    </div>
    <div>
      <div class="inv-num">Invoice ${escHtml(inv.invoice_number)}</div>
      <div class="meta">Issued ${today}${dueDate ? ` · Due ${dueDate}` : ''}</div>
    </div>
  </div>

  <div class="section">
    <div class="label">Bill To</div>
    <div>${escHtml(inv.client_name)}</div>
    ${inv.client_email ? `<div class="meta">${escHtml(inv.client_email)}</div>` : ''}
    ${inv.client_phone ? `<div class="meta">${escHtml(inv.client_phone)}</div>` : ''}
  </div>

  ${inv.title ? `<div class="section"><div class="label">Title</div><div>${escHtml(inv.title)}</div></div>` : ''}
  ${inv.description ? `<div class="section"><div class="label">Work Performed</div><div>${escHtml(inv.description)}</div></div>` : ''}

  <table>
    <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Subtotal</td><td style="text-align:right">$${Number(inv.subtotal).toFixed(2)}</td></tr>
      ${Number(inv.tax_rate) > 0 ? `<tr><td>Tax (${inv.tax_rate}%)</td><td style="text-align:right">$${Number(inv.tax_amount).toFixed(2)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td style="text-align:right">$${Number(inv.total).toFixed(2)}</td></tr>
      ${amountPaid > 0 ? `<tr><td>Paid</td><td style="text-align:right">−$${amountPaid.toFixed(2)}</td></tr>` : ''}
      ${amountPaid > 0 || balance > 0 ? `<tr class="balance"><td>Balance Due</td><td style="text-align:right">$${balance.toFixed(2)}</td></tr>` : ''}
    </table>
  </div>

  ${balance <= 0 && Number(inv.total) > 0 ? `<div style="text-align:right"><span class="paid-stamp">PAID</span></div>` : ''}

  ${inv.notes ? `<div class="section"><div class="label">Notes</div><div>${escHtml(inv.notes)}</div></div>` : ''}
  ${dueDate && balance > 0 ? `<div class="section meta">Please include invoice number ${escHtml(inv.invoice_number)} with your payment. Payment is due by ${dueDate}.</div>` : ''}

  <div class="footer">
    <span>FAJ Solutions — Field Services Management</span>
    <span>Printed: ${today} &nbsp;|&nbsp; ${escHtml(inv.invoice_number)}</span>
  </div>

  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=850,height=1100');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

function escHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
