// The tech's notification bell (Fred, 2026-10-18: FAJ techs get the Field
// Service tech screens; Field Service has a bell with unread counts and a
// priority on each notification). Built from what the tech app already
// notices while it is open: changes to their jobs (lib/tech-live.ts) and new
// messages. Kept on the phone per login, newest first, so it needs no new
// table and works with no signal.
//
// Pure and unit-tested (lib/tech-inbox.test.ts).

import type { JobChange, JobChangeKind } from './tech-live';
import type { KeyValue } from './wf-outbox';

export type NotePriority = 'high' | 'medium' | 'low';
export type TechNote = {
  id: string;
  at: string;
  text: string;
  priority: NotePriority;
  /** The job it is about, to open it; none for messages. */
  number?: string;
  kind: JobChangeKind | 'message';
  read: boolean;
};

/** Losing a job or its date needs the tech now; a closed job can wait. */
const PRIORITY: Record<JobChangeKind | 'message', NotePriority> = {
  removed: 'high', date: 'high', time: 'high', address: 'high',
  new: 'medium', scope: 'medium', access: 'medium', docs: 'medium', message: 'medium',
  closed: 'low',
};

export const MAX_NOTES = 60;

export function notesFromChanges(changes: JobChange[], at: string): TechNote[] {
  return changes.map((c, i) => ({
    id: `${at}|${c.number}|${c.kind}|${i}`, at, text: c.text, number: c.number, kind: c.kind,
    priority: PRIORITY[c.kind], read: false,
  }));
}

export function messageNote(count: number, at: string): TechNote {
  return {
    id: `${at}|message`, at, kind: 'message', priority: PRIORITY.message, read: false,
    text: count === 1 ? 'New message' : `${count} new messages`,
  };
}

/** New notes on top; the same note never twice; only the newest MAX_NOTES kept. */
export function addNotes(list: TechNote[], add: TechNote[]): TechNote[] {
  const seen = new Set(list.map((n) => n.id));
  const fresh = add.filter((n) => !seen.has(n.id));
  return [...fresh, ...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_NOTES);
}

/** Mark these notes read, or all of them. */
export function markRead(list: TechNote[], ids?: string[]): TechNote[] {
  const pick = ids ? new Set(ids) : null;
  return list.map((n) => (!n.read && (!pick || pick.has(n.id)) ? { ...n, read: true } : n));
}

export const unreadNotes = (list: TechNote[]) => list.filter((n) => !n.read);

const KEY = (uid: string) => `faj-tech-notes:${uid}`;
const PRIORITIES: NotePriority[] = ['high', 'medium', 'low'];

export function loadNotes(kv: KeyValue | null, uid: string): TechNote[] {
  if (!kv || !uid) return [];
  try {
    const raw = JSON.parse(kv.getItem(KEY(uid)) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((n): n is TechNote => !!n && typeof n === 'object'
      && typeof (n as TechNote).id === 'string' && typeof (n as TechNote).text === 'string'
      && typeof (n as TechNote).at === 'string' && PRIORITIES.includes((n as TechNote).priority))
      .slice(0, MAX_NOTES);
  } catch {
    return [];
  }
}

export function saveNotes(kv: KeyValue | null, uid: string, list: TechNote[]): void {
  if (!kv || !uid) return;
  try { kv.setItem(KEY(uid), JSON.stringify(list.slice(0, MAX_NOTES))); } catch { /* storage full: the bell still works this visit */ }
}

/** Forget the bell on sign-out, like the saved copies (a phone can be shared). */
export function clearNotes(kv: KeyValue | null, uid: string): void {
  try { kv?.removeItem(KEY(uid)); } catch { /* nothing to clear */ }
}
