import { describe, it, expect } from 'vitest';
import { mileageReimbursement, totalMiles, mileageAcrossWOs } from './mileage';
import type { MileageLog } from './types';

const log = (over: Partial<MileageLog>): MileageLog =>
  ({ id: 'm1', contractor_name: 'Jere', miles: 0, rate: 0.7, note: null, ...over });

describe('mileage math', () => {
  it('computes miles x rate per row and sums', () => {
    const logs = [log({ miles: 42, rate: 0.7 }), log({ id: 'm2', miles: 10, rate: 0.5 })];
    expect(mileageReimbursement(logs)).toBeCloseTo(42 * 0.7 + 10 * 0.5, 2); // 34.40
    expect(totalMiles(logs)).toBe(52);
  });

  it('handles empty and null lists', () => {
    expect(mileageReimbursement(null)).toBe(0);
    expect(totalMiles(undefined)).toBe(0);
  });

  it('totals across work orders', () => {
    const result = mileageAcrossWOs([
      { mileage_logs: [log({ miles: 20 })] },
      { mileage_logs: [log({ miles: 30, rate: 0.6 })] },
      { mileage_logs: null },
    ]);
    expect(result.miles).toBe(50);
    expect(result.amount).toBeCloseTo(20 * 0.7 + 30 * 0.6, 2);
  });
});
