import { describe, it, expect } from 'vitest';
import { sundayOf, tapWindow, weekSites, weekToBillFor } from './week-to-bill';

const TZ = 'America/New_York';
const now = Date.parse('2026-10-25T16:00:00Z');
const inv = (wo_id: string, from_day: string, to_day: string, n: string | null, created_at = '2026-10-25T15:00:00Z') =>
  ({ wo_id, from_day, to_day, qbo_invoice_id: n ? `qb-${n}` : null, qbo_invoice_number: n, created_at });

describe('week to bill', () => {
  it('picks the week Fred is billing', () => {
    expect(sundayOf('2026-10-22')).toBe('2026-10-18');
    expect(weekToBillFor('2026-10-24')).toEqual({ from: '2026-10-18', to: '2026-10-24' }); // Saturday: this week
    expect(weekToBillFor('2026-10-25')).toEqual({ from: '2026-10-18', to: '2026-10-24' }); // Sunday: the week just ended
    expect(weekToBillFor('2026-10-28')).toEqual({ from: '2026-10-18', to: '2026-10-24' }); // a weekday: last week
  });

  it('lists each site with work that week, unbilled first', () => {
    const sites = weekSites({
      from: '2026-10-18', to: '2026-10-24', timeZone: TZ, now,
      taps: [
        { wo_id: 'lds', at: '2026-10-19T11:37:00Z' }, { wo_id: 'lds', at: '2026-10-20T22:09:00Z' },
        // 11:30 PM Saturday in New York is Sunday in UTC: still this week.
        { wo_id: 'wendys', at: '2026-10-25T03:30:00Z' },
        { wo_id: 'old', at: '2026-10-16T18:35:00Z' }, // last week
        { wo_id: 'done', at: '2026-10-21T13:00:00Z' },
      ],
      typed: [{ wo_id: 'lds', day: '2026-10-21' }, { wo_id: 'lds', day: '2026-10-22', hidden: true }, { wo_id: 'typed', day: '2026-10-23' }],
      invoices: [inv('done', '2026-10-18', '2026-10-24', '1041'), inv('lds', '2026-10-19', '2026-10-19', '1040'), inv('typed', '2026-10-01', '2026-10-07', '1001')],
    });
    expect(sites.map((s) => [s.woId, s.status, s.days.join(','), s.unbilled.join(','), s.invoices.join(',')])).toEqual([
      ['typed', 'to_bill', '2026-10-23', '2026-10-23', ''],
      ['wendys', 'to_bill', '2026-10-24', '2026-10-24', ''],
      ['lds', 'partly', '2026-10-19,2026-10-20,2026-10-21', '2026-10-20,2026-10-21', '1040'],
      ['done', 'billed', '2026-10-21', '', '1041'],
    ]);
  });

  it('counts an invoice still being created, not one cut off long ago', () => {
    const base = { from: '2026-10-18', to: '2026-10-24', timeZone: TZ, now, taps: [{ wo_id: 'a', at: '2026-10-20T14:00:00Z' }], typed: [] };
    expect(weekSites({ ...base, invoices: [inv('a', '2026-10-18', '2026-10-24', null, '2026-10-25T15:55:00Z')] })[0]).toMatchObject({ status: 'billed', invoices: ['being created'] });
    expect(weekSites({ ...base, invoices: [inv('a', '2026-10-18', '2026-10-24', null, '2026-10-25T10:00:00Z')] })[0].status).toBe('to_bill');
  });

  it('fetches taps a day either side, for the time zones', () => {
    expect(tapWindow('2026-10-18', '2026-10-24')).toEqual({ gte: '2026-10-17T00:00:00Z', lt: '2026-10-26T00:00:00Z' });
  });
});
