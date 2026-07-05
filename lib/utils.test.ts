import { describe, it, expect } from 'vitest';
import { enrichWorkOrders, getStatus, fmtMoney } from './utils';
import type { WorkOrder, Payment } from './types';

// Minimal builders — only the fields the money math actually reads.
const wo = (over: Partial<WorkOrder>): WorkOrder =>
  ({ wo_number: '1001', total_amount: 100, created_at: '2026-01-01T00:00:00Z', ...over } as WorkOrder);

const pay = (over: Partial<Payment>): Payment =>
  ({ wo_number: '1001', amount: 0, payment_date: '2026-01-02', ...over } as Payment);

describe('enrichWorkOrders', () => {
  it('marks a WO with no payments as pending with full amount remaining', () => {
    const [e] = enrichWorkOrders([wo({ total_amount: 500 })], []);
    expect(e.payment_status).toBe('pending');
    expect(e.paid).toBe(0);
    expect(e.remaining).toBe(500);
  });

  it('marks a partially paid WO as partial and tracks remaining', () => {
    const [e] = enrichWorkOrders([wo({ total_amount: 500 })], [pay({ amount: 200 })]);
    expect(e.payment_status).toBe('partial');
    expect(e.paid).toBe(200);
    expect(e.remaining).toBe(300);
  });

  it('sums multiple payments for the same WO', () => {
    const [e] = enrichWorkOrders(
      [wo({ total_amount: 500 })],
      [pay({ amount: 200 }), pay({ amount: 150 }), pay({ amount: 150 })],
    );
    expect(e.payment_status).toBe('paid');
    expect(e.paid).toBe(500);
    expect(e.remaining).toBe(0);
  });

  it('never reports negative remaining on overpayment', () => {
    const [e] = enrichWorkOrders([wo({ total_amount: 100 })], [pay({ amount: 150 })]);
    expect(e.payment_status).toBe('paid');
    expect(e.remaining).toBe(0);
  });

  it('only counts payments matching the WO number', () => {
    const [a, b] = enrichWorkOrders(
      [wo({ wo_number: '1001', total_amount: 100, created_at: '2026-01-02T00:00:00Z' }),
       wo({ wo_number: '1002', total_amount: 100, created_at: '2026-01-01T00:00:00Z' })],
      [pay({ wo_number: '1002', amount: 100 })],
    );
    // sorted newest-first: a = 1001, b = 1002
    expect(a.wo_number).toBe('1001');
    expect(a.payment_status).toBe('pending');
    expect(b.payment_status).toBe('paid');
  });

  it('handles string amounts from the database', () => {
    const [e] = enrichWorkOrders(
      [wo({ total_amount: 300 })],
      [pay({ amount: '100.50' as unknown as number }), pay({ amount: '99.50' as unknown as number })],
    );
    expect(e.paid).toBe(200);
    expect(e.payment_status).toBe('partial');
    expect(e.remaining).toBe(100);
  });

  it('sorts newest first by created_at', () => {
    const list = enrichWorkOrders(
      [wo({ wo_number: '1001', created_at: '2026-01-01T00:00:00Z' }),
       wo({ wo_number: '1003', created_at: '2026-03-01T00:00:00Z' }),
       wo({ wo_number: '1002', created_at: '2026-02-01T00:00:00Z' })],
      [],
    );
    expect(list.map((w) => w.wo_number)).toEqual(['1003', '1002', '1001']);
  });
});

describe('getStatus', () => {
  it('matches enrichWorkOrders status logic at the boundaries', () => {
    const order = wo({ total_amount: 100 });
    expect(getStatus(order, [])).toBe('pending');
    expect(getStatus(order, [pay({ amount: 99.99 })])).toBe('partial');
    expect(getStatus(order, [pay({ amount: 100 })])).toBe('paid');
  });
});

describe('fmtMoney', () => {
  it('formats dollars and cents', () => {
    expect(fmtMoney(1234.5)).toBe('$1,234.50');
    expect(fmtMoney(0)).toBe('$0.00');
    expect(fmtMoney(null)).toBe('$0.00');
  });
});
