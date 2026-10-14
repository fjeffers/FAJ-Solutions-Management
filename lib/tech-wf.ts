// The tech portal's WorkFlow data (Fred, 2026-10-02: "all one app with a tech
// portal"). A tech reads their jobs through wf_tech_jobs() — their own work,
// offers waiting on them, and the last 45 days of finished jobs, with no money
// of any kind (migration-096). Taps go through the outbox (lib/wf-outbox.ts) so
// they still count with no signal.
import { createClient } from '@/lib/supabase/client';
import {
  wfJobFromTech, clockedIn, clockedOut, withTask, answered, markedWorkDone, withReport, withCloseout, withTimeRequest,
  withDayEvent, wfReasonText, type WfJob,
} from './wf';
import type { DayEvent, DayKind, Dest, Origin } from './project-day';
import { closeoutOpFrom, parseCloseoutLists, type CloseoutList } from './closeout';
import { RefusedError, isNoSignal, type Outbox, type PendingAction } from './wf-outbox';
import type { TechJob } from './types';

export async function fetchWfTechJobs(): Promise<WfJob[]> {
  const { data, error } = await createClient().rpc('wf_tech_jobs');
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as Record<string, unknown>[]).map(wfJobFromTech) : [];
}

/** The office's closeout checklists (migration-106). Empty when none or unreachable. */
export async function fetchCloseoutLists(): Promise<CloseoutList[]> {
  const { data, error } = await createClient().rpc('wf_tech_closeout_lists');
  if (error) throw new Error(error.message);
  return parseCloseoutLists(data);
}

/** Call a server function; turn "no" into a RefusedError and no signal into a plain error. */
async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) {
    if (isNoSignal(error)) throw new Error(error.message);
    throw new RefusedError("That couldn't be saved. Try again.");
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
  // The project day: travel and lunch taps (migration 117). Start job and Off
  // site go through 'clock' like any job.
  box.register('day', async (a, at) => {
    await call('wf_tech_day_event', {
      p_wo_number: a.number, p_kind: a.kind, p_at: at.toISOString(),
      p_lat: a.lat ?? null, p_lng: a.lng ?? null, p_accuracy: a.acc ?? null,
      p_origin: a.origin ?? null, p_dest: a.dest ?? null,
    });
  });
  // The job report: notes for the office and answers to its questions.
  box.register('report', async (a) => {
    await call('wf_tech_save_report', {
      p_wo_number: a.number,
      p_notes: typeof a.notes === 'string' ? a.notes : null,
      p_answers: a.answers && typeof a.answers === 'object' ? a.answers : null,
    });
  });
  // A message for the live project sheet (migration 121/122): the end-of-day
  // report and "stepped off site" wait on the phone with no signal.
  box.register('sitemsg', async (a) => {
    await call('wf_tech_site_send', {
      p_wo_number: a.number, p_body: typeof a.body === 'string' ? a.body : '', p_to: a.to ?? null,
      p_kind: a.kind ?? 'message', p_reason: a.reason ?? null, p_parent: null,
    });
  });
  box.register('task', async (a) => {
    await call('wf_set_task', { p_wo_number: a.number, p_task_id: a.task, p_done: a.done });
  });
  // Closeout: one change at a time, applied on the server (migration-105), so
  // two techs on one job never wipe each other's ticks. The tap time signs.
  box.register('closeout', async (a, at) => {
    await call('wf_tech_closeout', {
      p_wo_number: a.number, p_op: a.op,
      p_args: a.args && typeof a.args === 'object' ? a.args : {}, p_at: at.toISOString(),
    });
  });
  // Ask for another date and time on an offer (no date: take the ask back).
  box.register('timeRequest', async (a) => {
    await call('wf_tech_request_time', {
      p_wo_number: a.number, p_date: a.date || null, p_time: a.time || null, p_note: a.note || null,
    });
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
        case 'clock': {
          const k = p.args.action === 'in' ? clockedIn(j, at) : clockedOut(j, at);
          return j.isProject ? withDayEvent(k, { kind: p.args.action === 'in' ? 'in' : 'out', at: p.at }) : k;
        }
        case 'day': {
          const ev: DayEvent = { kind: String(p.args.kind) as DayKind, at: p.at };
          if (p.args.origin) ev.origin = String(p.args.origin) as Origin;
          if (p.args.dest) ev.dest = String(p.args.dest) as Dest;
          return withDayEvent(j, ev);
        }
        case 'workdone': {
          const done = markedWorkDone(j, String(p.args.notes ?? ''), at);
          return j.isProject && p.args.clockOut ? withDayEvent(done, { kind: 'out', at: p.at }) : done;
        }
        case 'task': return withTask(j, String(p.args.task), !!p.args.done);
        case 'respond': return answered(j, !!p.args.accept);
        case 'report': return withReport(j, typeof p.args.notes === 'string' ? p.args.notes : null,
          (p.args.answers && typeof p.args.answers === 'object' ? p.args.answers : {}) as Record<string, string>);
        case 'closeout': {
          const op = closeoutOpFrom(String(p.args.op ?? ''), (p.args.args ?? {}) as Record<string, unknown>, p.at);
          return op ? withCloseout(j, op) : j;
        }
        case 'timeRequest': return withTimeRequest(j, p.args.date
          ? { date: String(p.args.date), time: String(p.args.time ?? ''), note: String(p.args.note ?? ''), at: p.at, state: 'waiting' }
          : null);
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
