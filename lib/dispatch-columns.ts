// The Dispatch board's columns (Fred, 2026-10-06, about SimplySub's job board:
// "add some of these features to the app").
//
// Columns, left to right:
//   the stage columns (Needs a tech … Work done), with Today after Scheduled —
//     jobs dated today that haven't started, like SimplySub's "Today's
//     Dispatches";
//   Fred's own holding columns (Settings -> Lists & stages -> Extra board
//     columns; standard: Revisit needed … On hold) — a job parked there
//     waits on something, whatever its stage (work_orders.board_stage,
//     migration 113);
//   Closed. A job every tech declined goes back to Needs a tech (Fred,
//     2026-10-18: "it should have gone back to Need a tech"), so there is no
//     Declined column any more.
//
// Moving a card (drag on a computer, "Move to" on a phone) only ever changes
// the board column or the job's office stage, never money. Moves that need
// more than that (closing, reopening, giving a job a tech) say so instead.
//
// Pure and unit-tested; components/wf/PrimioScreens.tsx draws it.
import type { WfJob, WfStatus } from './wf';

export type ColumnKind = 'stage' | 'today' | 'hold';
export type BoardColumn = { key: string; label: string; kind: ColumnKind; stage?: WfStatus; color: string };

export const TODAY_KEY = 'today';
export const holdKey = (k: string) => `hold:${k}`;

const HOLD_COLOR = '#8a6d2b';
const TODAY_COLOR = '#C9A24B';

/**
 * Every column in order. `stages` gives each stage's name and colour; `holds`
 * are Fred's own columns (hidden ones left out).
 */
export function boardColumns(
  stages: { key: WfStatus; label: string; color: string }[],
  holds: { key: string; label: string }[],
): BoardColumn[] {
  const out: BoardColumn[] = [];
  for (const s of stages) {
    if (s.key === 'declined') continue;
    if (s.key === 'closed') for (const h of holds) out.push({ key: holdKey(h.key), label: h.label, kind: 'hold', color: HOLD_COLOR });
    out.push({ key: s.key, label: s.label, kind: 'stage', stage: s.key, color: s.color });
    if (s.key === 'scheduled') out.push({ key: TODAY_KEY, label: 'Today', kind: 'today', color: TODAY_COLOR });
  }
  // No Closed column given: Fred's columns go last.
  if (!stages.some((s) => s.key === 'closed')) for (const h of holds) out.push({ key: holdKey(h.key), label: h.label, kind: 'hold', color: HOLD_COLOR });
  return out;
}

/** Jobs dated today that haven't started go in Today. */
const waitingToStart = (s: WfStatus) => s === 'offered' || s === 'scheduled';

/** The column a job sits in. A hold whose column Fred has since removed is ignored. */
export function columnOf(job: Pick<WfJob, 'status' | 'date'> & { hold?: string | null }, today: string, holdKeys: Set<string>): string {
  if (job.status === 'closed') return job.status;
  if (job.status === 'declined') return 'open';
  if (job.hold && holdKeys.has(job.hold)) return holdKey(job.hold);
  if (job.date === today && waitingToStart(job.status)) return TODAY_KEY;
  return job.status;
}

export type Move =
  | { kind: 'none' }
  | { kind: 'patch'; patch: { board_stage?: string | null; wo_status?: string }; note: string }
  | { kind: 'close' }
  | { kind: 'blocked'; reason: string };

type MovingJob = Pick<WfJob, 'status' | 'date' | 'techs' | 'officeStatus' | 'number'> & { hold?: string | null };

/** What moving a job into a column does. */
export function moveTo(job: MovingJob, target: BoardColumn, today: string, holdKeys: Set<string>): Move {
  if (columnOf(job, today, holdKeys) === target.key) return { kind: 'none' };
  if (job.status === 'closed') return { kind: 'blocked', reason: `WO ${job.number} is closed. Open it and use Restore to bring it back.` };
  if (job.status === 'declined') return { kind: 'blocked', reason: `WO ${job.number} was declined. Open it and pick a new tech.` };
  if (target.stage === 'declined') return { kind: 'blocked', reason: 'Declined is set by the tech’s answer, not moved by hand.' };

  if (target.kind === 'hold') {
    return { kind: 'patch', patch: { board_stage: target.key.slice('hold:'.length) }, note: `WO ${job.number} moved to ${target.label}.` };
  }
  if (target.stage === 'closed') return { kind: 'close' };

  const hasTechs = job.techs.length > 0;
  const started = job.officeStatus === 'In Progress' || job.officeStatus === 'Work Done';
  if (target.stage === 'inProgress' || target.stage === 'workDone') {
    if (!hasTechs) return { kind: 'blocked', reason: `WO ${job.number} has no tech yet. Give it a tech first.` };
    const wo_status = target.stage === 'inProgress' ? 'In Progress' : 'Work Done';
    return { kind: 'patch', patch: { board_stage: null, wo_status }, note: `WO ${job.number} is now ${target.label}.` };
  }
  if (target.kind === 'today' && job.date !== today) {
    return { kind: 'blocked', reason: `WO ${job.number} isn't dated today. Change its date to put it in Today.` };
  }
  // Needs a tech, Awaiting response, Scheduled, Today: off any hold, and back
  // before "started" if it had been. Who's on the job and their answers
  // decide which of those it lands in.
  const patch: { board_stage: null; wo_status?: string } = { board_stage: null };
  if (started) patch.wo_status = hasTechs ? 'Assigned' : 'Open';
  const landsElsewhere = (target.stage === 'open' && hasTechs) || ((target.stage === 'offered' || target.stage === 'scheduled') && !hasTechs);
  const note = landsElsewhere
    ? `WO ${job.number} is back on the board — who's on it decides the column (${hasTechs ? 'it has a tech' : 'it has no tech yet'}).`
    : `WO ${job.number} moved to ${target.label}.`;
  return { kind: 'patch', patch, note };
}
