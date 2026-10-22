// Expenses on any job (migration-103; Fred, 2026-10-02: "build the expenses
// next"). A tech records a receipt on their job; Fred approves or declines.
// Approving adds one pay add-on line in the database (wf_owner_decide_expense)
// — paid to that tech, not billed to the client — so every money figure
// comes from lib/utils as before. Pure helpers here, tested in expenses.test.ts.

/** The built-in categories. Keys never change, so old receipts keep theirs ('hotel' shows as Lodging). */
export type BuiltinCategory = 'mileage' | 'meals' | 'hotel' | 'travel' | 'labor' | 'materials' | 'rental'
  | 'fuel' | 'tolls_parking' | 'equipment' | 'other';
/** A built-in key, or one the office added (c_…, migration 136). */
export type ExpenseCategory = string;
export type ExpenseStatus = 'submitted' | 'approved' | 'declined';
export type CategoryOption = { key: ExpenseCategory; label: string };

/** Fred's list first (2026-10-21: "Mileage, Meals, Lodging, Travel, Labor, Materials, Rental"), then the ones receipts already used. */
export const EXPENSE_CATEGORIES: { key: BuiltinCategory; label: string }[] = [
  { key: 'mileage', label: 'Mileage' },
  { key: 'meals', label: 'Meals' },
  { key: 'hotel', label: 'Lodging' },
  { key: 'travel', label: 'Travel' },
  { key: 'labor', label: 'Labor' },
  { key: 'materials', label: 'Materials' },
  { key: 'rental', label: 'Rental' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'tolls_parking', label: 'Tolls & parking' },
  { key: 'equipment', label: 'Tools & equipment' },
  { key: 'other', label: 'Other' },
];

// The office's own categories, once loaded (lib/use-expense-categories.ts), so
// every label on screen follows them without passing the list around.
let customCategories: CategoryOption[] = [];
export function setCustomExpenseCategories(list: CategoryOption[]) { customCategories = list; }

/** "c_tool_rental" → "Tool rental": a custom key reads well even before the list loads. */
export function customKeyLabel(key: string): string {
  const words = key.replace(/^c_/, '').replace(/_+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Other';
}

export const expenseCategoryLabel = (k: string) =>
  EXPENSE_CATEGORIES.find((c) => c.key === k)?.label
  ?? customCategories.find((c) => c.key === k)?.label
  ?? (k.startsWith('c_') ? customKeyLabel(k) : 'Other');

/** The key the database gives a new category (wf_owner_add_expense_category): "Tool rental" → c_tool_rental. */
export function customCategoryKey(label: string): string | null {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/, '');
  return slug ? `c_${slug}` : null;
}

/** Receipts → total per category: the built-in order first, then any other category in the order it appears. */
export function totalsByCategory(receipts: { category: string; amount: number | string }[]): { key: string; label: string; sum: number }[] {
  const keys = [...EXPENSE_CATEGORIES.map((c) => c.key as string)];
  for (const r of receipts) if (!keys.includes(r.category)) keys.push(r.category);
  return keys
    .map((key) => ({ key, label: expenseCategoryLabel(key), sum: Math.round(receipts.filter((r) => r.category === key).reduce((t, r) => t + Number(r.amount), 0) * 100) / 100 }))
    .filter((c) => c.sum > 0);
}

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
    case 'bad_label': return 'Type a name for the category.';
    case 'too_many': return 'There are already 50 of your own categories. Hide one you no longer use first.';
    case 'closed_or_not_yours': return 'That job is closed or no longer yours.';
    case 'not_owner': return 'Only Fred can approve expenses.';
    case 'not_found': return 'That expense was not found.';
    case 'office_expense': return 'You added this receipt yourself, so there is nothing to approve.';
    case 'bad_file': return 'That receipt file could not be used.';
    default: return "That didn't go through. Try again.";
  }
}
