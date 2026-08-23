import { describe, it, expect } from 'vitest';
import {
  nextDue, dueState, daysUntilDue, duePhrase, sortByUrgency, dueSummary,
  markDone, addDays, daysBetween, siteLabel, visitFromPlan, todayISO, SOON_DAYS,
} from './maintenance';
import type { MaintenancePlan, Asset } from './types';

const TODAY = '2026-08-23';

const plan = (over: Partial<MaintenancePlan>): MaintenancePlan => ({
  id: 'p1', user_id: 'u1', asset_id: null,
  program: "Wendy's", site_code: '1331', site_name: 'Hillside',
  task: 'Clean all cameras', interval_days: 90,
  last_done_on: null, next_due_on: null, active: true, notes: null,
  created_at: '', updated_at: '',
  ...over,
});

describe('date arithmetic', () => {
  it('adds days without slipping over a month or year end', () => {
    expect(addDays('2026-08-23', 90)).toBe('2026-11-21');
    expect(addDays('2026-12-20', 30)).toBe('2027-01-19');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('counts whole days between two dates, negative into the past', () => {
    expect(daysBetween('2026-08-01', '2026-08-23')).toBe(22);
    expect(daysBetween('2026-08-23', '2026-08-01')).toBe(-22);
    expect(daysBetween('2026-08-23', '2026-08-23')).toBe(0);
  });

  it('survives a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('gives back nothing rather than NaN for a bad date', () => {
    expect(addDays('not a date', 5)).toBe(null);
    expect(daysBetween('2026-08-23', '')).toBe(null);
  });

  it('reports today in local time, not UTC', () => {
    // 11pm on the 23rd local is still the 23rd, even where UTC has ticked over.
    const local = new Date(2026, 7, 23, 23, 0, 0);
    expect(todayISO(local)).toBe('2026-08-23');
  });
});

describe('nextDue', () => {
  it('uses an explicitly scheduled date above everything else', () => {
    expect(nextDue(plan({ next_due_on: '2026-09-01', last_done_on: '2026-01-01' }))).toBe('2026-09-01');
  });

  it('otherwise counts an interval from when it was last done', () => {
    expect(nextDue(plan({ last_done_on: '2026-06-01', interval_days: 90 }))).toBe('2026-08-30');
  });

  it('has no due date when it has never been done or scheduled', () => {
    expect(nextDue(plan({}))).toBe(null);
  });
});

describe('dueState', () => {
  const at = (over: Partial<MaintenancePlan>) => dueState(plan(over), TODAY);

  it('is overdue when the date has passed', () => {
    expect(at({ next_due_on: '2026-08-01' })).toBe('overdue');
  });

  it('is due on the day itself', () => {
    expect(at({ next_due_on: TODAY })).toBe('due');
  });

  it('is coming up inside the next fortnight', () => {
    expect(at({ next_due_on: addDays(TODAY, 1)! })).toBe('soon');
    expect(at({ next_due_on: addDays(TODAY, SOON_DAYS)! })).toBe('soon');
  });

  it('is merely scheduled beyond that', () => {
    expect(at({ next_due_on: addDays(TODAY, SOON_DAYS + 1)! })).toBe('ok');
  });

  it('is unscheduled with no dates at all', () => {
    expect(at({})).toBe('unscheduled');
  });

  it('is paused when switched off, however late it is', () => {
    expect(at({ active: false, next_due_on: '2020-01-01' })).toBe('paused');
  });
});

describe('duePhrase', () => {
  it('says how late, in plain words', () => {
    expect(duePhrase(plan({ next_due_on: '2026-08-14' }), TODAY)).toBe('9 days late');
    expect(duePhrase(plan({ next_due_on: '2026-08-22' }), TODAY)).toBe('1 day late');
  });

  it('says due today on the day', () => {
    expect(duePhrase(plan({ next_due_on: TODAY }), TODAY)).toBe('due today');
  });

  it('counts forward when it is still ahead', () => {
    expect(duePhrase(plan({ next_due_on: '2026-09-04' }), TODAY)).toBe('in 12 days');
    expect(duePhrase(plan({ next_due_on: '2026-08-24' }), TODAY)).toBe('in 1 day');
  });

  it('admits when nothing is scheduled', () => {
    expect(duePhrase(plan({}), TODAY)).toBe('no date set');
    expect(duePhrase(plan({ active: false }), TODAY)).toBe('paused');
  });
});

describe('daysUntilDue', () => {
  it('is negative when late', () => {
    expect(daysUntilDue(plan({ next_due_on: '2026-08-14' }), TODAY)).toBe(-9);
  });
  it('is null when unscheduled', () => {
    expect(daysUntilDue(plan({}), TODAY)).toBe(null);
  });
});

describe('sortByUrgency', () => {
  it('puts the worst first and the earliest first within a state', () => {
    const rows = [
      plan({ id: 'ok', next_due_on: '2026-12-01' }),
      plan({ id: 'late-a-lot', next_due_on: '2026-06-01' }),
      plan({ id: 'due', next_due_on: TODAY }),
      plan({ id: 'unscheduled' }),
      plan({ id: 'late-a-bit', next_due_on: '2026-08-20' }),
      plan({ id: 'soon', next_due_on: '2026-08-30' }),
      plan({ id: 'paused', active: false, next_due_on: '2020-01-01' }),
    ];
    expect(sortByUrgency(rows, TODAY).map((p) => p.id)).toEqual([
      'late-a-lot', 'late-a-bit', 'due', 'soon', 'ok', 'unscheduled', 'paused',
    ]);
  });

  it('does not disturb the array it was handed', () => {
    const rows = [plan({ id: 'a', next_due_on: '2026-12-01' }), plan({ id: 'b', next_due_on: '2026-01-01' })];
    sortByUrgency(rows, TODAY);
    expect(rows.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('dueSummary', () => {
  it('counts each state and what needs acting on', () => {
    const s = dueSummary([
      plan({ next_due_on: '2026-06-01' }),          // overdue
      plan({ next_due_on: '2026-07-01' }),          // overdue
      plan({ next_due_on: TODAY }),                 // due
      plan({ next_due_on: '2026-08-30' }),          // soon
      plan({ next_due_on: '2026-12-01' }),          // ok
      plan({}),                                     // unscheduled
      plan({ active: false }),                      // paused
    ], TODAY);
    expect(s.overdue).toBe(2);
    expect(s.due).toBe(1);
    expect(s.soon).toBe(1);
    expect(s.ok).toBe(1);
    expect(s.unscheduled).toBe(1);
    expect(s.paused).toBe(1);
    expect(s.needsAttention).toBe(4);   // overdue + due + soon
  });

  it('is all zeroes for nothing, not NaN', () => {
    expect(dueSummary([], TODAY).needsAttention).toBe(0);
  });
});

describe('markDone', () => {
  it('schedules the next one from the day it was done, not the day it was due', () => {
    // Due 1 June, actually done 23 August. Next is 90 days after the WORK,
    // otherwise lateness compounds forever.
    const p = plan({ interval_days: 90, next_due_on: '2026-06-01' });
    expect(markDone(p, TODAY)).toEqual({ last_done_on: '2026-08-23', next_due_on: '2026-11-21' });
  });

  it('a task done on time simply advances by its interval', () => {
    expect(markDone(plan({ interval_days: 30 }), '2026-08-23').next_due_on).toBe('2026-09-22');
  });

  it('clears the overdue state once it is done', () => {
    const p = plan({ interval_days: 90, next_due_on: '2026-06-01' });
    expect(dueState(p, TODAY)).toBe('overdue');
    expect(dueState(plan({ ...p, ...markDone(p, TODAY) }), TODAY)).toBe('ok');
  });
});

describe('siteLabel', () => {
  it('reads name then code', () => {
    expect(siteLabel(plan({ site_name: 'Hillside', site_code: '1331' }))).toBe('Hillside #1331');
  });
  it('copes with only one of the two', () => {
    expect(siteLabel(plan({ site_name: null }))).toBe('1331');
    expect(siteLabel(plan({ site_code: null }))).toBe('Hillside');
    expect(siteLabel(plan({ site_name: null, site_code: null }))).toBe('Unassigned site');
  });
});

describe('visitFromPlan', () => {
  const asset = { id: 'a1', name: 'Drive-thru camera' } as Asset;

  it('carries the site and the task onto a new visit', () => {
    const v = visitFromPlan(plan({ last_done_on: '2026-05-01' }), null, TODAY);
    expect(v).toMatchObject({
      visit_date: TODAY, program: "Wendy's", site_code: '1331', site_name: 'Hillside',
      visit_type: 'Revisit', client_summary: 'Clean all cameras',
      invoice_status: 'not_invoiced', payment_status: 'unpaid',
    });
    expect(String(v.notes)).toContain('every 90 days');
    expect(String(v.notes)).toContain('Last done 2026-05-01');
  });

  it('names the asset when the task is against one', () => {
    const v = visitFromPlan(plan({}), asset, TODAY);
    expect(v.client_summary).toBe('Clean all cameras — Drive-thru camera');
  });

  it('says so when it has never been done', () => {
    expect(String(visitFromPlan(plan({}), null, TODAY).notes)).toContain('Not done before');
  });

  it('leaves the visit unpriced, so it cannot bill at a rate nobody chose', () => {
    const v = visitFromPlan(plan({}), null, TODAY);
    expect(v.rate).toBeUndefined();
    expect(v.total_project_price).toBeUndefined();
  });
});
