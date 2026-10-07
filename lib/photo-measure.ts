// Measuring and counting on a photo (Fred, 2026-10-07, sending the iScanner
// app: "all the above for my tech to use").
//
// Measure: a phone's browser can't measure in 3D like iScanner's AR ruler, so
// the tech taps both ends of something whose length they know (a 2 ft ceiling
// tile, a 3 ft door, a tape measure laid down), then taps the ends of what
// they want measured. Lengths scale from that reference — accurate for things
// on the same flat surface, shot square-on.
//
// Pure and unit-tested; components/tools/PhotoMarkup.tsx draws it.

export type Pt = { x: number; y: number };
export const pxLength = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** Feet per pixel from a reference of known length; null until it's usable. */
export function scaleFrom(a: Pt, b: Pt, knownFeet: number): number | null {
  const px = pxLength(a, b);
  if (!(knownFeet > 0) || px < 4) return null;
  return knownFeet / px;
}

/**
 * A typed length in feet: "2", "2.5", "2'6", "2' 6\"", "30in", "30\"", "6 ft".
 * Null when it can't be read.
 */
export function parseLength(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/feet|foot|ft/g, "'").replace(/inches|inch|in/g, '"').replace(/\s+/g, ' ');
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"?)?$/);
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
  const inches = s.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (inches) return Number(inches[1]) / 12;
  const plain = s.match(/^\d+(?:\.\d+)?$/);
  if (plain) return Number(s);
  return null;
}

/** 2.5 → `2' 6"`; 0.75 → `9"`. */
export function feetInches(feet: number): string {
  const total = Math.round(feet * 12);
  const ft = Math.floor(total / 12), inch = total % 12;
  if (ft === 0) return `${inch}"`;
  return inch ? `${ft}' ${inch}"` : `${ft}'`;
}
