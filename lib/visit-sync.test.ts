import { describe, it, expect } from 'vitest';
import { deriveTimesAndHours } from './visit-sync';
import { actualHours } from './visits';
import type { SiteVisit, VisitSession } from './types';

// The real rule the grid and the card both run — not a copy of it.
const visit = (over: Partial<SiteVisit>) => ({
  time_in: null, time_out: null, hours: null, sessions: [], ...over,
} as Pick<SiteVisit, 'time_in' | 'time_out' | 'hours' | 'sessions'>);

const hhmm = (s: VisitSession[] | null | undefined) =>
  (s ?? []).map((x) => `${x.in.slice(11, 16)}–${x.out?.slice(11, 16) ?? '…'}`).join(' | ');

describe('editing the times sets the hours', () => {
  it('on a single-day visit', () => {
    const d = deriveTimesAndHours(
      visit({
        time_in: '2026-07-23T14:00:00.000Z',
        time_out: '2026-07-23T16:45:00.000Z',
        sessions: [{ in: '2026-07-23T14:00:00.000Z', out: '2026-07-23T15:00:00.000Z' }],
      }),
      { time_out: '2026-07-23T16:45:00.000Z' },
    );
    expect(d.hours).toBe(2.75);
    expect(hhmm(d.sessions)).toBe('14:00–16:45');   // the stint follows
  });

  it('with no stint recorded yet', () => {
    const d = deriveTimesAndHours(
      visit({ time_in: '2026-08-21T13:00:00.000Z', time_out: '2026-08-21T18:30:00.000Z' }),
      { time_in: '2026-08-21T13:00:00.000Z' },
    );
    expect(d.hours).toBe(5.5);
  });

  it('applying the two-hour minimum', () => {
    const d = deriveTimesAndHours(
      visit({ time_in: '2026-08-05T13:00:00.000Z', time_out: '2026-08-05T13:45:00.000Z' }),
      { time_out: '2026-08-05T13:45:00.000Z' },
    );
    expect(d.hours).toBe(2);
  });

  it('never counting the nights between days of a multi-day job', () => {
    const d = deriveTimesAndHours(
      visit({
        time_in: '2026-07-31T17:45:00.000Z',
        time_out: '2026-08-04T16:32:40.832Z',
        sessions: [
          { in: '2026-07-31T17:45:00.000Z', out: '2026-07-31T22:45:00.000Z' },
          { in: '2026-08-04T14:49:00.000Z', out: '2026-08-04T16:32:40.832Z' },
        ],
      }),
      { time_out: '2026-08-04T16:32:40.832Z' },
    );
    expect(d.hours).toBe(6.73);       // not 94.79
    expect(d.sessions).toBeUndefined(); // real days are never rewritten
  });

  it('ignoring a backwards range', () => {
    const d = deriveTimesAndHours(
      visit({ time_in: '2026-08-05T15:00:00.000Z', time_out: '2026-08-05T13:00:00.000Z' }),
      { time_out: '2026-08-05T13:00:00.000Z' },
    );
    expect(d.hours).toBeUndefined();
  });
});

describe('editing the hours moves the times', () => {
  it('on a single-day visit', () => {
    const d = deriveTimesAndHours(
      visit({
        time_in: '2026-07-23T14:00:00.000Z',
        time_out: '2026-07-23T16:45:00.000Z',
        hours: 8,
        sessions: [{ in: '2026-07-23T14:00:00.000Z', out: '2026-07-23T16:45:00.000Z' }],
      }),
      { hours: 8 },
    );
    expect(hhmm(d.sessions)).toBe('14:00–22:00');
    expect(d.time_out).toBe('2026-07-23T22:00:00.000Z');
    expect(actualHours(d.sessions!)).toBe(8);
  });

  it('moving only the current day, leaving finished days alone', () => {
    const d = deriveTimesAndHours(
      visit({
        hours: 8,
        sessions: [
          { in: '2026-07-31T17:45:00.000Z', out: '2026-07-31T22:45:00.000Z' },  // 5h, history
          { in: '2026-08-04T14:00:00.000Z', out: '2026-08-04T15:00:00.000Z' },
        ],
      }),
      { hours: 8 },
    );
    expect(actualHours(d.sessions!)).toBe(8);
    expect(d.sessions![0].out).toBe('2026-07-31T22:45:00.000Z');
  });

  it('refusing when finished days already exceed the figure typed', () => {
    const d = deriveTimesAndHours(
      visit({
        hours: 3,
        sessions: [
          { in: '2026-07-31T17:45:00.000Z', out: '2026-07-31T22:45:00.000Z' },
          { in: '2026-08-04T14:00:00.000Z', out: '2026-08-04T15:00:00.000Z' },
        ],
      }),
      { hours: 3 },
    );
    expect(d.sessions).toBeUndefined();  // history is not rewritten
  });

  it('doing nothing when no day has been started', () => {
    expect(deriveTimesAndHours(visit({ hours: 4 }), { hours: 4 })).toEqual({});
  });
});

describe('the two directions agree with each other', () => {
  it('round-trips: set times, read hours, set those hours, times unchanged', () => {
    const start = '2026-07-23T14:00:00.000Z';
    const end   = '2026-07-23T19:15:00.000Z';

    const fromTimes = deriveTimesAndHours(
      visit({ time_in: start, time_out: end }), { time_out: end },
    );
    expect(fromTimes.hours).toBe(5.25);

    const backToTimes = deriveTimesAndHours(
      visit({ time_in: start, time_out: end, hours: fromTimes.hours!, sessions: fromTimes.sessions! }),
      { hours: fromTimes.hours! },
    );
    expect(backToTimes.time_out).toBe(end);
    expect(hhmm(backToTimes.sessions)).toBe(hhmm(fromTimes.sessions));
  });

  it('leaves hours and the stints agreeing, so no warning appears', () => {
    for (const h of [2, 2.75, 5.25, 8, 19.83]) {
      const d = deriveTimesAndHours(
        visit({ hours: h, sessions: [{ in: '2026-07-23T14:00:00.000Z', out: '2026-07-23T15:00:00.000Z' }] }),
        { hours: h },
      );
      expect(actualHours(d.sessions!)).toBe(h);
    }
  });

  it('does not fight itself when both are edited at once', () => {
    // The timer writes both. The times must win, not be undone by the hours.
    const d = deriveTimesAndHours(
      visit({
        time_in: '2026-07-23T14:00:00.000Z',
        time_out: '2026-07-23T17:00:00.000Z',
        hours: 99,
        sessions: [],
      }),
      { time_in: '2026-07-23T14:00:00.000Z', time_out: '2026-07-23T17:00:00.000Z', hours: 99 },
    );
    expect(d.hours).toBe(3);
    expect(hhmm(d.sessions)).toBe('14:00–17:00');
  });
});
