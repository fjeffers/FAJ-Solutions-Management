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
