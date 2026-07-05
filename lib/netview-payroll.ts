import type { WorkOrder, Contractor } from '@/lib/types';

// Netview's real "Vendor Payment Portal" Google Form. Entry IDs verified directly against the
// live form's FB_PUBLIC_LOAD_DATA_ JSON on 2026-07-01 — legacy faj-portal-web's hardcoded IDs
// did not match this form and produced a blank prefill. Do not port those.
const FORM_BASE = 'https://docs.google.com/forms/d/e/1FAIpQLScnfErr456x8yuRh4sPZeEAugKD5iEFo4TXD5oaAtlp1sjK-A/viewform';

// Blank (un-prefilled) form link for the sidebar shortcut.
export const NETVIEW_FORM_URL = FORM_BASE;

const ENTRY = {
  invoiceDate:    'entry.270691041',
  serviceDate:    'entry.116346627',
  vendorName:     'entry.956795801',
  rate:           'entry.1719028500',
  quantity:       'entry.1596223790',
  other:          'entry.2058828780',
  totalAmount:    'entry.1510356417',
  customerName:   'entry.2132524272',
  invoiceNumber:  'entry.1582831326',
  siteId:         'entry.1287709863',
  memo:           'entry.1515920603',
  coordinator:    'entry.1450654372',
  personEntering: 'entry.207071221',
  email:          'entry.1632549946',
  // Direct deposit radio (entry.1894271667) and invoice-confirmation radio (entry.894978173)
  // are intentionally left unprefilled — required financial confirmations Fred must answer
  // himself on Google's own form, not defaulted by this app.
};

function todayMMDDYYYY(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

function isoToMMDDYYYY(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${m}/${d}/${y}`;
}

/**
 * Builds a pre-filled link to Netview's real payroll submission form. Opens in a new tab so
 * Fred reviews and submits it himself on Google's own UI — this only saves typing, it never
 * submits on his behalf (see Phase 10 plan notes on why /formResponse auto-submit was rejected).
 */
export function buildNetviewFormUrl(wo: WorkOrder, contractor: Contractor | null, currentUserEmail: string): string {
  const params = new URLSearchParams({
    [ENTRY.invoiceDate]:    todayMMDDYYYY(),
    [ENTRY.serviceDate]:    isoToMMDDYYYY(wo.start_date),
    [ENTRY.vendorName]:     contractor?.business_name || contractor?.name || 'FAJ Solutions',
    [ENTRY.totalAmount]:    wo.total_amount ? String(wo.total_amount) : '',
    [ENTRY.customerName]:   wo.customer_name || '',
    [ENTRY.invoiceNumber]:  wo.wo_number || '',
    [ENTRY.siteId]:         wo.client_reference || wo.external_wo_id || '',
    [ENTRY.memo]:           wo.description || wo.title || '',
    [ENTRY.personEntering]: currentUserEmail,
    [ENTRY.email]:          currentUserEmail,
  });
  return `${FORM_BASE}?usp=pp_url&${params.toString()}`;
}
