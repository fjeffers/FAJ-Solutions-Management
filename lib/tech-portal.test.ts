import { describe, it, expect } from 'vitest';
import { splitJobs, paymentsTotal, paymentsByYear, jobLocation } from './tech-portal';
import type { TechJob, TechPayment } from './types';

const job = (over: Partial<TechJob> = {}): TechJob => ({
  id: 'w1', wo_number: '1001', title: 'Camera swap', description: null, scope_of_work: null,
  service_type: null, wo_status: 'Open', customer_name: 'Wendys', project_name: null,
  site_name: 'Easton', site_address: null, site_city: 'Easton', site_state: 'PA', site_zip: null,
  start_date: null, end_date: null, scheduled_date: null,
  checked_in_at: null, checked_out_at: null, hours_worked: null, closeout_notes: null,
  archived_at: null, is_closed: false, created_at: '2026-08-01T00:00:00Z', ...over,
});

const pay = (over: Partial<TechPayment> = {}): TechPayment => ({
  id: 'p1', payment_date: '2026-08-01', amount: 100, method: 'Zelle', notes: null,
  wo_number: '1001', wo_title: 'Camera swap', wo_site: 'Easton', wo_id: 'w1', ...over,
});

describe('splitting jobs', () => {
  it('separates active work from history', () => {
    const { active, past } = splitJobs([
      job({ id: 'a', is_closed: false }),
      job({ id: 'b', is_closed: true }),
      job({ id: 'c', is_closed: true }),
    ]);
    expect(active.map((j) => j.id)).toEqual(['a']);
    expect(past.map((j) => j.id)).toEqual(['b', 'c']);
  });

  it('handles an empty list', () => {
    expect(splitJobs([])).toEqual({ active: [], past: [] });
  });
});

describe('payment totals', () => {
  it('sums amounts', () => {
    expect(paymentsTotal([pay({ amount: 100 }), pay({ id: 'p2', amount: 250.5 })])).toBeCloseTo(350.5, 2);
  });

  it('treats a bad amount as zero rather than NaN', () => {
    expect(paymentsTotal([pay({ amount: NaN }), pay({ id: 'p2', amount: 50 })])).toBe(50);
  });

  it('is zero for no payments', () => {
    expect(paymentsTotal([])).toBe(0);
  });
});

describe('payments by year', () => {
  it('buckets by calendar year, newest first, with per-year totals', () => {
    const years = paymentsByYear([
      pay({ id: 'a', payment_date: '2025-03-01', amount: 100 }),
      pay({ id: 'b', payment_date: '2026-01-15', amount: 200 }),
      pay({ id: 'c', payment_date: '2026-08-01', amount: 300 }),
    ]);
    expect(years.map((y) => y.year)).toEqual(['2026', '2025']);
    expect(years[0].total).toBe(500);
    expect(years[0].payments).toHaveLength(2);
    expect(years[1].total).toBe(100);
  });

  it('sorts undated payments last instead of dropping them', () => {
    const years = paymentsByYear([
      pay({ id: 'a', payment_date: null, amount: 40 }),
      pay({ id: 'b', payment_date: '2026-01-01', amount: 60 }),
    ]);
    expect(years.map((y) => y.year)).toEqual(['2026', 'Undated']);
    expect(years[1].total).toBe(40);
  });

  it('returns nothing for no payments', () => {
    expect(paymentsByYear([])).toEqual([]);
  });
});

describe('job location', () => {
  it('joins site and city/state', () => {
    expect(jobLocation({ site_name: 'Easton', site_city: 'Easton', site_state: 'PA' })).toBe('Easton · Easton, PA');
  });

  it('skips missing pieces without leaving stray separators', () => {
    expect(jobLocation({ site_name: null, site_city: 'Easton', site_state: 'PA' })).toBe('Easton, PA');
    expect(jobLocation({ site_name: 'Easton', site_city: null, site_state: null })).toBe('Easton');
    expect(jobLocation({ site_name: null, site_city: null, site_state: null })).toBe('');
  });
});
