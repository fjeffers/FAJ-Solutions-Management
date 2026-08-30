// Picking the next work order number.
//
// FAJ's own numbering drifted. An early import stored a FieldNation ticket
// (19101298) in wo_number, and because the next number was "highest + 1", every
// internal job since inherited that range — 19101299, 19101300, and on. All 61
// existing work orders are 8 digits, including ones FAJ raised itself.
//
// So the sequence is confined to a band. FAJ numbers live below 1,000,000;
// anything above is an imported ticket and is ignored when picking the next one.
// Nothing is lost by ignoring them — the platform's own reference is already
// stored separately in external_wo_id.

/** Below this is FAJ's own sequence; at or above it is an imported ticket. */
export const OWN_NUMBER_CEILING = 1_000_000;

/** Where the sequence starts when there are no FAJ-numbered jobs yet. */
export const FIRST_WO_NUMBER = 1001;

/**
 * Next number in FAJ's own sequence.
 *
 * Skips anything already taken, so a manually typed number can't be handed out
 * twice, and ignores imported ticket numbers entirely.
 */
export function nextWorkOrderNumber(existing: (string | null | undefined)[]): string {
  const taken = new Set((existing ?? []).map((n) => (n ?? '').trim()).filter(Boolean));

  const own = [...taken]
    .filter((n) => /^\d+$/.test(n))
    .map(Number)
    .filter((n) => n >= FIRST_WO_NUMBER && n < OWN_NUMBER_CEILING);

  let next = own.length > 0 ? Math.max(...own) + 1 : FIRST_WO_NUMBER;
  while (taken.has(String(next))) next += 1;
  return String(next);
}

/**
 * The next free number continuing FAJ's live sequence.
 *
 * Differs from `nextWorkOrderNumber` above on purpose. That one deliberately
 * restarts a clean sequence at 1001 and ignores the imported 8-digit range;
 * this one carries on from whatever the highest number actually is, which is
 * what the work order screen has always done and what the numbering on FAJ's
 * paperwork follows.
 *
 * What it adds is the missing safety: it skips every number already in use.
 * A plain "highest + 1" handed out 19101358 twice on 2026-08-30 — once to a
 * closed Wendy's FOX STREET job and again to a new Swedesboro job — and
 * because payments join by number, $179.95 of Bryant Knight's and Davis
 * Sanders' pay crossed onto a $55 job that had never been worked.
 *
 * The unique index from migration-078 is the real guarantee. This keeps the
 * app from walking into it.
 */
export function nextFreeWorkOrderNumber(existing: (string | null | undefined)[]): string {
  const taken = new Set((existing ?? []).map((n) => (n ?? '').trim()).filter(Boolean));

  const numeric = [...taken]
    .filter((n) => /^\d+$/.test(n))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n));

  let next = numeric.length > 0 ? Math.max(...numeric) + 1 : FIRST_WO_NUMBER;
  while (taken.has(String(next))) next += 1;
  return String(next);
}
