// The tech portal's WorkFlow data (Fred, 2026-10-02: "all one app with a tech
// portal"). A tech reads their jobs through wf_tech_jobs() — their own work,
// offers waiting on them, and the last 45 days of finished jobs, with no money
// of any kind (migration-096). Taps go through the outbox (lib/wf-outbox.ts) so
// they still count with no signal.
import { createClient } from '@/lib/supabase/client';
import {
  wfJobFromTech, clockedIn, clockedOut, withTask, answered, markedWorkDone, wfReasonText,
  type WfJob,
} from './wf';
import { RefusedError, isNoSignal, type Outbox, type PendingAction } from './wf-outbox';
import type { TechJob } from './types';

export async function fetchWfTechJobs(): Promise<WfJob[]> {
  const { data, error } = await createClient().rpc('wf_tech_jobs');
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as Record<string, unknown>[]).map(wfJobFromTech) : [];
}

/** Call a server function; turn "no" into a RefusedError and no signal into a plain error. */
async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) {
    if (isNoSignal(error)) throw new Error(error.message);
    throw new RefusedError("The office couldn't save that.");
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (r.ok === false) throw new RefusedError(wfReasonText(r.reason ?? ''));
}

/** What each kind of tap sends. Registered on the signed-in tech's outbox. */
export function registerTechHandlers(box: Outbox): void {
  // Clock taps carry where the tech was (migration-100). A tap queued before
  // GPS existed simply has no position, which the server stores as none.
  box.register('clock', async (a, at) => {
    await call('wf_tech_clock_gps', {
      p_wo_number: a.number, p_action: a.action, p_at: at.toISOString(),
      p_lat: a.lat ?? null, p_lng: a.lng ?? null, p_accuracy: a.acc ?? null,
    });
  });
  box.register('task', async (a) => {
    await call('wf_set_task', { p_wo_number: a.number, p_task_id: a.task, p_done: a.done });
  });
  box.register('respond', async (a) => {
    await call('tech_respond_to_job', { p_wo_number: a.number, p_response: a.accept ? 'accepted' : 'declined' });
  });
  // Work done: the notes, then the clock stops at the moment they tapped, then
  // the job goes back to the office. Each step is safe to repeat if a retry
  // lands after a dropped answer.
  box.register('workdone', async (a, at) => {
    const notes = String(a.notes ?? '').trim();
    if (notes) await call('tech_save_closeout', { p_wo_number: a.number, p_summary: notes });
    if (a.clockOut) {
      await call('wf_tech_clock_gps', {
        p_wo_number: a.number, p_action: 'out', p_at: at.toISOString(),
        p_lat: a.lat ?? null, p_lng: a.lng ?? null, p_accuracy: a.acc ?? null,
      });
    }
    await call('tech_set_job_status', { p_wo_number: a.number, p_status: 'Work Done' });
  });
  box.probe = async () => {
    const { error } = await createClient().rpc('wf_role');
    if (error) throw new Error(error.message);
  };
}

/**
 * The office's copy of the jobs, with the taps still waiting on this phone laid
 * on top — so a tick made with no signal does not vanish when the list reloads.
 */
export function applyPending(jobs: WfJob[], pending: PendingAction[]): WfJob[] {
  let list = jobs;
  for (const p of pending) {
    const number = String(p.args.number ?? '');
    const at = new Date(p.at);
    list = list.map((j) => {
      if (j.number !== number) return j;
      switch (p.kind) {
        case 'clock': return p.args.action === 'in' ? clockedIn(j, at) : clockedOut(j, at);
        case 'task': return withTask(j, String(p.args.task), !!p.args.done);
        case 'respond': return answered(j, !!p.args.accept);
        case 'workdone': return markedWorkDone(j, String(p.args.notes ?? ''), at);
        default: return j;
      }
    });
  }
  return list;
}

/** The job chat wants the older job shape; it only reads these fields. */
export function toChatJob(j: WfJob): TechJob {
  return {
    id: j.id, wo_number: j.number, title: j.title, customer_name: j.client,
    site_name: j.siteName, site_city: j.city, site_state: j.state,
  } as TechJob;
}
