import { describe, expect, it } from 'vitest';
import {
  wfStatusFor, wfJobFromTech, wfJobFromOwner, parseClockTime, whenText, fullAddress, place,
  tasksDone, isClockedIn, canWork, withTask, clockedIn, clockedOut, markedWorkDone, workedMs,
  formatDuration, formatClock, matchesWf, sortWf, ownerCounts, techCounts, statusesPresent, jobImage,
  wfStatusLabel,
} from './wf';
import {
  Outbox, RefusedError, isNoSignal, makeAction, saveCopy, loadCopy, lastUid, clearCopies, type KeyValue,
} from './wf-outbox';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

const noSignal = () => new TypeError('Failed to fetch');

describe('the status a tech sees', () => {
  it('an offer stays "needs your answer" until they accept', () => {
    expect(wfStatusFor('Assigned')).toBe('offered');
    expect(wfStatusFor('Open')).toBe('offered');
    expect(wfStatusFor('Assigned', 'accepted')).toBe('scheduled');
    expect(wfStatusFor('Assigned', 'declined')).toBe('declined');
  });
  it('work stages and the pay steps', () => {
    expect(wfStatusFor('In Progress', 'accepted')).toBe('inProgress');
    expect(wfStatusFor('Work Done')).toBe('workDone');
    expect(wfStatusFor('Approved')).toBe('closed');
    expect(wfStatusFor('Paid')).toBe('closed');
  });
  it('a job with nobody on it needs a tech', () => {
    expect(wfStatusFor('Open', '', false)).toBe('open');
  });
  it('the office reads an offer as waiting on the tech', () => {
    expect(wfStatusLabel('offered', true)).toBe('Waiting on tech');
    expect(wfStatusLabel('offered', false)).toBe('Needs your answer');
  });
});

describe('reading start times', () => {
  it('common ways people type a time', () => {
    expect(parseClockTime('8:00 AM')).toEqual([8, 0]);
    expect(parseClockTime('8am')).toEqual([8, 0]);
    expect(parseClockTime('1:30 pm')).toEqual([13, 30]);
    expect(parseClockTime('12:00 AM')).toEqual([0, 0]);
    expect(parseClockTime('12 PM')).toEqual([12, 0]);
    expect(parseClockTime('14:45')).toEqual([14, 45]);
  });
  it('gives up on anything else instead of guessing', () => {
    expect(parseClockTime('')).toBeNull();
    expect(parseClockTime('morning')).toBeNull();
    expect(parseClockTime('8:75')).toBeNull();
  });
});

describe("a tech's job from the database", () => {
  const job = wfJobFromTech({
    id: 'uuid-1', wo_number: '19101293', title: 'Network refresh', customer_name: "Wendy's",
    site_address: '12 Main St', site_city: 'Easton', site_state: 'PA', site_zip: '18042',
    scheduled_date: '2026-10-06', start_time: '08:00', wo_status: 'Assigned', my_response: 'accepted',
    techs: ['Jere Jones', 'Mutema Desouza'],
    wo_tasks: [
      { id: '1', label: 'Survey', category: 'On Site', completed: true },
      { id: '2', label: 'Photos', category: 'On Site', completed: false },
    ],
    checked_in_at: '2026-10-06T12:00:00Z',
    // Even if money were ever sent, a tech's job must not carry it.
    total_amount: 650, contractor_pay: { 'Jere Jones': 400 },
  });

  it('reads the work', () => {
    expect(job.number).toBe('19101293');
    expect(job.status).toBe('scheduled');
    expect(fullAddress(job)).toBe('12 Main St, Easton, PA 18042');
    expect(place(job)).toBe('Easton, PA');
    expect(tasksDone(job)).toBe(1);
    expect(isClockedIn(job)).toBe(true);
    expect(canWork(job)).toBe(true);
    expect(jobImage(job)).toBe('/wf/job_network.jpg');
  });
  it('carries no money', () => {
    expect(job.clientPrice).toBeNull();
    expect(JSON.stringify(job)).not.toContain('650');
    expect(JSON.stringify(job)).not.toContain('400');
  });
});

describe("the owner's work order", () => {
  it('keeps the client price and reads the techs\' answers', () => {
    const j = wfJobFromOwner({
      id: 'a', wo_number: '1', wo_status: 'Assigned', contractor_names: ['Davis Sanders'], contractor_name: 'Davis Sanders',
      assignment_responses: { 'Davis Sanders': { status: 'accepted', at: 'x' } }, total_amount: 650, archived_at: null,
    });
    expect(j.status).toBe('scheduled');
    expect(j.clientPrice).toBe(650);
    expect(j.answers['Davis Sanders']).toBe('accepted');
  });
  it('nobody on it needs a tech; every tech declining shows declined', () => {
    expect(wfJobFromOwner({ id: 'b', wo_number: '2', wo_status: 'Open', contractor_names: [], contractor_name: '' }).status).toBe('open');
    expect(wfJobFromOwner({
      id: 'c', wo_number: '3', wo_status: 'Assigned', contractor_names: ['A'], assignment_responses: { A: { status: 'declined' } },
    }).status).toBe('declined');
  });
  it('a job closed out in the office is closed', () => {
    expect(wfJobFromOwner({ id: 'd', wo_number: '4', wo_status: 'Work Done', contractor_names: ['A'], archived_at: '2026-09-01' }).status).toBe('closed');
  });
});

