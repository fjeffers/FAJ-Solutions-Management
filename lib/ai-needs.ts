// Generate with AI asks before it builds (Fred, 2026-10-18: "include AI around
// the generation asking what's needed and what not" ... "it can read the email
// then ask me if we should build or not"). The AI reads the email; Fred ticks
// what this job needs; only that goes on the job. Pure and unit-tested.
import type { SiteContact, WorkOrder } from './types';
import { parseCapture, type CaptureItem } from './capture';

/** What the AI read from the email, before Fred chooses. */
export type Found = Partial<WorkOrder> & { capture_why?: string };

export type NeedChoices = {
  /** What the tech records on this job (lib/capture.ts). */
  capture: CaptureItem[];
  /** The contacts kept, by id. */
  contacts: string[];
  /** The links kept, and the ones opened on site and at check-out ('' for none). */
  links: string[];
  checkin: string;
  checkout: string;
  access: boolean;
  parts: boolean;
  deliverables: boolean;
  money: boolean;
  /** Bill the client for mileage, worked out from the address when the job opens. */
  mileage: boolean;
};

const MONEY = ['total_amount', 'pay_type', 'hourly_rate', 'per_device_rate', 'device_count', 'expense_budget', 'travel_amount', 'bonus_amount'] as const;
const ACCESS = ['access_instructions', 'parking_instructions'] as const;
const PARTS = ['parts_materials', 'tools_required', 'required_skills'] as const;
const DELIVERABLES = ['deliverables', 'deliverable_instructions'] as const;

const set = (v: unknown) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** A contact who is one of the techs sent to do the work (Lead Tech, Helper…): left off unless Fred keeps them. */
export const isTechContact = (c: SiteContact) => /\b(tech|technician|helper|installer|crew)\b/i.test(c.label ?? '');

/** Which of the optional parts the email had at all. */
export function foundParts(f: Found) {
  return {
    access: ACCESS.some((k) => set(f[k])),
    parts: PARTS.some((k) => set(f[k])),
    deliverables: DELIVERABLES.some((k) => set(f[k])),
    money: MONEY.some((k) => set(f[k])),
  };
}

/** Where Fred starts: the template's items (or the AI's suggestion), every contact but the techs, every link. */
export function defaultNeeds(f: Found, templateItems: readonly CaptureItem[] | null): NeedChoices {
  const links = f.client_links ?? [];
  const pick = (l: string | null | undefined) => (l && links.includes(l) ? l : '');
  return {
    capture: [...(templateItems ?? parseCapture(f.capture) ?? [])],
    contacts: (f.contacts ?? []).filter((c) => !isTechContact(c)).map((c) => c.id),
    links: [...links],
    checkin: pick(f.checkin_link),
    checkout: pick(f.checkout_link),
    access: true, parts: true, deliverables: true, money: true, mileage: true,
  };
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** The job as Fred chose it: only what he kept. */
export function applyNeeds(f: Found, n: NeedChoices): Partial<WorkOrder> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { capture_why, ...rest } = f;
  const out: Partial<WorkOrder> = { ...rest, capture: [...n.capture] };
  const has = (k: CaptureItem) => n.capture.includes(k);
  if (!has('checklist')) delete out.wo_tasks;
  if (!has('questions')) delete out.custom_qa;
  if (!has('photos')) delete out.photo_required;
  if (!has('signature')) delete out.signature_required;

  const all = f.contacts ?? [];
  const kept = all.filter((c) => n.contacts.includes(c.id));
  if (kept.length) out.contacts = kept; else delete out.contacts;
  // The site contact goes with its person: leaving a contact off takes them off as the site contact too.
  const dropped = all.filter((c) => !n.contacts.includes(c.id));
  const isPoc = (c: SiteContact) =>
    (!!f.poc_email && !!c.email && c.email.toLowerCase() === f.poc_email.toLowerCase())
    || (!!f.poc_name && !!c.name && c.name.toLowerCase() === f.poc_name.toLowerCase())
    || (digits(f.poc_phone).length >= 7 && digits(c.phone).endsWith(digits(f.poc_phone).slice(-10)));
  if (dropped.some(isPoc)) { delete out.poc_name; delete out.poc_phone; delete out.poc_email; }

  const links = (f.client_links ?? []).filter((l) => n.links.includes(l));
  if (links.length) out.client_links = links; else delete out.client_links;
  delete out.checkin_link;
  delete out.checkout_link;
  if (n.checkin && links.includes(n.checkin)) out.checkin_link = n.checkin;
  if (n.checkout && links.includes(n.checkout)) out.checkout_link = n.checkout;
  for (const k of ['survey_link', 'deliverable_link'] as const) if (out[k] && !links.includes(out[k])) delete out[k];

  const drop = (keys: readonly (keyof WorkOrder)[]) => { for (const k of keys) delete out[k]; };
  if (!n.access) drop(ACCESS);
  if (!n.parts) drop(PARTS);
  if (!n.deliverables) drop(DELIVERABLES);
  if (!n.money) drop(MONEY);
  // No mileage charge: 0 billable miles, so the job doesn't work one out when it opens.
  if (!n.mileage) out.billable_miles = 0;
  return out;
}
