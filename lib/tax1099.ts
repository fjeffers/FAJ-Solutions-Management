// When a tech needs a 1099-NEC — one rule for the owner's 1099 screen and the
// accountant's, so the two can never disagree.
//
// The federal threshold was $600 for decades. The One Big Beautiful Bill Act
// (signed July 4, 2025) raised it to $2,000 for payments made after
// December 31, 2025, with inflation indexing starting in 2027. The IRS
// publishes the indexed figure each year; until it does, $2,000 is the floor
// and the screens say to confirm the number. State rules can differ.

export function form1099Threshold(year: number): number {
  return year <= 2025 ? 600 : 2000;
}

/** True when the year's threshold is the indexed one the IRS has yet to confirm here. */
export function thresholdNeedsCheck(year: number): boolean {
  return year >= 2027;
}

/** Paid at or above the year's threshold. Cents-safe: compares rounded dollars and cents. */
export function needs1099(paid: number, year: number): boolean {
  return Math.round(paid * 100) >= form1099Threshold(year) * 100;
}

/** "SSN •••-••-6789" style, from the last four digits. */
export function maskTaxId(type: string | null | undefined, last4: string | null | undefined): string {
  if (!last4) return '';
  const kind = (type ?? '').toUpperCase();
  const masked = kind === 'EIN' ? `••-•••${last4}` : `•••-••-${last4}`;
  return kind ? `${kind} ${masked}` : masked;
}