describe('when a job is', () => {
  const at = (date: string | null, startTime = '') => ({ ...wfJobFromTech({ id: 'x', wo_number: '1', scheduled_date: date, start_time: startTime }) });
  it('says it the way people say it', () => {
    expect(whenText(at('2026-10-06', '08:00'), '2026-10-05')).toBe('Tomorrow · Tue Oct 6, 8:00 AM');
    expect(whenText(at('2026-10-05'), '2026-10-05')).toBe('Today · Mon Oct 5');
    expect(whenText(at('2026-10-01'), '2026-10-05')).toBe('4 days ago · Thu Oct 1');
    expect(whenText(at(null), '2026-10-05')).toBe('Not scheduled yet');
  });
});

describe('a tap shows at once', () => {
  const job = wfJobFromTech({
    id: 'x', wo_number: '1', wo_status: 'Assigned', my_response: 'accepted',
    wo_tasks: [{ id: 't1', label: 'Photos', completed: false }],
  });
  it('clock in, then out', () => {
    const inJob = clockedIn(job, new Date('2026-10-06T12:00:00Z'));
    expect(isClockedIn(inJob)).toBe(true);
    expect(inJob.status).toBe('inProgress');
    const outJob = clockedOut(inJob, new Date('2026-10-06T15:30:00Z'));
    expect(isClockedIn(outJob)).toBe(false);
    expect(formatDuration(workedMs(outJob))).toBe('3h 30m');
  });
  it('tick a checklist item', () => {
    expect(tasksDone(withTask(job, 't1', true))).toBe(1);
  });
  it('work done stops the clock', () => {
    const done = markedWorkDone(clockedIn(job, new Date('2026-10-06T12:00:00Z')), 'All set', new Date('2026-10-06T13:00:00Z'));
    expect(done.status).toBe('workDone');
    expect(isClockedIn(done)).toBe(false);
    expect(done.closeoutNotes).toBe('All set');
  });
  it('the running clock reads hh:mm:ss', () => {
    expect(formatClock((2 * 3600 + 38 * 60 + 7) * 1000)).toBe('02:38:07');
  });
});

describe('lists', () => {
  const jobs = [
    wfJobFromOwner({ id: '1', wo_number: '30', wo_status: 'Open', contractor_names: [], scheduled_date: '2026-10-05', site_city: 'Easton' }),
    wfJobFromOwner({ id: '2', wo_number: '31', wo_status: 'Work Done', contractor_names: ['Jere Jones'], scheduled_date: '2026-10-02' }),
    wfJobFromOwner({ id: '3', wo_number: '32', wo_status: 'Assigned', contractor_names: ['Davis'], scheduled_date: null }),
  ];
  it('search finds a WO number, a city or a tech', () => {
    expect(jobs.filter((j) => matchesWf(j, 'easton')).map((j) => j.number)).toEqual(['30']);
    expect(jobs.filter((j) => matchesWf(j, 'jere')).map((j) => j.number)).toEqual(['31']);
    expect(jobs.filter((j) => matchesWf(j, '32')).map((j) => j.number)).toEqual(['32']);
  });
  it('coming up first, then the most recent past, unscheduled last', () => {
    expect(sortWf(jobs, '2026-10-03').map((j) => j.number)).toEqual(['30', '31', '32']);
    expect(sortWf(jobs, '2026-10-01').map((j) => j.number)).toEqual(['31', '30', '32']);
    const past = [
      wfJobFromOwner({ id: 'm', wo_number: '1', wo_status: 'Open', scheduled_date: '2026-05-29' }),
      wfJobFromOwner({ id: 's', wo_number: '2', wo_status: 'Open', scheduled_date: '2026-09-30' }),
    ];
    expect(sortWf(past, '2026-10-02').map((j) => j.number)).toEqual(['2', '1']);
  });
  it("the office's three numbers", () => {
    expect(ownerCounts(jobs, '2026-10-05')).toEqual({ needTech: 1, waiting: 1, today: 1, workDone: 1 });
    expect(statusesPresent(jobs)).toEqual(['open', 'offered', 'workDone']);
  });
  it("a tech's numbers", () => {
    const mine = [
      clockedIn(wfJobFromTech({ id: 'a', wo_number: '1', wo_status: 'Assigned', my_response: 'accepted', scheduled_date: '2026-10-05' }), new Date('2026-10-05T13:00:00Z')),
      wfJobFromTech({ id: 'b', wo_number: '2', wo_status: 'Assigned', scheduled_date: '2026-10-05' }),
    ];
    const c = techCounts(mine, '2026-10-05', new Date('2026-10-05T14:00:00Z'));
    expect(c.today).toBe(2);
    expect(c.inProgress).toBe(1);
    expect(c.offers).toBe(1);
    expect(formatDuration(c.workedTodayMs)).toBe('1h 00m');
  });
});

