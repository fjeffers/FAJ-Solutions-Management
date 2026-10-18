// The client's links on a work order (Fred, 2026-10-18, for LDS jobs: the
// client already gives a link for uploading everything; "I just want to link
// that link into the work order"). Typed one per line on the office job form,
// shown to the tech as buttons. Pure and unit-tested (lib/client-links.test.ts).

export const CLIENT_LINKS_MAX = 10;

/** One link per line → clean web addresses: "https://" added when missing, repeats and non-links dropped. */
export function parseClientLinks(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\r\n]+/)) {
    const t = raw.trim();
    if (!t || /\s/.test(t)) continue;
    const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    let url: URL;
    try { url = new URL(withScheme); } catch { continue; }
    if (!url.hostname.includes('.')) continue;
    const clean = url.toString();
    if (!out.includes(clean)) out.push(clean);
    if (out.length >= CLIENT_LINKS_MAX) break;
  }
  return out;
}

/** What the tech's button says: the site and the start of the path. */
export function linkLabel(link: string): string {
  try {
    const u = new URL(link);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    const label = `${u.hostname.replace(/^www\./, '')}${path}`;
    return label.length > 48 ? `${label.slice(0, 47)}…` : label;
  } catch {
    return link;
  }
}

/**
 * Every web link in a pasted email or ticket, cleaned the same way (Fred,
 * 2026-10-18: "the generator should do the same thing": Generate with AI puts
 * the client's links in Client links). Works with or without the AI.
 */
export function linksInText(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'()\[\]{}]+/gi) ?? [];
  // A sentence often ends right after a link: drop the trailing punctuation.
  return parseClientLinks(found.map((u) => u.replace(/[.,;:!?]+$/, '')).join('\n'));
}

/** Two lists of links as one, the first list's order first, no repeats. */
export const mergeLinks = (a: string[], b: string[]): string[] => parseClientLinks([...a, ...b].join('\n'));

