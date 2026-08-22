import { describe, it, expect } from 'vitest';
import { actualHours, billableHours, applyHoursToSessions } from './visits';
import type { VisitSession } from './types';

describe('typing Hours moves the times', () => {
  const clock = (s: VisitSession[] | null) =>
    (s ?? []).map((x) => `${x.in.slice(11, 16)}–${x.out?.slice(11, 16) ?? '…'}`).join(' | ');

  it('moves the finish time on a single day', () => {
    const out = applyHoursToSessions(
      [{ in: '2026-07-23T14:00:00.000Z', out: '2026-07-23T16:45:00.000Z' }], 8,
    );
    expect(clock(out)).toBe('14:00–22:00');
    expect(actualHours(out)).toBe(8);
  });

  it('shortens as readily as it lengthens', () => {
    const out = applyHoursToSessions(
      [{ in: '2026-07-23T14:00:00.000Z', out: '2026-07-23T22:00:00.000Z' }], 3,
    );
    expect(actualHours(out)).toBe(3);
  });

  it('leaves finished days alone and moves only the current one', () => {
    // Day one was 5h and is history. Typing 8 makes day two 3h, not 8h.
    const out = applyHoursToSessions([
      { in: '2026-07-31T17:45:00.000Z', out: '2026-07-31T22:45:00.000Z' },
      { in: '2026-08-04T14:00:00.000Z', out: '2026-08-04T15:00:00.000Z' },
    ], 8);
    expect(actualHours(out)).toBe(8);
    expect(out![0].out).toBe('2026-07-31T22:45:00.000Z');   // untouched
    expect(clock(out![1] ? [out![1]] : null)).toBe('14:00–17:00');
  });

  it('refuses when the finished days already exceed the figure typed', () => {
    // 5h already logged on day one; 3 total is impossible without rewriting
    // history, so the times are left alone rather than invented.
    expect(applyHoursToSessions([
      { in: '2026-07-31T17:45:00.000Z', out: '2026-07-31T22:45:00.000Z' },
      { in: '2026-08-04T14:00:00.000Z', out: '2026-08-04T15:00:00.000Z' },
    ], 3)).toBe(null);
  });

  it('has nothing to reshape before a day is started', () => {
    expect(applyHoursToSessions(null, 4)).toBe(null);
    expect(applyHoursToSessions([], 4)).toBe(null);
  });

  it('ignores a cleared or nonsense figure', () => {
    const s = [{ in: '2026-07-23T14:00:00.000Z', out: '2026-07-23T16:00:00.000Z' }];
    expect(applyHoursToSessions(s, null)).toBe(null);
    expect(applyHoursToSessions(s, 0)).toBe(null);
    expect(applyHoursToSessions(s, -3)).toBe(null);
  });

  it('round-trips: hours in, times out, same hours back', () => {
    for (const h of [2, 2.75, 4.5, 8, 19.83]) {
      const out = applyHoursToSessions(
        [{ in: '2026-07-23T14:00:00.000Z', out: '2026-07-23T15:00:00.000Z' }], h,
      );
      expect(actualHours(out)).toBe(h);
    }
  });

  it('the minimum and the times end up agreeing', () => {
    // Type 0.75, blur snaps to 2, and the finish time follows to match.
    const snapped = billableHours(0.75);
    const out = applyHoursToSessions(
      [{ in: '2026-08-05T13:00:00.000Z', out: '2026-08-05T13:45:00.000Z' }], snapped,
    );
    expect(actualHours(out)).toBe(2);
    expect(clock(out)).toBe('13:00–15:00');
  });
});

/**
 * The rule that decides Hours when Time In / Time Out are edited, lifted out
 * of SiteLogView so both branches are pinned down.
 *
 * There are two shapes and they need opposite treatment:
 *   - one stint  → the times ARE the visit, so editing them must move hours
 *   - many stints → the times only mirror first-in/last-out, so the gap
 *     between them counts the nights in between (the 94.79h bug)
 */
function hoursAfterEditingTimes(next: {
  time_in: string; time_out: string; sessions: VisitSession[] | null;
}): { hours: number | null; sessions?: VisitSession[] } {
  const stints = (next.sessions ?? []).filter((s) => s.in && s.out);
  if (stints.length > 1) {
    const fromStints = actualHours(next.sessions);
    return { hours: fromStints != null && fromStints > 0 ? billableHours(fromStints) : null };
  }
  const gap = (new Date(next.time_out).getTime() - new Date(next.time_in).getTime()) / 3600000;
  if (gap <= 0) return { hours: null };
  return {
    hours: billableHours(Math.round(gap * 100) / 100),
    sessions: [{ in: next.time_in, out: next.time_out }],
  };
}

describe('editing Time In / Time Out', () => {
  it('moves the hours on a single-stint visit — the everyday case', () => {
    const r = hoursAfterEditingTimes({
      time_in: '2026-07-23T18:00:00.000Z',
      time_out: '2026-07-23T20:45:00.000Z',
      sessions: [{ in: '2026-07-23T18:00:00.000Z', out: '2026-07-23T19:00:00.000Z' }],
    });
    expect(r.hours).toBe(2.75);
  });

  it('works when the visit has no stints recorded at all', () => {
    const r = hoursAfterEditingTimes({
      time_in: '2026-08-21T13:00:00.000Z',
      time_out: '2026-08-21T18:30:00.000Z',
      sessions: null,
    });
    expect(r.hours).toBe(5.5);
  });

  it('keeps the single stint in step, so the card never warns of a mismatch', () => {
    const r = hoursAfterEditingTimes({
      time_in: '2026-07-23T18:00:00.000Z',
      time_out: '2026-07-23T20:45:00.000Z',
      sessions: [{ in: '2026-07-23T18:00:00.000Z', out: '2026-07-23T19:00:00.000Z' }],
    });
    expect(actualHours(r.sessions!)).toBe(2.75);
    expect(r.hours).toBe(actualHours(r.sessions!));
  });

  it('still applies the two-hour minimum', () => {
    const r = hoursAfterEditingTimes({
      time_in: '2026-08-05T13:00:00.000Z',
      time_out: '2026-08-05T13:45:00.000Z',
      sessions: null,
    });
    expect(r.hours).toBe(2);
  });

  it('does NOT count the nights between stints on a multi-day job', () => {
    // Kellogg 5800: two stints four days apart. The gap is 94.79h.
    const r = hoursAfterEditingTimes({
      time_in: '2026-07-31T17:45:00.000Z',
      time_out: '2026-08-04T16:32:40.832Z',
      sessions: [
        { in: '2026-07-31T17:45:00.000Z', out: '2026-07-31T22:45:00.000Z' },
        { in: '2026-08-04T14:49:00.000Z', out: '2026-08-04T16:32:40.832Z' },
      ],
    });
    expect(r.hours).toBe(6.73);
    expect(r.sessions).toBeUndefined();   // multi-day stints are never rewritten
  });

  it('ignores a backwards or zero-length edit rather than storing nonsense', () => {
    expect(hoursAfterEditingTimes({
      time_in: '2026-08-05T15:00:00.000Z',
      time_out: '2026-08-05T13:00:00.000Z',
      sessions: null,
    }).hours).toBe(null);
  });
});
