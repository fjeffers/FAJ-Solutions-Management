import { afterEach, describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES, customCategoryKey, parseExpenseAmount, expenseCategoryLabel, expenseReasonText, setCustomExpenseCategories, totalsByCategory } from './expenses';
import { billableExtras, contractorOwedOnWO, woPayoutTotal, woProfit } from './utils';
import type { PayAddon, WorkOrder } from './types';

// The add-on lines exactly as wf_owner_decide_expense (migration-103) writes them.
const legacyTravel: PayAddon = {
  id: 'legacy_travel', kind: 'mileage', label: 'Travel (billed to client)', amount: 50, qty: null, rate: null,
  deduct: false, bill_client: true, pay_tech: false, contractor_name: null,
};
const expenseLine = (amount: number, tech: string): PayAddon => ({
  id: 'exp_1', kind: 'materials', label: 'Parts & materials — Home Depot (receipt Oct 02)', amount, qty: null, rate: null,
  deduct: false, bill_client: false, pay_tech: true, contractor_name: tech,
});

const r2 = (n: number) => Math.round(n * 100) / 100;

const job = (over: Partial<WorkOrder>): WorkOrder => ({
  wo_number: '1', contractor_name: 'Jere Jones', contractor_names: ['Jere Jones', 'Mutema Desouza'],
  total_amount: 500, contractor_pay: { 'Jere Jones': 150, 'Mutema Desouza': 150 },
  billable_travel: 50, billable_materials: null, billable_other: null,
  pay_addons: [], mileage_logs: [], materials_used: [],
  ...over,
} as unknown as WorkOrder);

describe('an approved expense and the money', () => {
  it('pays the tech back and changes nothing else — even on a job with old travel billing', () => {
    const before = job({});
    const after = job({ pay_addons: [legacyTravel, expenseLine(42.17, 'Mutema Desouza')] });

    // What the client is billed is unchanged (the old $50 travel is carried over).
    expect(billableExtras(after)).toBe(billableExtras(before));
    expect(billableExtras(after)).toBe(50);
    // Mutema is owed $42.17 more; Jere is owed exactly the same.
    expect(contractorOwedOnWO(after, 'Mutema Desouza')).toBe(r2(contractorOwedOnWO(before, 'Mutema Desouza') + 42.17));
    expect(contractorOwedOnWO(after, 'Jere Jones')).toBe(contractorOwedOnWO(before, 'Jere Jones'));
    // The job pays out $42.17 more, so FAJ keeps $42.17 less.
    expect(woPayoutTotal(after)).toBe(r2(woPayoutTotal(before) + 42.17));
    expect(woProfit(after)).toBe(r2(woProfit(before) - 42.17));
  });

  it('without the carry-over the old travel billing would have vanished (the trap it avoids)', () => {
    const naive = job({ pay_addons: [expenseLine(42.17, 'Mutema Desouza')] });
    expect(billableExtras(naive)).toBe(0);
  });
});

describe('expense entry', () => {
  it('reads amounts the way people type them', () => {
    expect(parseExpenseAmount('$42.17')).toBe(42.17);
    expect(parseExpenseAmount('1,250')).toBe(1250);
    expect(parseExpenseAmount('0')).toBeNull();
    expect(parseExpenseAmount('abc')).toBeNull();
    expect(parseExpenseAmount('12000')).toBeNull();
  });
  it('labels and reasons', () => {
    expect(expenseCategoryLabel('tolls_parking')).toBe('Tolls & parking');
    expect(expenseCategoryLabel('nope')).toBe('Other');
    expect(expenseReasonText('bad_amount')).toMatch(/amount/);
  });
});

describe('expense categories (migration 137)', () => {
  afterEach(() => setCustomExpenseCategories([]));
  it("puts Fred's list first, and old receipts keep their keys ('hotel' reads Lodging)", () => {
    expect(EXPENSE_CATEGORIES.slice(0, 7).map((c) => c.label)).toEqual(['Mileage', 'Meals', 'Lodging', 'Travel', 'Labor', 'Materials', 'Rental']);
    expect(expenseCategoryLabel('hotel')).toBe('Lodging');
    expect(expenseCategoryLabel('fuel')).toBe('Fuel');
  });
  it("labels the office's own categories, from the list or from the key before it loads", () => {
    expect(expenseCategoryLabel('c_tool_rental')).toBe('Tool rental');
    setCustomExpenseCategories([{ key: 'c_tool_rental', label: 'Tool Rental (Sunbelt)' }]);
    expect(expenseCategoryLabel('c_tool_rental')).toBe('Tool Rental (Sunbelt)');
  });
  it('makes the same key as the database', () => {
    expect(customCategoryKey('Tool rental')).toBe('c_tool_rental');
    expect(customCategoryKey('  Per-diem / Snacks!! ')).toBe('c_per_diem_snacks');
    expect(customCategoryKey('***')).toBeNull();
  });
  it('totals per category, the built-in order first, then the custom ones', () => {
    const totals = totalsByCategory([
      { category: 'c_tool_rental', amount: 40 }, { category: 'fuel', amount: '30.10' }, { category: 'mileage', amount: 12.5 }, { category: 'fuel', amount: 20 },
    ]);
    expect(totals).toEqual([
      { key: 'mileage', label: 'Mileage', sum: 12.5 },
      { key: 'fuel', label: 'Fuel', sum: 50.1 },
      { key: 'c_tool_rental', label: 'Tool rental', sum: 40 },
    ]);
  });
});
