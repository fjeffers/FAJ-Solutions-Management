// Server side of the live project sheet (migration 120): the project's link,
// and everything on the sheet read with the service key. Only the columns the
// sheet shows are selected — no price, no tech pay, no contacts — and the page
// hands the browser the finished lines, never these rows.
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSheet, parseSheetMessages, type Sheet, type SheetInput, type SheetMessage } from './project-sheet';
import { parseCloseoutLists } from './closeout';
import { fillPlaces } from './places';

type Raw = Record<string, unknown>;

/** The project's sheet link token, made the first time it's needed. */
export async function sheetTokenFor(admin: SupabaseClient, userId: string, project: string): Promise<string | null> {
  if (!project.trim()) return null;
  await admin.from('project_sheets').upsert({ user_id: userId, project_name: project }, { onConflict: 'user_id,project_name', ignoreDuplicates: true });
  const { data } = await admin.from('project_sheets').select('token').eq('user_id', userId).eq('project_name', project).maybeSingle();
  return (data as { token?: string } | null)?.token ?? null;
}

/** A link token looks like this; anything else is turned away before the database. */
export const isSheetToken = (t: string): boolean => /^[0-9a-f]{64}$/.test(t);

export async function projectForToken(admin: SupabaseClient, token: string): Promise<{ userId: string; project: string } | null> {
  if (!isSheetToken(token)) return null;
  const { data } = await admin.from('project_sheets').select('user_id, project_name').eq('token', token).maybeSingle();
  const r = data as { user_id?: string; project_name?: string } | null;
  return r?.user_id && r.project_name ? { userId: r.user_id, project: r.project_name } : null;
}

/** The project's job ids (for checking a receipt belongs to it). */
export async function projectJobIds(admin: SupabaseClient, userId: string, project: string): Promise<string[]> {
  const { data } = await admin.from('work_orders').select('id').eq('user_id', userId).eq('project_name', project).eq('is_project', true);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * Everything on one project's sheet. `lookups` is how many missing street
 * addresses to look up now (each takes about a second).
 */
export async function loadSheet(admin: SupabaseClient, userId: string, project: string, lookups = 2): Promise<Sheet> {
  const { data: jobs } = await admin.from('work_orders')
    .select('id, wo_number, external_wo_id, title, description, site_name, site_address, site_city, site_state, site_zip, closeout_notes, custom_qa, closeout, wo_status, lead_contractor_name, contractor_name, contractor_names')
    .eq('user_id', userId).eq('project_name', project).eq('is_project', true);
  const list = (jobs ?? []) as SheetInput['jobs'];
  const ids = list.map((j) => j.id);
  if (ids.length === 0) return buildSheet({ project, jobs: [], taps: [], photos: [], expenses: [], lists: [] });

  const [events, punches, photos, expenses, lists] = await Promise.all([
    admin.from('job_day_events').select('id, wo_id, contractor_name, kind, at, origin, dest, miles, place, lat, lng').in('wo_id', ids).order('at'),
    admin.from('job_punches').select('wo_id, contractor_name, kind, at').in('wo_id', ids).order('at'),
    admin.from('wo_photos').select('id, wo_id, contractor_name, url, taken_at, label').in('wo_id', ids).order('taken_at', { ascending: false }).limit(1000),
    admin.from('job_expenses')
      .select('id, wo_id, contractor_name, category, vendor, amount, expense_date, note, receipt_path, created_at, paid_by, status')
      .in('wo_id', ids).neq('status', 'declined'),
    admin.from('closeout_lists').select('id, name, keywords, items, sort').eq('user_id', userId),
  ]);
  const { data: lates } = await admin.from('project_late').select('wo_id, tech, due_at, start_label').in('wo_id', ids);
  const dayRows = (events.data ?? []) as Raw[];
  if (lookups > 0) await fillPlaces(admin as never, dayRows, lookups);
  return buildSheet({
    project, jobs: list,
    taps: [...dayRows, ...((punches.data ?? []) as Raw[])],
    photos: (photos.data ?? []) as SheetInput['photos'],
    expenses: (expenses.data ?? []) as SheetInput['expenses'],
    lists: parseCloseoutLists(lists.data),
    lates: (lates ?? []) as NonNullable<SheetInput['lates']>,
  });
}

/**
 * The project's messages meant for the sheet (migration 121). Never the
 * private tech <-> FAJ ones: on_sheet is the gate.
 */
export async function loadSheetMessages(admin: SupabaseClient, userId: string, project: string): Promise<SheetMessage[]> {
  const { data: jobs } = await admin.from('work_orders').select('wo_number').eq('user_id', userId).eq('project_name', project).eq('is_project', true);
  const numbers = ((jobs ?? []) as { wo_number: string }[]).map((j) => j.wo_number).filter(Boolean);
  if (numbers.length === 0) return [];
  const { data } = await admin.from('work_order_messages')
    .select('id, work_order_id, created_at, sender_name, sender_role, kind, to_name, content, reason, row_ref, parent_id, resolved_at')
    .eq('user_id', userId).eq('on_sheet', true).in('work_order_id', numbers)
    .order('created_at', { ascending: false }).limit(500);
  return parseSheetMessages(data);
}
