// The office's Edit work order window shows only the tabs a job uses (Fred,
// 2026-10-18: "All work order need to start the same way blank, I'll add
// what's needed, remove the old style" and "Why are the tabs still there").
// Details is always there; any other tab shows once it has something in it,
// or once Fred adds it with "+ Add". Pure and unit-tested (lib/wo-tabs.test.ts).

export type WoTab = 'details' | 'marketplace' | 'pay' | 'payments' | 'timelog' | 'site' | 'schedule' | 'scope'
  | 'contacts' | 'questions' | 'documents' | 'chat' | 'closeout';

const filled = (v: unknown) => (typeof v === 'string' ? v.trim() !== '' : v != null && v !== false);
const any = (...vs: unknown[]) => vs.some(filled);

export type TabFacts = {
  saved: boolean;
  status?: string | null;
  checkedIn?: boolean;
  techs: number;
  docs: number;
  attachment?: string | null;
  client?: { customer?: string | null; buyer?: string | null; externalId?: string | null; reference?: string | null;
    project?: string | null; isProject?: boolean | null; platform?: string | null };
  pay: Record<string, number> | null | undefined;
  payLines: number;
  payments: number;
  site: (string | null | undefined)[];
  schedule: (string | null | undefined)[];
  scope: (string | null | undefined)[];
  tasks: number;
  contacts: number;
  poc: (string | null | undefined)[];
  questions: number;
  materials: number;
  closeout?: unknown;
};

const WORKED = new Set(['In Progress', 'Work Done', 'Approved', 'Paid']);

/** The tabs this job already has something in (Details always). */
export function tabsInUse(f: TabFacts): WoTab[] {
  const c = f.client ?? {};
  const out: WoTab[] = ['details'];
  if (f.docs > 0 || filled(f.attachment)) out.push('documents');
  if (f.saved && f.techs > 0) out.push('chat');
  if (any(c.customer, c.buyer, c.externalId, c.reference, c.project, c.isProject) || (filled(c.platform) && c.platform !== 'Internal')) out.push('marketplace');
  if (Object.values(f.pay ?? {}).some((n) => Number(n) > 0) || f.payLines > 0) out.push('pay');
  if (f.payments > 0) out.push('payments');
  if (f.saved && (WORKED.has(f.status ?? '') || f.checkedIn)) out.push('timelog');
  if (any(...f.site)) out.push('site');
  if (any(...f.schedule)) out.push('schedule');
  if (any(...f.scope) || f.tasks > 0) out.push('scope');
  if (f.contacts > 0 || any(...f.poc)) out.push('contacts');
  if (f.questions > 0) out.push('questions');
  if (f.materials > 0 || (f.closeout != null && typeof f.closeout === 'object' && Object.keys(f.closeout as object).length > 0)) out.push('closeout');
  return out;
}
