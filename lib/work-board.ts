// The Work Orders board: every live job in a column by stage, with crew-project
// sites on the same board. Work orders and crew sites stay separate records —
// they are paid differently — and only meet here, on screen.
//
// Pure and unit-tested; components/WorkBoard.tsx draws it.
import type { WorkOrderStatus, WoTask } from './types';

export type ColumnKey = 'open' | 'assigned' | 'progress' | 'done' | 'closed';

export const BOARD_COLUMNS: { key: ColumnKey; label: string; hint: string; accent: string }[] = [
  { key: 'open',     label: 'Needs a tech',    hint: 'Open, nobody on it yet',       accent: '#0D7377' },
  { key: 'assigned', label: 'Assigned',        hint: 'A tech or team has it',         accent: '#f59e0b' },
  { key: 'progress', label: 'In progress',     hint: 'Being worked on now',           accent: '#f97316' },
  { key: 'done',     label: 'Work done',       hint: 'Finished: check, close, bill',  accent: '#6366f1' },
  { key: 'closed',   label: 'Approved & paid', hint: 'Signed off or tech paid',       accent: '#059669' },
];

/**
 * The column a work order sits in. Before the work starts, who is on the job
 * decides it, not the status word: many jobs were given techs while their
 * status stayed "Open" (seen live 2026-10-02: WO 19101293, two techs, filed
 * under "Needs a tech"). An "Assigned" job with nobody on it needs a tech.
 */
export function woColumn(status: WorkOrderStatus | string | null | undefined, hasTechs = true): ColumnKey {
  switch (status) {
    case 'In Progress': return 'progress';
    case 'Work Done': return 'done';
    case 'Approved':
    case 'Paid': return 'closed';
    default: return hasTechs ? 'assigned' : 'open';
  }
}

/** True when a work order has at least one tech named on it. */
export function hasTech(w: { contractor_names?: string[] | null; contractor_name?: string | null }): boolean {
  return (w.contractor_names ?? []).some((n) => (n ?? '').trim() !== '') || (w.contractor_name ?? '').trim() !== '';
}

/** The column a crew-project site sits in (crew statuses, migration-087). */
export function crewColumn(status: string | null | undefined): ColumnKey {
  switch (status) {
    case 'scheduled': return 'assigned';
    case 'in_progress': return 'progress';
    case 'done':
    case 'deliverables_in': return 'done';
    case 'audited': return 'closed';
    default: return 'open'; // 'planned' and anything unknown
  }
}

export function taskProgress(tasks: WoTask[] | null | undefined): { done: number; total: number } {
  const list = tasks ?? [];
  return { done: list.filter((t) => t.completed).length, total: list.length };
}

/** YYYY-MM-DD plus n days, in plain calendar terms. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week a date falls in (crew sites are scheduled by week). */
export function mondayOfWeek(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(ymd, -back);
}

/**
 * The numbers across the top of the board.
 *   needsTech     work orders and crew sites with nobody on them
 *   thisWeek      jobs dated today through 6 days out, plus crew sites whose
 *                 cabling week is this week
 *   readyToClose  work orders marked Work Done (the next thing Fred presses)
 */
export function boardCounts(
  wos: { wo_status: string | null; scheduled_date: string | null; contractor_names?: string[] | null; contractor_name?: string | null; pay_set?: boolean }[],
  sites: { status: string | null; week_start: string | null }[],
  today: string,
) {
  const end = addDays(today, 6);
  const monday = mondayOfWeek(today);
  return {
    needsTech: wos.filter((w) => woColumn(w.wo_status, hasTech(w)) === 'open').length
      + sites.filter((s) => crewColumn(s.status) === 'open').length,
    thisWeek: wos.filter((w) => w.scheduled_date && w.scheduled_date.slice(0, 10) >= today && w.scheduled_date.slice(0, 10) <= end).length
      + sites.filter((s) => s.week_start === monday).length,
    readyToClose: wos.filter((w) => woColumn(w.wo_status, hasTech(w)) === 'done').length,
    /** Jobs with a tech but no pay recorded and not yet paid: what they are owed is unknown. */
    paySetMissing: wos.filter((w) => w.pay_set === false && hasTech(w) && w.wo_status !== 'Paid').length,
  };
}
