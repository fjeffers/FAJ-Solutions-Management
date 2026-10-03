// The support inbox's queues (migration-104). Kept apart from the bot's model
// call (lib/support-triage.ts) so screens can use them without shipping the AI
// client to the browser.
export const SUPPORT_QUEUES = [
  { key: 'dispatch', label: 'Dispatch & scheduling', hint: 'Book, move or cancel a visit; asks when the tech is coming; send someone out for planned work' },
  { key: 'field_issue', label: 'Field / tech issue', hint: 'Something is down, broken or went wrong on site - an outage, a failed install, a return visit, a complaint about the work' },
  { key: 'billing', label: 'Billing & payments', hint: 'Invoices, payments, pricing on existing work, a tech asking about pay' },
  { key: 'new_work', label: 'New work & quotes', hint: 'A new customer or a new project - a quote, a site survey, a proposal, an RFP' },
  { key: 'needs_fred', label: 'Needs Fred', hint: 'Unclear, sensitive (legal, insurance, a dispute), or none of the above' },
  { key: 'not_a_ticket', label: 'Not a ticket', hint: 'Spam, marketing, newsletters, automated notices - nothing for FAJ to do' },
] as const;

export type SupportQueue = (typeof SUPPORT_QUEUES)[number]['key'];
export const isSupportQueue = (v: unknown): v is SupportQueue =>
  typeof v === 'string' && SUPPORT_QUEUES.some((q) => q.key === v);
export const queueLabel = (q: string | null | undefined) => SUPPORT_QUEUES.find((x) => x.key === q)?.label ?? 'Needs Fred';
