import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoAdapter, demoJobs } from './team-messaging-demo';
import { threadMessages, unreadMessages } from './team-messaging';

describe('team messaging workflow', () => {
  let storage: Pick<Storage, 'getItem' | 'setItem'>;
  beforeEach(() => {
    const map = new Map<string, string>();
    storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
  });
  it('delivers a private PM message, marks it read, and retains the technician reply after reload', async () => {
    const pm = createDemoAdapter('office-pm', storage);
    const tech = createDemoAdapter('tech-alex', storage);
    await pm.send('tech-alex', 'Please bring a cable tester.', null, null);
    const received = (await tech.load()).messages.find((m) => m.content === 'Please bring a cable tester.')!;
    expect(received.mine).toBe(false);
    expect(received.peer_id).toBe('office-pm');
    expect((await createDemoAdapter('office-assistant', storage).load()).messages.some((m) => m.id === received.id)).toBe(false);
    expect((await createDemoAdapter('tech-maya', storage).load()).messages.some((m) => m.id === received.id)).toBe(false);
    await tech.read('office-pm');
    expect((await pm.load()).messages.find((m) => m.id === received.id)?.read_at).toBeTruthy();
    await tech.send('office-pm', 'Will do.', null, null);
    const reloaded = await createDemoAdapter('office-pm', storage).load();
    expect(threadMessages(reloaded.messages, 'tech-alex').at(-1)?.content).toBe('Will do.');
    expect(unreadMessages(reloaded.messages, 'tech-alex')).toBeGreaterThan(0);
  });
  it.each(['available', 'unavailable'] as const)('returns a %s response and note on the original request only', async (status) => {
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
    await expect(tech.respond(request.id, status, '')).rejects.toThrow('already answered');
  });
  it('rejects invalid requests and technician-originated availability enquiries', async () => {
    const pm = createDemoAdapter('office-pm', storage);
    await expect(pm.send('tech-alex', 'Check this date', 'job-1052', '2000-01-01')).rejects.toThrow();
    await expect(pm.send('tech-alex', 'Check this date', null, demoJobs()[1].date)).rejects.toThrow();
    await expect(createDemoAdapter('tech-alex', storage).send('office-pm', 'Request', 'job-1052', demoJobs()[1].date)).rejects.toThrow();
  });
});
