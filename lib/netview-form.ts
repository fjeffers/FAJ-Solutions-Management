// NetView's Vendor Payment Portal, filled in from a QuickBooks invoice (Fred,
// 2026-10-24: some clients want their own format — "YEW THEY DO" — and
// "YOU CAN ANYTHINK TO MAKE MY LIFE EASIER").
//
// NetView pays from a Google Form: one entry per invoice, and the invoice
// itself still goes to Payroll@TeamNetview.com. Entries after Monday wait a
// week, so this sits right next to the invoice Fred just created on the Field
// Sheet. Every answer the work order already knows is put in the link; Fred
// checks it and presses Submit himself. The money is the invoice's full total
// only: the breakdown is on the QuickBooks invoice.
//
// Never filled in: the direct deposit answer, the "invoice was emailed"
// confirmation (only Fred knows), and the form's bank and tax ID page.
//
// Pure and unit-tested (lib/netview-form.test.ts).

export const NETVIEW_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLScnfErr456x8yuRh4sPZeEAugKD5iEFo4TXD5oaAtlp1sjK-A/viewform';
export const NETVIEW_PAYROLL = 'Payroll@TeamNetview.com';

/** The form's question ids (entry.N), read from the live form on 2026-10-24. */
const Q = {
  invoiceDate: 270691041,
  serviceDate: 116346627,
  vendor: 956795801,
  rate: 1719028500,
  quantity: 1596223790,
  other: 2058828780,
  total: 1510356417,
  customer: 2132524272,
  invoiceNumber: 1582831326,
  siteId: 1287709863,
  memo: 1515920603,
  coordinator: 1450654372,
  enteredBy: 207071221,
  email: 1632549946,
} as const;

type Contact = { name?: string | null; email?: string | null; label?: string | null };

export type NetviewJob = {
  wo_number: string;
  external_wo_id?: string | null;
  client_reference?: string | null;
  customer_name?: string | null;
  buyer_company?: string | null;
  source_platform?: string | null;
  title?: string | null;
  site_name?: string | null;
  site_city?: string | null;
  site_state?: string | null;
  contacts?: Contact[] | null;
};

export type NetviewInvoice = {
  number: string;
  total: number;
  /** YYYY-MM-DD */
  date: string;
  from: string;
  to: string;
  /** The saved invoice's hourly rates, ready for NetView's Rate field. */
  rate?: string;
  /** The saved invoice's billable hours, ready for NetView's Quantity field. */
  quantity?: string;
  /** The saved invoice's charge breakdown, ready for NetView's Other field. */
  other?: string;
};

type NetviewInvoiceTech = {
  tech: string;
  hours: { qty: number; rate: number | null; amount: number };
  mileage: { amount: number; lines: { qty: number | null; rate: number | null }[] };
  meals: { amount: number };
  materials?: { amount: number };
  travel: { amount: number };
};

type NetviewInvoiceBreakdown = {
  techs: NetviewInvoiceTech[];
  totals: { labor: number; mileage: number; meals: number; materials: number; travel: number; total: number };
};

const numberText = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const moneyText = (n: number) => `$${n.toFixed(2)}`;

