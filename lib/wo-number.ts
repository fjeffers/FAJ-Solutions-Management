// Picking the next work order number.
//
// There is one rule, used by every path that creates a job: continue from the
// highest number in use, and skip anything already taken. The work order
// screen, the site log's convert-to-work-order, and the import queue all call
// the same function, so a job's number does not depend on which door it came
// through.
//
// That mattered on 2026-08-30. Each door had grown its own numbering, and one
// of them handed 19101358 to a new Swedesboro job while a closed Wendy's FOX
// STREET job already had it. Payments find their job by matching the number,
// so $179.95 belonging to Bryant Knight and Davis Sanders immediately read as
// money paid on a $55 job nobody had worked yet.
//
// Two guards sit under this now. migration-078 makes a number unique per
// owner, so the database refuses a collision whatever code asks for it.
// migration-079 makes a rename carry the job's payments, expenses and
// materials with it, so changing a number can no longer strand money.
//
// On the numbers themselves: FAJ's sequence came from an early import that
// stored a FieldNation ticket (19101298) in wo_number. Every internal job
// since has continued that range, and FAJ's paperwork follows it, so the
// sequence carries on from wherever it actually is rather than restarting.

/** Where the sequence starts when there are no numbered jobs at all. */
export const FIRST_WO_NUMBER = 1001;

/**
 * The next free work order number.
 *
 * Continues from the highest number in use and steps over anything already
 * taken, so the same number is never handed out twice.
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
