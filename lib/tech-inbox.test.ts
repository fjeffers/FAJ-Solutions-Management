import { describe, it, expect } from 'vitest';
import { addNotes, loadNotes, markRead, messageNote, notesFromChanges, saveNotes, unreadNotes, MAX_NOTES, type TechNote } from './tech-inbox';
import type { KeyValue } from './wf-outbox';

function memory(): KeyValue {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

describe("the tech's bell", () => {
  it('ranks job changes: losing a job or its date is high, a closed job low', () => {
    const notes = notesFromChanges([
      { number: '1', kind: 'removed', text: 'WO 1 is no longer on your list' },
      { number: '2', kind: 'time', text: 'WO 2: new time 9:00 AM' },
      { number: '3', kind: 'new', text: 'New job: WO 3' },
      { number: '4', kind: 'closed', text: 'WO 4 was closed' },
    ], '2026-10-18T12:00:00Z');
    expect(notes.map((n) => [n.number, n.priority, n.read])).toEqual([
      ['1', 'high', false], ['2', 'high', false], ['3', 'medium', false], ['4', 'low', false],
    ]);
    expect(messageNote(3, '2026-10-18T12:00:00Z')).toMatchObject({ text: '3 new messages', priority: 'medium', kind: 'message' });
    expect(messageNote(1, '2026-10-18T12:00:00Z').text).toBe('New message');
  });

  it('keeps the newest first, never the same note twice, and at most 60', () => {
    const a = notesFromChanges([{ number: '1', kind: 'new', text: 'New job: WO 1' }], '2026-10-18T10:00:00Z');
    const b = notesFromChanges([{ number: '2', kind: 'docs', text: 'WO 2: a new document was added' }], '2026-10-18T11:00:00Z');
    let list = addNotes(addNotes([], a), b);
    list = addNotes(list, a);
    expect(list.map((n) => n.number)).toEqual(['2', '1']);
    const many: TechNote[] = Array.from({ length: 70 }, (_, i) => messageNote(1, new Date(Date.UTC(2026, 9, 18, 0, i)).toISOString()));
    expect(addNotes(list, many)).toHaveLength(MAX_NOTES);
  });

  it('marks one or all read, and counts the unread', () => {
    const list = addNotes([], notesFromChanges([
      { number: '1', kind: 'new', text: 'a' }, { number: '2', kind: 'new', text: 'b' },
    ], '2026-10-18T10:00:00Z'));
    const one = markRead(list, [list[0].id]);
    expect(unreadNotes(one)).toHaveLength(1);
    expect(unreadNotes(markRead(one))).toHaveLength(0);
  });

  it('is kept on the phone per login and ignores anything broken', () => {
    const kv = memory();
    const list = addNotes([], notesFromChanges([{ number: '1', kind: 'new', text: 'New job: WO 1' }], '2026-10-18T10:00:00Z'));
    saveNotes(kv, 'u1', list);
    expect(loadNotes(kv, 'u1')).toEqual(list);
    expect(loadNotes(kv, 'u2')).toEqual([]);
    kv.setItem('faj-tech-notes:u3', '{not json');
    expect(loadNotes(kv, 'u3')).toEqual([]);
    kv.setItem('faj-tech-notes:u4', JSON.stringify([{ id: 'x' }, list[0]]));
    expect(loadNotes(kv, 'u4')).toEqual([list[0]]);
    expect(loadNotes(null, 'u1')).toEqual([]);
  });
});
