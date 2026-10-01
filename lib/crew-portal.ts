// The tech side of crew projects (migrations 087/088). Every call is a
// tech_crew_* RPC: a lead's session cannot read the crew tables directly, and
// the database decides which sites, hours and receipts are theirs.
import { createClient } from '@/lib/supabase/client';
import type { CrewReceiptCategory, CrewReceiptStatus, CrewSiteStatus, CrewEntryStatus } from './crew';

export type TechCrewSite = {
  id: string; name: string; address: string | null; city: string | null; state: string | null;
  zip: string | null; property_id: string | null; survey_date: string | null;
  week_start: string | null; status: CrewSiteStatus; notes: string | null;
  project_name: string; client: string | null; travel_cap: number;
  team_name: string; helper_name: string | null;
  travel_spent: number; hours_logged: number;
};

export type TechCrewEntry = {
  id: string; site_id: string; work_date: string; start_time: string | null; end_time: string | null;
  hours: number; helper_present: boolean; note: string | null; status: CrewEntryStatus;
};

export type TechCrewReceipt = {
  id: string; site_id: string; receipt_date: string; category: CrewReceiptCategory;
  vendor: string | null; amount: number; file_path: string | null; note: string | null;
  status: CrewReceiptStatus;
};

export type TechCrewBoard = {
  id: string; name: string; client: string | null;
  start_date: string | null; weeks: number; skip_weeks: string[];
  my_team_ids: string[];
  teams: { id: string; name: string; lead_name: string | null; lead_id: string | null }[];
  sites: { id: string; name: string; address: string | null; city: string | null; state: string | null;
           zip: string | null; property_id: string | null; survey_date: string | null;
           team_id: string | null; week_start: string | null; status: CrewSiteStatus }[];
};

export type TechCrewMessage = {
  id: string; content: string; created_at: string;
  from_id: string | null; from_name: string; to_id: string | null; to_name: string | null;
  to_office: boolean; mine: boolean;
};

export type CrewResult = { ok: boolean; reason: string };

async function rpcList<T>(fn: string, args?: Record<string, unknown>): Promise<T[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data as T[] | null) ?? [];
}

async function rpcResult(fn: string, args: Record<string, unknown>): Promise<CrewResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, reason: error.message };
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  return { ok: !!r.ok, reason: r.reason ?? 'unknown' };
}

export const fetchCrewSites = () => rpcList<TechCrewSite>('tech_crew_sites');
export const fetchCrewTime = () => rpcList<TechCrewEntry>('tech_crew_time');
export const fetchCrewReceipts = () => rpcList<TechCrewReceipt>('tech_crew_receipts');
export const fetchCrewBoard = () => rpcList<TechCrewBoard>('tech_crew_board');
export const fetchCrewMessages = (projectId: string) =>
  rpcList<TechCrewMessage>('tech_crew_messages', { p_project: projectId });

export const logCrewTime = (a: {
  siteId: string; date: string; start: string | null; end: string | null;
  hours: number; helper: boolean; note: string;
}) => rpcResult('tech_crew_log_time', {
  p_site: a.siteId, p_date: a.date, p_start: a.start || null, p_end: a.end || null,
  p_hours: a.hours, p_helper: a.helper, p_note: a.note,
});

export const deleteCrewTime = (id: string) => rpcResult('tech_crew_delete_time', { p_id: id });
export const claimCrewSite = (siteId: string, week: string) =>
  rpcResult('tech_crew_claim_site', { p_site: siteId, p_week: week });
export const releaseCrewSite = (siteId: string) => rpcResult('tech_crew_release_site', { p_site: siteId });
export const sendCrewMessage = (projectId: string, to: string | null, content: string) =>
  rpcResult('tech_crew_send', { p_project: projectId, p_to: to, p_content: content });

/** The caller's contractor id: the folder their receipt photos must go in. */
async function myFolder(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.rpc('crew_tech_folder');
  return (data as string | null) ?? null;
}

/**
 * Upload the photo (if any) to the private crew-receipts bucket, then record
 * the receipt. If recording fails, the orphaned photo is removed so a retry
 * does not leave junk behind.
 */
export async function addCrewReceipt(a: {
  siteId: string; date: string; category: CrewReceiptCategory; vendor: string;
  amount: number; note: string; file: File | null;
}): Promise<CrewResult> {
  const supabase = createClient();
  let path: string | null = null;
  if (a.file) {
    const folder = await myFolder();
    if (!folder) return { ok: false, reason: 'not_a_tech' };
    const ext = (a.file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    path = `${folder}/${a.siteId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('crew-receipts').upload(path, a.file, {
      contentType: a.file.type || undefined, upsert: false,
    });
    if (error) return { ok: false, reason: `Upload failed: ${error.message}` };
  }
  const r = await rpcResult('tech_crew_add_receipt', {
    p_site: a.siteId, p_date: a.date, p_category: a.category, p_vendor: a.vendor,
    p_amount: a.amount, p_path: path, p_note: a.note,
  });
  if (!r.ok && path) await supabase.storage.from('crew-receipts').remove([path]);
  return r;
}

export async function deleteCrewReceipt(id: string): Promise<CrewResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tech_crew_delete_receipt', { p_id: id });
  if (error) return { ok: false, reason: error.message };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; file_path?: string | null };
  if (r.ok && r.file_path) await supabase.storage.from('crew-receipts').remove([r.file_path]);
  return { ok: !!r.ok, reason: r.reason ?? 'unknown' };
}

/** A short-lived link to view a receipt photo. */
export async function receiptUrl(path: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.storage.from('crew-receipts').createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}
