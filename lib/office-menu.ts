// The Office hub — every screen in the owner app on one page, with a search
// box (Fred, 2026-10-04: "can workflow update to what you see" — Primio's
// Office screen — "everything"). Same groups as the sidebar. Handiest on a
// phone, where the sidebar hides behind the menu button.
//
// Fred, 2026-10-04: "the only thing i should see is dashboard, dispatcher,
// schedule and office, and everything else should go under office with its own
// drop down". So the left menu is SIDEBAR_VIEWS (plus Dispatch, WorkFlow's
// board) and every other screen is here, once.
//
// lib/office-menu.test.ts checks that every screen in app/page.tsx is either in
// the left menu or listed here, so a new screen can't be left off.

export type OfficeItem = {
  /** The owner app view it opens; null for a link to another site or an action. */
  view: string | null;
  href?: string;
  /** 'new-order' opens the New job form. */
  action?: 'new-order';
  label: string;
  hint: string;
};
/** id never changes, so Fred can rename a section (Settings -> Menu & screens). */
export type OfficeGroup = { id: string; title: string; items: OfficeItem[] };

/**
 * The screens in the left menu itself — not repeated on the Office page.
 * ('workorders' is Dispatch.) Fred, 2026-10-05: "add message under
 * scheduled", "add setting under office".
 */
export const SIDEBAR_VIEWS = ['dashboard', 'workorders', 'scheduling', 'messages', 'office', 'settings'] as const;

export const OFFICE_GROUPS: OfficeGroup[] = [
  {
    id: 'everyday',
    title: 'Every day',
    items: [
      // Fred, 2026-10-13: projects — travel, time on site, miles, receipts, the client report.
      { view: 'projects', label: 'Projects', hint: 'Multi-day sites: travel, time on site, miles, receipts and the weekly bill' },
      // Fred, 2026-10-24: "add it under office and i can pull it by the app work order number and edit whats needed".
      { view: 'fieldsheet', label: 'Field Sheet', hint: 'Pull a job by WO number: fix hours, miles and receipts, see the photos, bill it' },
      { view: 'sitelog', label: 'Site Log', hint: 'Every site visit, ready to bill' },
      { view: 'payables', label: 'Pay Techs', hint: 'What each tech is owed, and paying them' },
      { view: 'team', label: 'Team', hint: 'Office staff logins and what they can see' },
      { view: 'support', label: 'Support', hint: 'Support emails turned into tickets to approve' },
      { view: 'import-queue', label: 'Import', hint: 'Work orders from email and spreadsheets waiting to come in' },
      { view: 'dispatch', label: 'Dispatch Map', hint: 'Techs and jobs on a map' },
    ],
  },
  {
    id: 'money',
    title: 'Money',
    items: [
      { view: 'payments', label: 'Payments Made', hint: 'History of payments sent to techs' },
      { view: 'financials', label: 'Financials', hint: 'Revenue, profit and trends' },
      { view: 'ledger', label: 'Ledger', hint: 'Income and expense ledger' },
      { view: 'customers', label: 'Customers', hint: 'Clients and what each one brings in' },
      { view: 'quickbooks', label: 'QuickBooks', hint: 'Connection to QuickBooks' },
      { view: null, href: 'netview', label: 'NetView Invoice', hint: "NetView's vendor payment form (opens their site)" },
      { view: 'invoices', label: 'Invoices', hint: 'Client invoices and money received' },
    ],
  },
  {
    id: 'techs',
    title: 'Techs',
    items: [
      { view: 'contractors', label: 'Contractors', hint: 'Your techs: contact details, on hold, paperwork' },
      { view: 'contractor-analytics', label: 'Performance', hint: 'Jobs done and on-time record per tech' },
      { view: 'portal-admin', label: 'Portal & Review', hint: 'Tech portal logins and sign-up review' },
      { view: 'statements', label: 'Statements', hint: 'Pay statements for techs' },
      { view: '1099', label: '1099s', hint: 'Year-end 1099 reports' },
      { view: 'w9', label: 'W-9s', hint: 'W-9 forms on file' },
    ],
  },
  {
    // Fred, 2026-10-05, about "Winning work": "we need review or update".
    // Renamed Sales, in the order work is won: survey, quote, contract. The
    // id stays 'winning' so a saved menu still finds it.
    id: 'winning',
    title: 'Sales',
    items: [
      { view: 'surveys', label: 'Surveys', hint: 'Step 1: site surveys and what they found' },
      // Fred, 2026-10-06: "add it under winning work" (now Sales).
      { view: 'sketches', label: 'Sketches', hint: 'Draw your own layout: floor plans to scale, cable runs, cameras, APs and drops' },
      { view: 'quotes', label: 'Quotes', hint: 'Step 2: quotes for clients, built from surveys' },
      { view: 'contracts', label: 'Contracts', hint: 'Step 3: signed agreements; a signed one becomes a job' },
    ],
  },
  {
    id: 'onsite',
    title: 'On site',
    items: [
      { view: 'materials', label: 'Materials', hint: 'Stock, and materials used on jobs' },
      { view: 'maintenance', label: 'Maintenance', hint: 'Recurring maintenance visits' },
      { view: 'network', label: 'Network', hint: 'Network equipment and site records' },
    ],
  },
];

/** The Office section a screen is in ("Money"…), or null for the left menu's own. */
export function officeGroupOf(view: string): string | null {
  return OFFICE_GROUPS.find((g) => g.items.some((i) => i.view === view))?.title ?? null;
}

/** Every word typed must appear in the name, the hint or the group. */
export function searchOffice(groups: OfficeGroup[], query: string): OfficeGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        const text = `${i.label} ${i.hint} ${g.title}`.toLowerCase();
        return words.every((w) => text.includes(w));
      }),
    }))
    .filter((g) => g.items.length > 0);
}
