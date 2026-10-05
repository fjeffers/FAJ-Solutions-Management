import { describe, expect, it } from 'vitest';
import { buildDmThreads, buildJobThreads, unreadFromTechs, whenShort, type InboxMessage } from './messages-inbox';

const msg = (id: string, wo: string, role: string, at: string, read = false): InboxMessage => ({
  id, work_order_id: wo, sender_name: role === 'contractor' ? 'Davis' : 'FAJ Solutions', sender_role: role,
  content: `message ${id}`, read_at: read ? at : null, created_at: at,
});

const JOBS = [
  { id: 'a', wo_number: '19101393', title: 'NYC kiosk', techs: ['Davis'], archived: false },
  { id: 'b', wo_number: '19101322', title: 'CHERRY HILL', techs: [], archived: false },
];

describe('Messages inbox', () => {
  it('one thread per job, newest conversation first, with tech messages not yet read', () => {
    const t = buildJobThreads([
      msg('1', '19101322', 'admin', '2026-10-05T10:00:00Z'),
      msg('2', '19101393', 'contractor', '2026-10-05T09:00:00Z'),
      msg('3', '19101393', 'contractor', '2026-10-05T11:00:00Z'),
      msg('4', '19101393', 'admin', '2026-10-05T08:00:00Z'),
      msg('5', '19101322', 'contractor', '2026-10-05T07:00:00Z', true),
    ], JOBS);
    expect(t.map((x) => x.woNumber)).toEqual(['19101393', '19101322']);
    expect(t[0]).toMatchObject({ unread: 2, count: 3, job: { title: 'NYC kiosk' } });
    expect(t[0].last.id).toBe('3');
    expect(t[1]).toMatchObject({ unread: 0, count: 2 });
  });

  it('a thread for a job that no longer exists still shows', () => {
    const t = buildJobThreads([msg('1', '999', 'contractor', '2026-10-05T10:00:00Z')], JOBS);
    expect(t[0]).toMatchObject({ woNumber: '999', job: null, unread: 1 });
  });

  it("the menu count is tech messages the office hasn't read", () => {
    expect(unreadFromTechs([
      msg('1', 'x', 'contractor', '2026-10-05T10:00:00Z'),
      msg('2', 'x', 'contractor', '2026-10-05T10:00:00Z', true),
      msg('3', 'x', 'admin', '2026-10-05T10:00:00Z'),
    ])).toBe(1);
    expect(unreadFromTechs([])).toBe(0);
  });

  it('tech-to-tech: one thread per pair, whoever wrote first', () => {
    const names: Record<string, string> = { d: 'Davis', m: 'Marcus', p: 'Paul' };
    const t = buildDmThreads([
      { id: '1', from_id: 'd', to_id: 'm', content: 'hi', created_at: '2026-10-05T09:00:00Z' },
      { id: '2', from_id: 'm', to_id: 'd', content: 'hey', created_at: '2026-10-05T09:05:00Z' },
      { id: '3', from_id: 'p', to_id: 'd', content: 'yo', created_at: '2026-10-05T08:00:00Z' },
    ], (id) => names[id]);
    expect(t.map((x) => x.names)).toEqual([['Davis', 'Marcus'], ['Davis', 'Paul']]);
    expect(t[0].messages.map((m) => m.id)).toEqual(['1', '2']);
    expect(t[0].last.id).toBe('2');
  });

  it('short times', () => {
    const now = new Date('2026-10-05T15:00:00');
    expect(whenShort('2026-10-05T14:59:40', now)).toBe('Just now');
    expect(whenShort('2026-10-05T14:48:00', now)).toBe('12 min');
    expect(whenShort('2026-10-05T12:00:00', now)).toBe('3 h');
    expect(whenShort('2026-10-04T12:00:00', now)).toBe('Yesterday');
    expect(whenShort('2026-09-28T12:00:00', now)).toBe('Sep 28');
  });
});
