// The office Schedule's card view: dated jobs grouped Earlier / Today /
// Tomorrow / Next 7 days / Later (Fred: "Schedule needs to be a card view").

export type CardGroupKey = 'earlier' | 'today' | 'tomorrow' | 'week' | 'later';
export type CardGroup<T> = { key: CardGroupKey; label: string; items: T[] };

const LABELS: Record<CardGroupKey, string> = {
  earlier: 'Earlier, not done',
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'Next 7 days',
  later: 'Later',
};

/** YYYY-MM-DD plus n days. */
export function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

/**
 * Dated items in their group, in the order given (sort them first).
 * Past items show only while still open; empty groups are left out.
 */
export function scheduleCardGroups<T>(
  items: T[],
  today: string,
  dateOf: (item: T) => string | null | undefined,
  isOpen: (item: T) => boolean,
): CardGroup<T>[] {
  const tomorrow = plusDays(today, 1);
  const weekEnd = plusDays(today, 7);
  const out = new Map<CardGroupKey, T[]>();
  for (const item of items) {
    const d = dateOf(item);
    if (!d) continue;
    const key: CardGroupKey | null = d < today ? (isOpen(item) ? 'earlier' : null)
      : d === today ? 'today'
      : d === tomorrow ? 'tomorrow'
      : d <= weekEnd ? 'week'
      : 'later';
    if (!key) continue;
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return (Object.keys(LABELS) as CardGroupKey[])
    .filter((k) => out.has(k))
    .map((k) => ({ key: k, label: LABELS[k], items: out.get(k)! }));
}
