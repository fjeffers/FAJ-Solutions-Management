// Moving a job from one tech to another.
//
// The naive version — overwrite contractor_name — is wrong in three ways that
// all cost money, so this works out the whole change and is unit-tested.
//
//  1. Money already PAID does not move. If Jere was paid $120 before the job
//     changed hands, that $120 is his: he did the work he was paid for. His
//     allocation is left standing at exactly what he received, so the payment
//     still has a job to belong to and the books balance.
//
//  2. Only the UNPAID remainder transfers. The new tech is owed what is left,
//     not the whole figure, or the job would be paid for twice.
//
//  3. The new tech has not agreed to anything. The old tech's accept/decline
//     is dropped so the job reads as awaiting an answer again, rather than
//     inheriting someone else's yes.
//
// Time logs are deliberately untouched. Hours already logged are a record of
// who was on site, and rewriting them would be rewriting history.
import type { Payment, WorkOrder } from './types';
import { contractorShareOfWO } from './utils';

export type Reassignment = {
  contractor_name: string;
  contractor_names: string[];
  lead_contractor_name: string | null;
  contractor_pay: Record<string, number>;
  assignment_responses: Record<string, unknown> | null;
  /** What the outgoing tech keeps, because they were already paid it. */
  keptByOutgoing: number;
  /** What moves to the incoming tech. */
  movedToIncoming: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What this tech has actually been paid on this job. */
export function paidToTechOnWO(
  payments: Pick<Payment, 'wo_number' | 'contractor_name' | 'amount'>[],
  woNumber: string,
  name: string,
): number {
  return round2(payments
    .filter((p) => p.wo_number === woNumber && p.contractor_name === name)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
}

/**
 * The full patch for handing a job from one tech to another.
 *
 * Returns null when the move is not possible — the outgoing tech is not on the
 * job, the two are the same person, or the incoming tech is already on it —
 * so the caller says why rather than writing a no-op.
 */
export function reassignWorkOrder(
  wo: WorkOrder,
  payments: Pick<Payment, 'wo_number' | 'contractor_name' | 'amount'>[],
  from: string,
  to: string,
): Reassignment | null {
  const outgoing = from.trim();
  const incoming = to.trim();
  if (!outgoing || !incoming || outgoing === incoming) return null;

  const names = (wo.contractor_names && wo.contractor_names.length > 0)
    ? [...wo.contractor_names]
    : (wo.contractor_name ? [wo.contractor_name] : []);
  if (!names.includes(outgoing)) return null;
  if (names.includes(incoming)) return null;

  // What the outgoing tech was allocated, and what they have already had.
  const allocated = contractorShareOfWO(wo, outgoing);
  const alreadyPaid = paidToTechOnWO(payments, wo.wo_number, outgoing);
  const kept = Math.min(allocated, alreadyPaid);
  const moves = round2(Math.max(0, allocated - kept));

  // Keep the crew's order — the first name is the lead.
  const nextNames = names.map((n) => (n === outgoing ? incoming : n));
  // A tech who was paid stays on the job for their share; one who was not
  // simply leaves it.
  if (kept > 0) nextNames.splice(names.indexOf(outgoing), 0, outgoing);

  // Rebuild the pay map explicitly. Reading contractorShareOfWO for every name
  // means a legacy job with no map at all still comes out with a real one.
  const pay: Record<string, number> = {};
  for (const n of nextNames) {
    if (n === outgoing) { pay[n] = round2(kept); continue; }
    if (n === incoming) { pay[n] = moves; continue; }
    pay[n] = round2(contractorShareOfWO(wo, n));
  }

  // The incoming tech has not answered yet, and the outgoing tech's answer is
  // no longer about a job that is theirs.
  const responses = { ...(wo.assignment_responses ?? {}) } as Record<string, unknown>;
  delete responses[outgoing];
  delete responses[incoming];

  return {
    contractor_name: nextNames[0] ?? '',
    contractor_names: nextNames,
    lead_contractor_name: nextNames[0] ?? null,
    contractor_pay: pay,
    assignment_responses: Object.keys(responses).length > 0 ? responses : null,
    keptByOutgoing: round2(kept),
    movedToIncoming: moves,
  };
}

/** One line telling Fred what the move will actually do, before he confirms. */
export function describeReassignment(r: Reassignment, from: string, to: string): string {
  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  if (r.keptByOutgoing > 0) {
    return `${from} keeps ${money(r.keptByOutgoing)} already paid and stays on the job for that. `
      + `${to} takes over the remaining ${money(r.movedToIncoming)}.`;
  }
  return `${from} comes off the job. ${to} takes it on for ${money(r.movedToIncoming)}.`;
}
