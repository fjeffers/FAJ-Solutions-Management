import { describe, expect, it } from 'vitest';
import { billableAddons, billableExtras, contractorOwedOnWO, seedPayLines, withClientPrice, woPayoutTotal, woProfit, woTechPayTotal } from './utils';
import type { PayAddon, WorkOrder } from './types';

// Opening a job in Edit job and pressing Save must change no money. These are
// real jobs from the live data (Oct 2026), before and after a save.
const job = (over: Partial<WorkOrder>): WorkOrder => ({
  wo_number: 'x', contractor_name: 'Jere Jones', contractor_names: null,
  total_amount: 0, contractor_pay: null, pay_type: 'Fixed',
  billable_travel: null, billable_materials: null, billable_other: null,
  hours_worked: null, hourly_rate: null,
  pay_addons: [], mileage_logs: [], materials_used: [],
  ...over,
} as unknown as WorkOrder);

/** What the form saves: its lines, and a price equal to the billed lines. */
function saved(w: WorkOrder): WorkOrder {
  const lines = seedPayLines(w);
  const price = lines.length > 0 ? billableAddons(lines) : Number(w.total_amount);
  return { ...w, pay_addons: lines, total_amount: price };
}

function expectNoMoneyChange(before: WorkOrder) {
  const after = saved(before);
  expect(Number(after.total_amount)).toBe(Number(before.total_amount));
  expect(billableExtras(after)).toBe(billableExtras(before));
  expect(woTechPayTotal(after)).toBe(woTechPayTotal(before));
  expect(woPayoutTotal(after)).toBe(woPayoutTotal(before));
  expect(woProfit(after)).toBe(woProfit(before));
  expect(contractorOwedOnWO(after, 'Jere Jones')).toBe(contractorOwedOnWO(before, 'Jere Jones'));
  return after;
}

describe('opening an older job and saving it changes no money', () => {
  it('fixed price with client travel (WO 19101335) keeps its $233.85 price', () => {
    // Before the fix the form started this job from its travel alone and would
    // have saved $123.85 as the whole price.
    const after = expectNoMoneyChange(job({ total_amount: 233.85, billable_travel: 123.85, contractor_pay: { 'Jere Jones': 150 } }));
    expect(after.pay_addons.map((a) => [a.kind, a.amount])).toEqual([['labour', 110], ['mileage', 123.85]]);
  });

  it('hourly with travel (WO 19101348) shows 2 h × $55 plus travel', () => {
    const after = expectNoMoneyChange(job({ pay_type: 'Hourly', total_amount: 168.7, billable_travel: 58.7, hours_worked: 2, hourly_rate: 55 }));
    const labour = after.pay_addons[0];
    expect([labour.qty, labour.rate, labour.pay_tech]).toEqual([2, 55, false]);
  });

  it('a job with an old expense budget (WO 19101337) is not raised by it', () => {
    // The budget used to come in as a billed line: $330 would have saved as $375.
    expectNoMoneyChange(job({ pay_type: 'Hourly', total_amount: 330, hours_worked: 6, hourly_rate: 55, expense_budget: 45 } as Partial<WorkOrder>));
  });

  it('client materials not in the price (WO 19101362) stay as they were', () => {
    expectNoMoneyChange(job({ pay_type: 'Hourly', total_amount: 336.75, billable_travel: 61.75, billable_materials: 40, hours_worked: 5, hourly_rate: 55 }));
  });

  it('a $0 job with old tech travel (WO 19101291) stays $0', () => {
    const after = expectNoMoneyChange(job({ total_amount: 0, travel_amount: 60 } as Partial<WorkOrder>));
    expect(after.pay_addons).toEqual([]);
  });

  it('a job whose old figures do not add up is left alone', () => {
    const after = expectNoMoneyChange(job({ total_amount: 50, billable_travel: 80 }));
    expect(after.pay_addons).toEqual([]);
  });

  it('with no tech pay agreed, the tech share is still the price less the client travel', () => {
    expectNoMoneyChange(job({ total_amount: 1138.25, billable_travel: 47.6, contractor_pay: null }));
  });

  it('after an approved expense, saving keeps the price and the payback', () => {
    const expense: PayAddon = { id: 'exp_1', kind: 'materials', label: 'Parts & materials', amount: 42.17, qty: null, rate: null, deduct: false, bill_client: false, pay_tech: true, contractor_name: 'Jere Jones' };
    const travel: PayAddon = { id: 'legacy_travel', kind: 'mileage', label: 'Travel (billed to client)', amount: 91.3, qty: null, rate: null, deduct: false, bill_client: true, pay_tech: false, contractor_name: null };
    const after = expectNoMoneyChange(job({ total_amount: 201.3, pay_addons: [travel, expense], contractor_pay: { 'Jere Jones': 120 } }));
    expect(after.pay_addons.find((a) => a.kind === 'labour')?.amount).toBe(110);
  });

  it('a job that already has a Labour line is left exactly as it is', () => {
    const lines: PayAddon[] = [{ id: 'l', kind: 'labour', label: 'Labour', amount: 0, qty: 2, rate: 55, deduct: false, bill_client: true, pay_tech: false }];
    expect(seedPayLines(job({ total_amount: 110, pay_addons: lines }))).toEqual(lines);
  });

  it('adding a toll to an older job now raises the price by the toll, not replaces it', () => {
    const lines = seedPayLines(job({ total_amount: 233.85, billable_travel: 123.85 }));
    const toll: PayAddon = { id: 't', kind: 'tolls_parking', label: 'Tolls', amount: 12, qty: null, rate: null, deduct: false, bill_client: true, pay_tech: true };
    expect(billableAddons([...lines, toll])).toBe(245.85);
  });
});

