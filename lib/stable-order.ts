// A row of quick-pick buttons that stays put (Fred, 2026-11-02: "when i trying to
// edit they time sheet and jumping from sheet to sheet it keeps jumping back and
// forth"). Editing a sheet moved its button to the front, so every other button
// shifted and the next tap opened the wrong sheet. A button keeps its place while
// the screen is open; a new one goes on the end, a gone one drops out.
import { useState } from 'react';

/** `next` in the order of `before`, with anything new after it in its own order. */
export function keepOrder(before: string[], next: string[]): string[] {
  const now = new Set(next);
  const kept = before.filter((id) => now.has(id));
  const had = new Set(kept);
  return [...kept, ...next.filter((id) => !had.has(id))];
}

/** The items in the order first shown, for as long as the component is up. */
export function useStableOrder<T>(items: T[], id: (t: T) => string): T[] {
  const ids = items.map(id);
  const [order, setOrder] = useState<string[]>(ids);
  const next = keepOrder(order, ids);
  if (next.join('|') !== order.join('|')) setOrder(next);
  const byId = new Map(items.map((t) => [id(t), t]));
  return next.map((k) => byId.get(k)).filter((t): t is T => t !== undefined);
}
