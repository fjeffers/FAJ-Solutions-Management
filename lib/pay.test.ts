import { describe, it, expect } from 'vitest';
import {
  loggedHours, rateFor, suggestPay, suggestPayForWO,
  suggestionsAsContractorPay, payVariance, MAX_CREDIBLE_HOURS,
} from './pay';
import type { ContractorTimeLog } from './types';

const log = (over: Partial<ContractorTimeLog> = {}): ContractorTimeLog =>
  ({
    id: crypto.randomUUID(),
    wo_id: 'wo-1',
    wo_number: '1001',
    contractor_name: 'Jere Jones',
    travel_start_at: null, travel_start_lat: null, travel_start_lng: null,
    arrived_at: null, arrived_lat: null, arrived_lng: null,
    checked_in_at: '2026-07-20T13:00:00Z',
    checked_out_at: '2026-07-20T17:00:00Z',
    hourly_rate: null, work_summary: null, adjusted_hours: null,
    created_at: '2026-07-20T13:00:00Z', updated_at: '2026-07-20T17:00:00Z',
    ...over,
  }) as unknown as ContractorTimeLog;

describe('loggedHours', () => {
  it('measures the clock', () => {
    expect(loggedHours(log())).toBe(4);
  });

  it('prefers a manual correction over the clock', () => {
    expect(loggedHours(log({ adjusted_hours: 3.5 }))).toBe(3.5);
  });

  it('returns null for an open shift rather than guessing', () => {
    expect(loggedHours(log({ checked_out_at: null }))).toBeNull();
  });

  it('returns null when nothing was logged', () => {
    expect(loggedHours(log({ checked_in_at: null, checked_out_at: null }))).toBeNull();
  });

  it('refuses a checkout that precedes the check-in', () => {
    expect(loggedHours(log({ checked_out_at: '2026-07-20T12:00:00Z' }))).toBeNull();
  });
});

describe('rateFor', () => {
  it('prefers the per-job override', () => {
    expect(rateFor({ hourly_rate: 65 }, { default_hourly_rate: 55 })).toBe(65);
  });
  it('falls back to the tech default', () => {
    expect(rateFor({ hourly_rate: null }, { default_hourly_rate: 55 })).toBe(55);
  });
  it('is null when neither is set', () => {
    expect(rateFor({ hourly_rate: null }, { default_hourly_rate: null })).toBeNull();
    expect(rateFor(null, undefined)).toBeNull();
  });
});

describe('suggestPay', () => {
  it('suggests hours x rate', () => {
    const s = suggestPay(log(), { default_hourly_rate: 55 });
    expect(s).toMatchObject({ hours: 4, rate: 55, amount: 220, blockedReason: null });
  });

  it('explains itself when the tech is still checked in', () => {
    const s = suggestPay(log({ checked_out_at: null }), { default_hourly_rate: 55 });
    expect(s.amount).toBeNull();
    expect(s.blockedReason).toMatch(/no checkout/i);
  });

  it('explains itself when the tech has no rate', () => {
    const s = suggestPay(log(), { default_hourly_rate: null });
    expect(s.amount).toBeNull();
    expect(s.hours).toBe(4);
    expect(s.blockedReason).toMatch(/no hourly rate/i);
  });

  // The 176h / 391h incident: a missed checkout must not become a huge payout.
  it('caps an implausible shift and says it capped it', () => {
    const s = suggestPay(
      log({ checked_in_at: '2026-07-01T00:00:00Z', checked_out_at: '2026-07-08T00:00:00Z' }),
      { default_hourly_rate: 55 },
    );
    expect(s.rawHours).toBe(168);
    expect(s.hours).toBe(MAX_CREDIBLE_HOURS);
    expect(s.amount).toBe(MAX_CREDIBLE_HOURS * 55);
    expect(s.blockedReason).toMatch(/capped/i);
  });

  it('marks a corrected figure as adjusted', () => {
    expect(suggestPay(log({ adjusted_hours: 6 }), { default_hourly_rate: 50 }))
      .toMatchObject({ adjusted: true, hours: 6, amount: 300 });
  });
});

describe('suggestPayForWO', () => {
  it('covers every tech on the job and ignores other jobs', () => {
    const out = suggestPayForWO(
      { id: 'wo-1' },
      [
        log({ contractor_name: 'Zeb', wo_id: 'wo-1' }),
        log({ contractor_name: 'Al', wo_id: 'wo-1' }),
        log({ contractor_name: 'Other', wo_id: 'wo-2' }),
      ],
      [{ name: 'Zeb', default_hourly_rate: 50 }, { name: 'Al', default_hourly_rate: 60 }],
    );
    expect(out.map((s) => s.contractorName)).toEqual(['Al', 'Zeb']);
    expect(out.map((s) => s.amount)).toEqual([240, 200]);
  });
});

describe('suggestionsAsContractorPay', () => {
  it('shapes accepted suggestions like contractor_pay', () => {
    const out = suggestionsAsContractorPay([
      suggestPay(log({ contractor_name: 'Al' }), { default_hourly_rate: 60 }),
      suggestPay(log({ contractor_name: 'Zeb' }), { default_hourly_rate: 50 }),
    ]);
    expect(out).toEqual({ Al: 240, Zeb: 200 });
  });

  it('omits a tech with no amount rather than paying them zero', () => {
    const out = suggestionsAsContractorPay([
      suggestPay(log({ contractor_name: 'Al', checked_out_at: null }), { default_hourly_rate: 60 }),
    ]);
    expect(out).toEqual({});
  });
});

describe('payVariance', () => {
  it('shows where the recorded pay and the logged hours disagree', () => {
    const v = payVariance(
      { 'Jere Jones': 200 },
      [suggestPay(log(), { default_hourly_rate: 55 })],
    );
    expect(v).toEqual([{ contractorName: 'Jere Jones', current: 200, suggested: 220, delta: 20 }]);
  });

  it('lists techs present on only one side', () => {
    const v = payVariance({ Ghost: 100 }, [suggestPay(log({ contractor_name: 'New' }), { default_hourly_rate: 50 })]);
    expect(v.find((x) => x.contractorName === 'Ghost')).toMatchObject({ current: 100, suggested: null, delta: null });
    expect(v.find((x) => x.contractorName === 'New')).toMatchObject({ current: null, suggested: 200, delta: null });
  });
});