describe('telling "no signal" from "the office said no"', () => {
  it('a dropped connection is no signal', () => {
    expect(isNoSignal(noSignal())).toBe(true);
    expect(isNoSignal({ message: 'TypeError: Load failed' })).toBe(true);
  });
  it('a refusal is not', () => {
    expect(isNoSignal(new RefusedError('That job is closed.'))).toBe(false);
  });
});

describe('the outbox', () => {
  it('a tap with no signal waits, then goes out in order with its own time', async () => {
    const kv = memory();
    const box = new Outbox(kv, 'tech-1', 60_000);
    const sent: string[] = [];
    const times: Date[] = [];
    let signal = false;
    box.register('clock', async (args, at) => {
      if (!signal) throw noSignal();
      sent.push(`${args.number}:${args.action}`);
      times.push(at);
    });

    const tapIn = new Date(Date.now() - 2 * 3600_000);
    const r1 = await box.run(makeAction('clock', { number: '19101336', action: 'in' }, 'in', tapIn));
    expect(r1.status).toBe('queued');
    expect(box.offline).toBe(true);

    // Still no signal: the second tap queues behind the first, never ahead of it.
    const r2 = await box.run(makeAction('clock', { number: '19101336', action: 'out' }, 'out'));
    expect(r2.status).toBe('queued');
    expect(box.pending.length).toBe(2);

    signal = true;
    await box.flush();
    expect(sent).toEqual(['19101336:in', '19101336:out']);
    expect(times[0].toISOString()).toBe(tapIn.toISOString()); // hours count from the tap
    expect(box.pending.length).toBe(0);
    expect(box.offline).toBe(false);
    box.dispose();
  });

  it('the queue survives closing the app', async () => {
    const kv = memory();
    const a = new Outbox(kv, 'tech-1', 60_000);
    a.register('task', async () => { throw noSignal(); });
    await a.run(makeAction('task', { number: '1', task: 't1', done: true }, 'tick'));
    a.dispose();

    const b = new Outbox(kv, 'tech-1', 60_000);
    expect(b.pending.length).toBe(1);
    expect(b.pending[0].args.task).toBe('t1');
    b.dispose();
  });

  it('something the office refuses is dropped and reported, not retried forever', async () => {
    const box = new Outbox(memory(), 'tech-2', 60_000);
    let signal = false;
    box.register('respond', async () => {
      if (!signal) throw noSignal();
      throw new RefusedError('This job is closed or no longer yours.');
    });
    await box.run(makeAction('respond', { number: '9', accept: true }, 'Accept WO 9'));
    signal = true;
    expect(await box.flush()).toBe(0);
    expect(box.pending.length).toBe(0);
    expect(box.problems[0]).toContain('Accept WO 9');
    box.dispose();
  });

  it("one person never sees another's queue on a shared phone", async () => {
    const kv = memory();
    const a = new Outbox(kv, 'tech-a', 60_000);
    a.register('task', async () => { throw noSignal(); });
    await a.run(makeAction('task', { number: '1' }, 'tick'));
    const b = new Outbox(kv, 'tech-b', 60_000);
    expect(b.pending.length).toBe(0);
    a.dispose(); b.dispose();
  });

  it('a refusal while there is signal is reported straight away', async () => {
    const box = new Outbox(memory(), 'tech-3', 60_000);
    box.register('task', async () => { throw new RefusedError('That job is closed.'); });
    const r = await box.run(makeAction('task', {}, 'tick'));
    expect(r).toEqual({ status: 'refused', error: 'That job is closed.' });
    expect(box.pending.length).toBe(0);
    box.dispose();
  });
});

describe('copies kept on the phone', () => {
  it('saved per login, and forgotten on sign-out', () => {
    const kv = memory();
    saveCopy(kv, 'u1', 'jobs', [{ n: 1 }]);
    expect(loadCopy<{ n: number }[]>(kv, 'u1', 'jobs')?.value).toEqual([{ n: 1 }]);
    expect(loadCopy(kv, 'u2', 'jobs')).toBeNull();
    expect(lastUid(kv)).toBe('u1');
    clearCopies(kv, 'u1', ['jobs']);
    expect(loadCopy(kv, 'u1', 'jobs')).toBeNull();
    expect(lastUid(kv)).toBeNull();
  });
});

describe('taps still waiting on the phone', () => {
  it('stay on screen when the list reloads', async () => {
    const { applyPending } = await import('./tech-wf');
    const office = [wfJobFromTech({
      id: 'x', wo_number: '7', wo_status: 'Assigned', my_response: 'accepted',
      wo_tasks: [{ id: 't1', label: 'Photos', completed: false }],
    })];
    const pending = [
      makeAction('clock', { number: '7', action: 'in' }, 'in', new Date('2026-10-06T12:00:00Z')),
      makeAction('task', { number: '7', task: 't1', done: true }, 'tick'),
      makeAction('task', { number: '99', task: 't1', done: true }, 'other job'),
    ];
    const [j] = applyPending(office, pending);
    expect(isClockedIn(j)).toBe(true);
    expect(tasksDone(j)).toBe(1);
    expect(j.status).toBe('inProgress');
  });
});
