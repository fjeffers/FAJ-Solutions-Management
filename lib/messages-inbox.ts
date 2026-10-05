// The owner's Messages screen (Fred, 2026-10-05: "add message under
// scheduled"): every conversation with techs in one place, newest first.
//
// Job threads live in work_order_messages, one thread per work order (keyed by
// its number, like everything else that links to a job). A tech's message is
// unread for the office until read_at is set; the office's own messages are
// unread for the tech the same way (tech_unread_count, migration 071).
//
// Techs messaging each other (contractor_messages, migration 075) are shown
// read-only: Fred isn't part of those conversations, and opening one must not
// mark it read for the tech it was sent to.

export type InboxMessage = {
  id: string;
  work_order_id: string;
  sender_name: string;
  sender_role: string;
  content: string;
  read_at: string | null;
  created_at: string;
};

export type InboxJob = { id: string; wo_number: string; title: string | null; techs: string[]; archived: boolean };

export type JobThread = {
  woNumber: string;
  job: InboxJob | null;
  last: InboxMessage;
  /** Messages from techs the office hasn't read. */
  unread: number;
  count: number;
};

export const fromTech = (m: Pick<InboxMessage, 'sender_role'>) => m.sender_role === 'contractor';

/** One thread per job, the most recent conversation first. */
export function buildJobThreads(messages: InboxMessage[], jobs: InboxJob[]): JobThread[] {
  const byNumber = new Map(jobs.map((j) => [j.wo_number, j]));
  const threads = new Map<string, JobThread>();
  for (const m of messages) {
    const t = threads.get(m.work_order_id);
    if (!t) {
      threads.set(m.work_order_id, {
        woNumber: m.work_order_id, job: byNumber.get(m.work_order_id) ?? null, last: m,
        unread: fromTech(m) && !m.read_at ? 1 : 0, count: 1,
      });
      continue;
    }
    t.count += 1;
    if (fromTech(m) && !m.read_at) t.unread += 1;
    if (m.created_at > t.last.created_at) t.last = m;
  }
  return [...threads.values()].sort((a, b) => (a.last.created_at < b.last.created_at ? 1 : -1));
}

/** Tech messages the office hasn't read, across every job. */
export function unreadFromTechs(messages: InboxMessage[]): number {
  return messages.filter((m) => fromTech(m) && !m.read_at).length;
}

export type TechDm = { id: string; from_id: string; to_id: string; content: string; created_at: string };
export type DmThread = { key: string; names: [string, string]; last: TechDm; messages: TechDm[] };

/** One thread per pair of techs, whoever wrote first; most recent first. */
export function buildDmThreads(dms: TechDm[], nameOf: (id: string) => string): DmThread[] {
  const threads = new Map<string, DmThread>();
  for (const m of [...dms].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    const pair = [m.from_id, m.to_id].sort() as [string, string];
    const key = pair.join(':');
    const t = threads.get(key);
    if (t) { t.messages.push(m); t.last = m; continue; }
    const names = pair.map(nameOf).sort((a, b) => a.localeCompare(b)) as [string, string];
    threads.set(key, { key, names, last: m, messages: [m] });
  }
  return [...threads.values()].sort((a, b) => (a.last.created_at < b.last.created_at ? 1 : -1));
}

/** "Just now", "12 min", "3 h", "Yesterday", or a date. */
export function whenShort(iso: string, now = new Date()): string {
  const t = new Date(iso);
  const mins = Math.floor((now.getTime() - t.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min`;
  const sameDay = t.toDateString() === now.toDateString();
  if (sameDay) return `${Math.floor(mins / 60)} h`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (t.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
