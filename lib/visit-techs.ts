// Who was on site. A record of the crew, not a money calculation — adding a
// second tech to a visit does not change what the client is billed. Payouts
// still run through work_orders.contractor_pay.
import type { SiteVisit } from './types';

export interface Tech {
  id: string;
  name: string;
}

/**
 * The crew on a visit, lead first.
 *
 * Reads tech_ids, falling back to the older single contractor_id so a visit
 * saved before migration 058 still shows its tech. Unknown ids are dropped
 * rather than rendered as a blank chip — a contractor can be deleted while
 * the visits they worked stay on the books.
 */
export function techsOn(
  visit: Pick<SiteVisit, 'tech_ids' | 'contractor_id'>,
  roster: Tech[],
): Tech[] {
  const ids = visit.tech_ids?.length
    ? visit.tech_ids
    : (visit.contractor_id ? [visit.contractor_id] : []);
  const byId = new Map(roster.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is Tech => !!t);
}

/** "Ana Reyes", "Ana Reyes +1", "Ana Reyes +2" — fits a card without wrapping. */
export function techSummary(techs: Tech[]): string {
  if (techs.length === 0) return '';
  if (techs.length === 1) return techs[0].name;
  return `${techs[0].name} +${techs.length - 1}`;
}

/** Every name, for a tooltip or a spreadsheet cell. */
export const techNames = (techs: Tech[]): string => techs.map((t) => t.name).join(', ');

/**
 * Normalise a crew before saving.
 *
 * Order is meaningful — the first tech is the lead — so duplicates collapse
 * onto their first appearance rather than the list being sorted.
 * contractor_id is kept pointing at the lead so everything still reading it
 * keeps working.
 */
export function normalizeCrew(ids: (string | null | undefined)[]): {
  tech_ids: string[];
  contractor_id: string | null;
} {
  const seen = new Set<string>();
  const tech_ids: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    tech_ids.push(id);
  }
  return { tech_ids, contractor_id: tech_ids[0] ?? null };
}

/** Add or remove one tech, preserving the order of the rest. */
export function toggleTech(current: string[], id: string): string[] {
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}
