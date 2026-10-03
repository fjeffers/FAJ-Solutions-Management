// Expenses on any job (migration-103; Fred, 2026-10-02: "build the expenses
// next"). A tech records a receipt on their job; Fred approves or declines.
// Approving adds one pay add-on line in the database (wf_owner_decide_expense)
// — paid to that tech, not billed to the client — so every money figure
// comes from lib/utils as before. Pure helpers here, tested in expenses.test.ts.

export type ExpenseCategory = 'materials' | 'fuel' | 'tolls_parking' | 'equipment' | 'meals' | 'other';
export type ExpenseStatus = 'submitted' | 'approved' | 'declined';

export const EXPENSE_CATEGORIES: { key: ExpenseCategory; label: string }[] = [
  { key: 'materials', label: 'Parts & materials' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'tolls_parking', label: 'Tolls & parking' },
  { key: 'equipment', label: 'Tools & equipment rental' },
  { key: 'meals', label: 'Meals' },
  { key: 'other', label: 'Other' },
];

export const expenseCategoryLabel = (k: string) => EXPENSE_CATEGORIES.find((c) => c.key === k)?.label ?? 'Other';

export const EXPENSE_STATUS: Record<ExpenseStatus, { label: string; color: string; bg: string }> = {
  submitted: { label: 'Waiting for Fred', color: '#B45309', bg: 'rgba(180,83,9,0.12)' },
  approved: { label: 'Approved', color: '#047857', bg: 'rgba(4,120,87,0.12)' },
  declined: { label: 'Declined', color: '#C62828', bg: 'rgba(198,40,40,0.1)' },
};

/** "$42.17", "42.17", "42" → 42.17; anything else (or out of range) → null. */
export function parseExpenseAmount(raw: string): number | null {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n >= 10000) return null;
  return Math.round(n * 100) / 100;
}

/** Plain words for the database's reasons. */
export function expenseReasonText(reason: string): string {
  switch (reason) {
    case 'bad_amount': return 'Enter the amount on the receipt.';
    case 'bad_date': return 'That date is too far back or in the future.';
    case 'bad_category': return 'Pick what the expense was for.';
    case 'closed_or_not_yours': return 'That job is closed or no longer yours.';
    case 'not_owner': return 'Only Fred can approve expenses.';
    case 'not_found': return 'That expense was not found.';
    default: return "That didn't go through. Try again.";
  }
}