/** NetView's Rate, Quantity and Other answers from the same saved invoice shown on screen. */
export function netviewInvoiceDetails(invoice: NetviewInvoiceBreakdown): Pick<NetviewInvoice, 'rate' | 'quantity' | 'other'> {
  const hours = invoice.techs.filter((t) => t.hours.qty > 0);
  const rate = hours
    .filter((t) => t.hours.rate != null)
    .map((t) => `${t.tech}: ${moneyText(t.hours.rate!)}/hr`)
    .join('; ');
  const quantity = hours
    .map((t) => `${t.tech}: ${numberText(t.hours.qty)} hr`)
    .join('; ');

  const lines: string[] = [];
  for (const tech of invoice.techs) {
    if (tech.hours.amount > 0) {
      lines.push(`${tech.tech} labor: ${numberText(tech.hours.qty)} hr${tech.hours.rate == null ? '' : ` × ${moneyText(tech.hours.rate)}/hr`} = ${moneyText(tech.hours.amount)}`);
    }
    const miles = tech.mileage.lines.reduce((total, line) => total + (line.qty ?? 0), 0);
    const mileRate = tech.mileage.lines.find((line) => line.rate != null)?.rate ?? null;
    if (tech.mileage.amount > 0) {
      lines.push(`${tech.tech} mileage: ${numberText(miles)} mi${mileRate == null ? '' : ` × ${moneyText(mileRate)}/mi`} = ${moneyText(tech.mileage.amount)}`);
    }
    if (tech.meals.amount > 0) lines.push(`${tech.tech} meals: ${moneyText(tech.meals.amount)}`);
    if ((tech.materials?.amount ?? 0) > 0) lines.push(`Materials: ${moneyText(tech.materials!.amount)}`);
    if (tech.travel.amount > 0) lines.push(`${tech.tech} hotel/travel: ${moneyText(tech.travel.amount)}`);
  }
  lines.push(
    `Totals: labor ${moneyText(invoice.totals.labor)}, mileage ${moneyText(invoice.totals.mileage)}, meals ${moneyText(invoice.totals.meals)}, materials ${moneyText(invoice.totals.materials)}, travel ${moneyText(invoice.totals.travel)}, invoice ${moneyText(invoice.totals.total)}`,
  );
  return { rate, quantity, other: lines.join('\n') };
}

/** A NetView job: NetView is the buyer, the platform, or a contact's company. */
export function isNetviewJob(w: NetviewJob, client?: string | null): boolean {
  const nv = (s: string | null | undefined) => /net\s*view/i.test(s ?? '');
  return nv(client) || nv(w.buyer_company) || nv(w.source_platform)
    || (w.contacts ?? []).some((c) => /@teamnetview\.com$/i.test((c.email ?? '').trim()));
}

/** The NetView coordinator who can approve the entry: their dispatcher/coordinator/manager, else any NetView contact. */
export function netviewCoordinator(contacts: Contact[] | null | undefined): string {
  const list = (contacts ?? []).filter((c) => (c.name ?? '').trim());
  const netview = list.filter((c) => /@teamnetview\.com$/i.test((c.email ?? '').trim()) || /net\s*view/i.test(c.label ?? ''));
  const role = (c: Contact) => /coordinat|dispatch|manager|\bpm\b/i.test(c.label ?? '');
  const pick = netview.find(role) ?? list.find(role) ?? netview[0];
  return (pick?.name ?? '').trim();
}

const mdy = (d: string) => { const [y, m, day] = d.split('-'); return `${m}/${day}/${y}`; };

/** The answers, by question. Empty answers are left out of the link. */
export function netviewAnswers(input: {
  job: NetviewJob; invoice: NetviewInvoice; vendor: string; enteredBy: string; email: string;
}): Record<keyof typeof Q, string> {
  const { job: w, invoice: inv } = input;
  const days = inv.from === inv.to ? mdy(inv.from) : `${mdy(inv.from)} – ${mdy(inv.to)}`;
  const place = [w.site_name, [w.site_city, w.site_state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  return {
    invoiceDate: inv.date,
    serviceDate: inv.to,
    vendor: input.vendor,
    rate: inv.rate ?? '',
    quantity: inv.quantity ?? '',
    other: inv.other ?? '',
    total: inv.total.toFixed(2),
    customer: (w.customer_name ?? '').trim(),
    invoiceNumber: inv.number,
    siteId: [w.external_wo_id, w.client_reference ? `Site ${w.client_reference}` : '', `FAJ WO ${w.wo_number}`].filter(Boolean).join(' · '),
    memo: [(w.title ?? '').trim() || place, place && (w.title ?? '').trim() ? place : '', days].filter(Boolean).join(' · '),
    coordinator: netviewCoordinator(w.contacts),
    enteredBy: input.enteredBy.trim(),
    email: input.email.trim(),
  };
}

/** The form's link with the answers already in it. */
export function netviewFormUrl(answers: Record<keyof typeof Q, string>): string {
  const p = new URLSearchParams({ usp: 'pp_url' });
  for (const k of Object.keys(Q) as (keyof typeof Q)[]) {
    const v = answers[k];
    if (v) p.append(`entry.${Q[k]}`, v);
  }
  return `${NETVIEW_FORM}?${p.toString()}`;
}
