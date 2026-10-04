import { describe, expect, it } from 'vitest';
import {
  deliverablesFor, parseCloseout, closeoutMissing, applyCloseoutOp, closeoutOpFrom, closeoutArgs, totalDelayMs,
  delayFromTimes, doneCount, parseTimeRequests, parseTimeRequest, waitingRequests, acceptTimePatch, keepTimePatch,
  KIOSK_DELIVERABLES, SURVEY_DELIVERABLES, STANDARD_DELIVERABLES, EMPTY_CLOSEOUT, type CloseoutOp,
} from './closeout';

describe('deliverables by job type', () => {
  it('reads the job type from the title or description', () => {
    expect(deliverablesFor("Wendy's Kiosk Install", '')).toBe(KIOSK_DELIVERABLES);
    expect(deliverablesFor('Store 1142', 'install the self-order kiosk')).toBe(KIOSK_DELIVERABLES);
    expect(deliverablesFor('Site Survey - Laurens', '')).toBe(SURVEY_DELIVERABLES);
    expect(deliverablesFor('Cat6 drops', 'run 4 drops')).toBe(STANDARD_DELIVERABLES);
  });
  it('kiosk wins when a kiosk job mentions a survey', () => {
    expect(deliverablesFor('Kiosk', 'see the survey photos')).toBe(KIOSK_DELIVERABLES);
  });
});

describe('closeout record', () => {
  it('reads anything safely', () => {
    expect(parseCloseout(null)).toEqual(EMPTY_CLOSEOUT);
    expect(parseCloseout('junk')).toEqual(EMPTY_CLOSEOUT);
    expect(parseCloseout({ done: ['a', 'a', '', 3], delays: [{ id: 'x', start: 'nope', end: 'nope' }], signoff: { name: '' } }))
      .toEqual({ done: ['a', '3'], delays: [], signoff: null });
  });
  it('reads what the server stores', () => {
    const c = parseCloseout({
      done: ['Work area cleaned up'],
      delays: [{ id: 'd1', reason: 'Waiting on manager', start: '2026-10-04T14:00:00Z', end: '2026-10-04T14:45:00Z', by: 'Davis Sanders' }],
      signoff: { name: 'Pat Lee', signed_at: '2026-10-04T16:00:00Z', by: 'Davis Sanders' },
    });
    expect(c.signoff).toEqual({ name: 'Pat Lee', signedAt: '2026-10-04T16:00:00Z' });
    expect(totalDelayMs(c)).toBe(45 * 60_000);
  });
});

describe('what blocks Work done', () => {
  const items = STANDARD_DELIVERABLES;
  it('every deliverable must be ticked', () => {
    expect(closeoutMissing(EMPTY_CLOSEOUT, items, false)).toEqual(['Tick off 5 more deliverables under Closeout']);
    const four = { ...EMPTY_CLOSEOUT, done: items.slice(0, 4) };
    expect(closeoutMissing(four, items, false)).toEqual(['Tick off 1 more deliverable under Closeout']);
    expect(closeoutMissing({ ...EMPTY_CLOSEOUT, done: items }, items, false)).toEqual([]);
  });
  it('a tick from another list does not count', () => {
    const c = { ...EMPTY_CLOSEOUT, done: ['Completed kiosk', ...items.slice(0, 4)] };
    expect(doneCount(c, items)).toBe(4);
  });
  it('the sign-off is needed only when the office asked for a signature', () => {
    const all = { ...EMPTY_CLOSEOUT, done: items };
    expect(closeoutMissing(all, items, true)).toEqual(['Get the customer to sign off under Closeout']);
    expect(closeoutMissing({ ...all, signoff: { name: 'Pat', signedAt: 'x' } }, items, true)).toEqual([]);
  });
});

