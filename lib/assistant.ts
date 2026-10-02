// The assistant section's data layer (migration-092).
//
// Same shape as the tech portal: every read and write is an asst_* RPC. RLS on
// work_orders/contractors/crew_* is keyed to Fred's user id, so an assistant's
// session gets zero rows from a plain select. The RPCs resolve the caller from
// auth.uid(), scope to Fred's business, and name every column they return —
// none of them carries money. The database is what keeps money out of this
// section; nothing here has to remember to hide it.
//
// The sorting and grouping below is pure and unit-tested.
import { createClient } from '@/lib/supabase/client';

export interface AssistantMe {
  staff_id: string;
  name: string;
  email: string;
  owner_id: string;
  role: 'assistant';
}

/** A work order as the assistant sees it: the work, never the price or pay. */
export interface AssistantJob {
  id: string;
  wo_number: string | null;
  title: string | null;
  description: string | null;
  status: string | null;
  priority: string | null;
  service_type: string | null;
  customer_name: string | null;
  project_name: string | null;
  client_reference: string | null;
  source_platform: string | null;
  external_wo_id: string | null;
  site_name: string | null;
  site_address: string | null;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;
  scheduled_date: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  time_zone: string | null;
  techs: string[];
  lead_tech: string | null;
  poc_name: string | null;
  poc_phone: string | null;
  poc_email: string | null;
  access_instructions: string | null;
  parking_instructions: string | null;
  special_instructions: string | null;
  scope_of_work: string | null;
  deliverables: string | null;
  tools_required: string | null;
  required_skills: string | null;
  travel_start_at: string | null;
  arrived_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistantCrewSite {
  id: string;
  project: string;
  client: string | null;
  team: string | null;
  lead: string | null;
  helper: string | null;
  week_start: string | null;
  survey_date: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  property_id: string | null;
  status: string | null;
}

export interface AssistantTech {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  business_name: string | null;
  city: string | null;
  state: string | null;
  w9_received: boolean;
  agreement_signed: boolean;
  has_login: boolean;
  last_login_at: string | null;
}

export interface StaffTask {
  id: string;
  title: string;
  details: string | null;
  due_date: string | null;
  status: 'open' | 'done';
  done_at: string | null;
  done_note: string | null;
  created_at: string;
}

/** Fields the assistant may change on a job — mirrors asst_update_job's list. */
export type AssistantJobPatch = Partial<Pick<AssistantJob,
  'scheduled_date' | 'start_time' | 'end_time' | 'poc_name' | 'poc_phone' | 'poc_email'
  | 'access_instructions' | 'parking_instructions' | 'special_instructions'>>;

interface RpcResult { ok: boolean; reason: string }

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchAssistantMe = () => rpc<AssistantMe | null>('asst_me');
export const fetchAssistantJobs = async () => (await rpc<AssistantJob[] | null>('asst_jobs')) ?? [];
export const fetchAssistantCrewSites = async () => (await rpc<AssistantCrewSite[] | null>('asst_crew_sites')) ?? [];
export const fetchAssistantTechs = async () => (await rpc<AssistantTech[] | null>('asst_techs')) ?? [];
export const fetchAssistantTasks = async () => (await rpc<StaffTask[] | null>('asst_tasks')) ?? [];

export const saveAssistantJob = (id: string, patch: AssistantJobPatch) =>
  rpc<RpcResult>('asst_update_job', { p_id: id, p_patch: patch });

export const setAssistantTask = (id: string, done: boolean, note: string) =>
  rpc<RpcResult>('asst_task_set', { p_id: id, p_done: done, p_note: note });

/**
 * Binds this login to its staff row on first sign-in and says which role it
 * has. Safe to call every time (it also records the sign-in for Fred).
 */
export async function claimAssistantAccount(): Promise<RpcResult & { role?: string }> {
  try {
    return await rpc<RpcResult & { role?: string }>('staff_claim_account');
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * Should this login be in the assistant section rather than the owner app?
 * Fails SAFE: an error leaves the person where they are.
 */
export async function belongsInAssistantSection(): Promise<boolean> {
  try {
    return (await rpc<boolean>('belongs_in_assistant_section')) === true;
  } catch {
    return false;
  }
}

// ─── Owner side ─────────────────────────────────────────────────────────────

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  enabled: boolean;
  auth_user_id: string | null;
  last_login_at: string | null;
  created_at: string;
}

export const addStaffMember = (name: string, email: string, role: StaffRole = 'assistant') =>
  rpc<RpcResult>('owner_staff_add', { p_name: name, p_email: email, p_role: role });

/**
 * Every kind of person on the app, and what each one can see. Owner and tech
 * have their own models; the staff_members roles are the ones with
 * `canAdd: true`. A role becomes addable only when its section exists — the
 * database (staff_role_allowed, migration-094) refuses any other.
 */
export type StaffRole = 'assistant';
export interface RoleInfo {
  key: 'owner' | 'tech' | StaffRole | 'accountant' | 'developer';
  label: string;
  sees: string;
  canAdd: boolean;
  /** Where to add this kind of person, when it is not the Team screen. */
  addedWhere?: string;
}
export const ROLES: RoleInfo[] = [
  { key: 'owner', label: 'Owner', sees: 'Everything, including all money. That is you.', canAdd: false },
  { key: 'tech', label: 'Tech', sees: "Only their own jobs and their own pay. Never anyone else's.", canAdd: false, addedWhere: 'Contractors screen' },
  { key: 'assistant', label: 'Assistant', sees: 'All jobs, the schedule, tech contacts and their to-do list. No money.', canAdd: true },
  { key: 'accountant', label: 'Accountant', sees: 'Not set up yet. Money only, read-only, once you decide what they need.', canAdd: false },
  { key: 'developer', label: 'Developer', sees: 'No login to your live app. They get the code and a practice copy with fake data.', canAdd: false },
];

/** The section a staff role signs in to. */
export function sectionForRole(role: string | null | undefined): string | null {
  switch (role) {
    case 'assistant': return '/assistant';
    default: return null;
  }
}
export const setStaffEnabled = (id: string, enabled: boolean) =>
  rpc<RpcResult>('owner_staff_set_enabled', { p_id: id, p_enabled: enabled });
export const removeStaffMember = (id: string) =>
  rpc<RpcResult>('owner_staff_remove', { p_id: id });

/** Plain-English for every reason code the staff functions return. */
export function staffReasonText(reason: string): string {
  switch (reason) {
    case 'name_required': return 'Type their name.';
    case 'bad_role': return "That role isn't set up yet.";
    case 'bad_email': return "That doesn't look like an email address.";
    case 'own_email': return "That's your own email. Your assistant needs their own.";
    case 'duplicate': return 'That email is already on your list.';
    case 'not_owner': return 'Only the business owner can add an assistant.';
    case 'not_found': return 'That was already removed. Refresh the page.';
    case 'field_not_allowed': return "That field can't be changed from the assistant section.";
    case 'bad_date': return "That date isn't valid.";
    case 'not_an_assistant': return 'Your login is no longer set up as an assistant. Ask Fred.';
    case 'nothing_to_save': return 'Nothing changed.';
    case 'no_matching_assistant': return 'Signed in, but this email is not set up as an assistant yet. Ask Fred to add it.';
    case 'email_not_confirmed': return 'Check your inbox and confirm your email address, then sign in again.';
    case 'turned_off': return 'Your assistant login is turned off. Ask Fred to turn it back on.';
    case 'is_owner': return 'This is a business owner login. Use the main app instead.';
    default: return 'Something went wrong. Try again.';
  }
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

/**
 * The status an assistant sees. Approved and Paid are steps in paying a tech,
 * so to the assistant both are simply "Closed".
 */
export function jobStatusLabel(status: string | null): string {
  switch ((status ?? '').trim()) {
    case 'Open': return 'Open';
    case 'Assigned': return 'Assigned';
    case 'Work Done': return 'Work done';
    case 'Approved':
    case 'Paid': return 'Closed';
    case '': return 'Open';
    default: return status as string;
  }
}

export function isClosedJob(job: Pick<AssistantJob, 'status'>): boolean {
  return jobStatusLabel(job.status) === 'Closed';
}

/** One line for a job's place: site name, then city/state. */
export function jobPlace(job: Pick<AssistantJob, 'site_name' | 'site_address' | 'site_city' | 'site_state'>): string {
  const town = [job.site_city, job.site_state].filter(Boolean).join(', ');
  return [job.site_name || job.site_address, town].filter(Boolean).join(' · ');
}

/** Full street address for a maps link, or '' if there is nothing to map. */
export function jobAddress(job: Pick<AssistantJob, 'site_address' | 'site_city' | 'site_state' | 'site_zip'>): string {
  const cityLine = [job.site_city, [job.site_state, job.site_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [job.site_address, cityLine].filter(Boolean).join(', ');
}

/**
 * Work orders and crew-project sites on one list. The two are paid
 * differently and stay separate records; on screen they are just "work".
 */
export type WorkItem =
  | { kind: 'job'; id: string; date: string | null; title: string; place: string; who: string; status: string; job: AssistantJob }
  | { kind: 'crew'; id: string; date: string | null; title: string; place: string; who: string; status: string; site: AssistantCrewSite };

export function mergeWork(jobs: AssistantJob[], sites: AssistantCrewSite[]): WorkItem[] {
  const items: WorkItem[] = [
    ...jobs.map((job): WorkItem => ({
      kind: 'job', id: job.id,
      date: job.scheduled_date ?? job.start_date ?? null,
      title: [job.wo_number ? `WO ${job.wo_number}` : null, job.title || job.customer_name].filter(Boolean).join(' · ') || 'Work order',
      place: jobPlace(job),
      who: job.techs.length ? job.techs.join(', ') : 'No tech yet',
      status: jobStatusLabel(job.status),
      job,
    })),
    ...sites.map((site): WorkItem => ({
      kind: 'crew', id: site.id,
      date: site.week_start,
      title: `${site.project} · ${site.name}`,
      place: [site.city, site.state].filter(Boolean).join(', '),
      who: [site.lead, site.helper].filter(Boolean).join(' + ') || site.team || 'No team yet',
      status: crewStatusLabel(site.status),
      site,
    })),
  ];
  return items.sort((a, b) => {
    if (a.date === b.date) return a.title.localeCompare(b.title);
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  });
}

export function crewStatusLabel(status: string | null): string {
  switch (status) {
    case 'done': return 'Done';
    case 'in_progress': return 'In progress';
    case 'scheduled': return 'Scheduled';
    case null: case '': return 'Scheduled';
    default: return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }
}

export type WorkBucket = 'past' | 'today' | 'week' | 'later' | 'unscheduled';

/** Monday-based week; `today` is YYYY-MM-DD in the business's time zone. */
export function workBucket(date: string | null, today: string): WorkBucket {
  if (!date) return 'unscheduled';
  const d = date.slice(0, 10);
  if (d < today) return 'past';
  if (d === today) return 'today';
  const t = new Date(`${today}T12:00:00Z`);
  const end = new Date(t);
  end.setUTCDate(t.getUTCDate() + 7);
  return d < end.toISOString().slice(0, 10) ? 'week' : 'later';
}

export const BUCKET_LABEL: Record<WorkBucket, string> = {
  today: 'Today',
  week: 'Next 7 days',
  later: 'Later',
  unscheduled: 'Not scheduled yet',
  past: 'Earlier, still open',
};

/** Open work grouped for the Work tab; closed and finished work drops off. */
export function groupWork(items: WorkItem[], today: string): { bucket: WorkBucket; items: WorkItem[] }[] {
  const order: WorkBucket[] = ['today', 'week', 'later', 'unscheduled', 'past'];
  const open = items.filter((i) => !(i.status === 'Closed' || i.status === 'Done'));
  return order
    .map((bucket) => ({ bucket, items: open.filter((i) => workBucket(i.date, today) === bucket) }))
    .filter((g) => g.items.length > 0);
}

/** Today's date (YYYY-MM-DD) in Eastern time, where the business runs. */
export function todayEastern(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function openTaskCount(tasks: StaffTask[]): number {
  return tasks.filter((t) => t.status === 'open').length;
}

/** Simple, forgiving search across what an assistant would type. */
export function matchesWork(item: WorkItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = item.kind === 'job'
    ? [item.title, item.place, item.who, item.job.customer_name, item.job.site_address, item.job.external_wo_id, item.job.project_name]
    : [item.title, item.place, item.who, item.site.address, item.site.property_id, item.site.client];
  return hay.some((s) => (s ?? '').toLowerCase().includes(q));
}