describe('changing the client price in place', () => {
  const travel: PayAddon = { id: 'legacy_travel', kind: 'mileage', label: 'Travel (billed to client)', amount: 91.3, qty: null, rate: null, deduct: false, bill_client: true, pay_tech: false, contractor_name: null };
  const expense: PayAddon = { id: 'exp_1', kind: 'materials', label: 'Parts', amount: 42.17, qty: null, rate: null, deduct: false, bill_client: false, pay_tech: true, contractor_name: 'Jere Jones' };

  it('a job with no lines just takes the new price', () => {
    expect(withClientPrice(job({ total_amount: 200 }), 250)).toEqual({ total_amount: 250 });
  });

  it('moves only the Labour line, so the extras and the tech pay stay put', () => {
    const before = saved(job({ total_amount: 201.3, pay_addons: [travel, expense], contractor_pay: { 'Jere Jones': 120 } }));
    const patch = withClientPrice(before, 300)!;
    const after = { ...before, ...patch } as WorkOrder;
    expect(Number(after.total_amount)).toBe(300);
    expect(billableAddons(after.pay_addons)).toBe(300);          // the form will read the same price
    expect(billableExtras(after)).toBe(billableExtras(before));  // travel unchanged
    expect(contractorOwedOnWO(after, 'Jere Jones')).toBe(contractorOwedOnWO(before, 'Jere Jones'));
    expect(woProfit(after)).toBe(r2(woProfit(before) + 98.7));
  });

  it('adds a Labour line to lines that have none', () => {
    const patch = withClientPrice(job({ total_amount: 91.3, pay_addons: [travel] }), 201.3)!;
    expect(patch.pay_addons!.map((a) => [a.kind, a.amount, a.pay_tech])).toEqual([['labour', 110], ['mileage', 91.3]].map(([k, v]) => [k, v, false]));
  });

  it('refuses when the Labour line is also the tech pay', () => {
    const paid: PayAddon = { id: 'l', kind: 'labour', label: 'Labour', amount: 0, qty: 2, rate: 55, deduct: false, bill_client: true, pay_tech: true };
    expect(withClientPrice(job({ total_amount: 110, pay_addons: [paid] }), 150)).toBeNull();
  });

  it('refuses a price below the extras, or nonsense', () => {
    expect(withClientPrice(job({ total_amount: 201.3, pay_addons: [travel] }), 50)).toBeNull();
    expect(withClientPrice(job({ total_amount: 1 }), -5)).toBeNull();
    expect(withClientPrice(job({ total_amount: 1 }), Number.NaN)).toBeNull();
  });
});

const r2 = (n: number) => Math.round(n * 100) / 100;