describe('closeout changes', () => {
  it('ticking twice changes nothing; unticking removes it', () => {
    let c = applyCloseoutOp(EMPTY_CLOSEOUT, { op: 'tick', item: 'A', done: true });
    c = applyCloseoutOp(c, { op: 'tick', item: 'A', done: true });
    expect(c.done).toEqual(['A']);
    expect(applyCloseoutOp(c, { op: 'tick', item: 'A', done: false }).done).toEqual([]);
  });
  it('a delay sent twice is kept once, and removes by id', () => {
    const delay = { id: 'd1', reason: 'Rain', start: '2026-10-04T14:00:00Z', end: '2026-10-04T15:00:00Z' };
    let c = applyCloseoutOp(EMPTY_CLOSEOUT, { op: 'add_delay', delay });
    c = applyCloseoutOp(c, { op: 'add_delay', delay });
    expect(c.delays).toHaveLength(1);
    expect(applyCloseoutOp(c, { op: 'remove_delay', id: 'd1' }).delays).toHaveLength(0);
  });
  it('sign and clear', () => {
    const c = applyCloseoutOp(EMPTY_CLOSEOUT, { op: 'sign', name: ' Pat Lee ', at: '2026-10-04T16:00:00Z' });
    expect(c.signoff).toEqual({ name: 'Pat Lee', signedAt: '2026-10-04T16:00:00Z' });
    expect(applyCloseoutOp(c, { op: 'clear_sign' }).signoff).toBeNull();
  });
  it('every op survives the trip through the outbox', () => {
    const ops: CloseoutOp[] = [
      { op: 'tick', item: 'A', done: true },
      { op: 'add_delay', delay: { id: 'd', reason: 'r', start: '2026-10-04T14:00:00.000Z', end: '2026-10-04T15:00:00.000Z' } },
      { op: 'remove_delay', id: 'd' },
      { op: 'sign', name: 'Pat', at: '2026-10-04T16:00:00.000Z' },
      { op: 'clear_sign' },
    ];
    for (const o of ops) expect(closeoutOpFrom(o.op, closeoutArgs(o), '2026-10-04T16:00:00.000Z')).toEqual(o);
    expect(closeoutOpFrom('drop_table', {}, '')).toBeNull();
  });
  it('a delay from clock times; past midnight rolls to the next day', () => {
    const day = new Date(2026, 9, 4, 12, 0);
    const d = delayFromTimes('x', ' Waiting ', day, '14:00', '14:30')!;
    expect(Date.parse(d.end) - Date.parse(d.start)).toBe(30 * 60_000);
    expect(d.reason).toBe('Waiting');
    const late = delayFromTimes('y', '', day, '23:30', '00:15')!;
    expect(Date.parse(late.end) - Date.parse(late.start)).toBe(45 * 60_000);
    expect(delayFromTimes('z', '', day, '', '10:00')).toBeNull();
  });
});

describe('asking for another time', () => {
  const wo = {
    time_requests: {
      'Davis Sanders': { date: '2026-10-09', time: '18:00', note: 'Store closes at 5', at: '2026-10-04T12:00:00Z', state: 'waiting' },
      'Old Tech': { date: '2026-10-08', time: null, note: null, at: '2026-10-03T12:00:00Z', state: 'waiting' },
      Broken: { date: 'Thursday' },
    },
    assignment_responses: { 'Old Tech': { status: 'declined', at: '2026-10-03T12:00:00Z' } },
  };

  it('reads requests, skipping broken ones', () => {
    const r = parseTimeRequests(wo.time_requests);
    expect(Object.keys(r)).toEqual(['Davis Sanders', 'Old Tech']);
    expect(r['Davis Sanders']).toMatchObject({ date: '2026-10-09', time: '18:00', state: 'waiting' });
    expect(parseTimeRequest(null)).toBeNull();
  });
  it('only techs still on the job wait for an answer', () => {
    const r = parseTimeRequests(wo.time_requests);
    expect(waitingRequests(r, ['Davis Sanders']).map(([n]) => n)).toEqual(['Davis Sanders']);
  });
  it('using the time moves the job and counts as accepted — and touches no money', () => {
    const now = new Date('2026-10-04T13:00:00Z');
    const p = acceptTimePatch(wo, 'Davis Sanders', now)!;
    expect(p.start_date).toBe('2026-10-09');
    expect(p.scheduled_date).toBe('2026-10-09');
    expect(p.start_time).toBe('18:00');
    expect((p.assignment_responses as Record<string, unknown>)['Davis Sanders']).toEqual({ status: 'accepted', at: now.toISOString() });
    expect((p.assignment_responses as Record<string, unknown>)['Old Tech']).toEqual(wo.assignment_responses['Old Tech']);
    expect((p.time_requests as Record<string, { state: string }>)['Davis Sanders'].state).toBe('accepted');
    expect(Object.keys(p).some((k) => /amount|pay|price|rate/.test(k))).toBe(false);
  });
  it('a request with no time keeps the job time', () => {
    const p = acceptTimePatch(wo, 'Old Tech')!;
    expect('start_time' in p).toBe(false);
  });
  it('keeping the original only answers the request', () => {
    const p = keepTimePatch(wo, 'Davis Sanders')!;
    expect(Object.keys(p).sort()).toEqual(['time_requests', 'updated_at']);
    expect((p.time_requests as Record<string, { state: string }>)['Davis Sanders'].state).toBe('kept');
  });
  it('no request, no change', () => {
    expect(acceptTimePatch(wo, 'Nobody')).toBeNull();
    expect(keepTimePatch({ time_requests: null }, 'Davis Sanders')).toBeNull();
  });
});
