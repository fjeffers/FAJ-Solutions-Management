import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoAdapter, demoJobs } from './team-messaging-demo';
import { threadMessages, unreadMessages } from './team-messaging';

describe('team messaging workflow', () => {
  let storage: Pick<Storage, 'getItem' | 'setItem'>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
    const map = new Map<string, string>();
    storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
  });
  afterEach(() => vi.useRealTimers());
  it('delivers a private PM message, marks it read, and retains the technician reply after reload', async () => {
    const pm = createDemoAdapter('office-pm', storage);
    const tech = createDemoAdapter('tech-alex', storage);
    await pm.send('tech-alex', 'Please bring a cable tester.', null, null);
    const received = (await tech.load()).messages.find((m) => m.content === 'Please bring a cable tester.')!;
    expect(received.mine).toBe(false);
    expect(received.peer_id).toBe('office-pm');
    expect((await createDemoAdapter('office-assistant', storage).load()).messages.some((m) => m.id === received.id)).toBe(false);
    expect((await createDemoAdapter('tech-maya', storage).load()).messages.some((m) => m.id === received.id)).toBe(false);
    await tech.read('office-pm', [received.id]);
    expect((await pm.load()).messages.find((m) => m.id === received.id)?.read_at).toBeTruthy();
    vi.advanceTimersByTime(1000);
    await tech.send('office-pm', 'Will do.', null, null);
    const reloaded = await createDemoAdapter('office-pm', storage).load();
    expect(threadMessages(reloaded.messages, 'tech-alex').at(-1)?.content).toBe('Will do.');
    expect(unreadMessages(reloaded.messages, 'tech-alex')).toBeGreaterThan(0);
  });
  it.each(['available', 'unavailable'] as const)('returns a %s request update and unread reply', async (status) => {
    const pm = createDemoAdapter('office-pm', storage);
    const tech = createDemoAdapter('tech-alex', storage);
    await pm.send('tech-alex', 'Can you take this survey?', 'job-1052', demoJobs()[1].date);
    const request = (await tech.load()).messages.find((m) => m.job_id === 'job-1052')!;
    await expect(createDemoAdapter('tech-maya', storage).respond(request.id, status, '')).rejects.toThrow();
    await expect(pm.respond(request.id, status, '')).rejects.toThrow();
    await tech.respond(request.id, status, 'After 10 AM');
    const response = (await pm.load()).messages.find((m) => m.id === request.id)!;
    expect(response.availability).toBe(status);
    expect(response.response_note).toBe('After 10 AM');
    expect(response.responded_at).toBeTruthy();
    const reply = (await pm.load()).messages.find((m) => m.sender_id === 'tech-alex' && m.content.includes('for WO 1052'))!;
    expect(reply.mine).toBe(false);
    expect(reply.read_at).toBeNull();
    expect(unreadMessages([reply], 'tech-alex')).toBe(1);
    await pm.read('tech-alex', [reply.id]);
    expect((await pm.load()).messages.find((m) => m.id === reply.id)?.read_at).toBeTruthy();
    await expect(tech.respond(request.id, status, '')).rejects.toThrow('already answered');
  });
  it('does not acknowledge messages arriving after the observed snapshot or another private thread', async () => {
    const pm = createDemoAdapter('office-pm', storage);
    const tech = createDemoAdapter('tech-alex', storage);
    await pm.send('tech-alex', 'Observed message', null, null);
    const observed = (await tech.load()).messages.find((m) => m.content === 'Observed message')!;
    await pm.send('tech-alex', 'Arrived during read', null, null);
    await createDemoAdapter('office-admin', storage).send('tech-alex', 'Other office thread', null, null);
    const other = (await tech.load()).messages.find((m) => m.content === 'Other office thread')!;
    await tech.read('office-pm', [observed.id, other.id]);
    const messages = (await tech.load()).messages;
    expect(messages.find((m) => m.id === observed.id)?.read_at).toBeTruthy();
    expect(messages.find((m) => m.content === 'Arrived during read')?.read_at).toBeNull();
    expect(messages.find((m) => m.id === other.id)?.read_at).toBeNull();
  });
  it('rejects invalid requests and technician-originated availability enquiries', async () => {
    const pm = createDemoAdapter('office-pm', storage);
    await expect(pm.send('tech-alex', 'Check this date', 'job-1052', '2000-01-01')).rejects.toThrow();
    await expect(pm.send('tech-alex', 'Check this date', null, demoJobs()[1].date)).rejects.toThrow();
    await expect(createDemoAdapter('tech-alex', storage).send('office-pm', 'Request', 'job-1052', demoJobs()[1].date)).rejects.toThrow();
  });
});
