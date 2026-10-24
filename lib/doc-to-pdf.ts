// A Word document, as the tech edited it in the app, made into a PDF to sign
// (Fred, 2026-10-22: "convert the form to be fillable or even like a google
// doc"). The document is shown as an editable page (components/tools/DocViewer);
// this lays out what it says now — headings, paragraphs, lists and tables — on
// letter-size pages with pdf-lib. Plain layout: the words, not the Word styling.
// blocksFromHtml and wrapLine are pure and unit-tested (lib/doc-to-pdf.test.ts).

export type DocBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'item'; text: string; marker: string }
  | { kind: 'row'; cells: string[]; header: boolean };

const clean = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

/** What the edited page says, block by block. */
export function blocksFromHtml(root: Element): DocBlock[] {
  const out: DocBlock[] = [];
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = clean((child as HTMLElement).innerText ?? child.textContent);
        if (text) out.push({ kind: 'heading', level: Number(tag[1]), text });
      } else if (tag === 'p' || tag === 'div' && !child.querySelector('p,table,ul,ol,h1,h2,h3,h4,h5,h6')) {
        const text = clean((child as HTMLElement).innerText ?? child.textContent);
        if (text) out.push({ kind: 'para', text });
      } else if (tag === 'ul' || tag === 'ol') {
        Array.from(child.children).filter((li) => li.tagName.toLowerCase() === 'li').forEach((li, i) => {
          const text = clean((li as HTMLElement).innerText ?? li.textContent);
          if (text) out.push({ kind: 'item', text, marker: tag === 'ol' ? `${i + 1}.` : '•' });
        });
      } else if (tag === 'table') {
        child.querySelectorAll('tr').forEach((tr) => {
          const cells = Array.from(tr.children).map((c) => clean((c as HTMLElement).innerText ?? c.textContent));
          if (cells.some(Boolean)) out.push({ kind: 'row', cells, header: !!tr.querySelector('th') });
        });
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * What the signed PDF can't carry: it is laid out from the words, so pictures
 * and merged table cells don't make it across. Said before signing, never
 * dropped quietly.
 */
export function lostInPdf(root: Element): string[] {
  const lost: string[] = [];
  if (root.querySelector('img, svg, canvas')) lost.push('pictures');
  if (root.querySelector('[colspan]:not([colspan="1"]), [rowspan]:not([rowspan="1"])')) lost.push('merged table cells');
  return lost;
}

/** Words onto lines no wider than `max`, given a width measure. Long words are cut. */
export function wrapLine(text: string, max: number, width: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (width(next) <= max) { line = next; continue; }
      if (line) lines.push(line);
      let w = word;
      while (width(w) > max && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && width(w.slice(0, cut)) > max) cut--;
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    lines.push(line);
  }
  return lines;
}

// Characters Helvetica (WinAnsi) can't draw become close plain ones.
export const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/…/g, '...').replace(/[☐-☒□■]/g, '[ ]').replace(/[^\x09\x0A\x20-\x7E -ÿ•]/g, '');

/**
 * Column widths for a table: each column as wide as its longest cell, shrunk
 * to fit `max` when they don't all fit, but never below `min` while there's room.
 */
export function columnWidths(rows: string[][], max: number, width: (s: string) => number, min = 28): number[] {
  const n = Math.max(1, ...rows.map((r) => r.length));
  const want = Array.from({ length: n }, (_, i) => Math.max(min, ...rows.map((r) => width(r[i] ?? '') + 8)));
  const total = want.reduce((a, b) => a + b, 0);
  if (total <= max) return want.map((w) => (w * max) / total);
  const floor = Math.min(min, max / n);
  const spare = max - floor * n;
  const extra = want.map((w) => Math.max(0, w - floor));
  const sum = extra.reduce((a, b) => a + b, 0) || 1;
  return extra.map((e) => floor + (e * spare) / sum);
}

/** The blocks as a letter-size PDF; sideways when a table has many columns. */
export async function blocksToPdf(blocks: DocBlock[], title: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setProducer('FAJ Solutions'); doc.setCreator('FAJ Solutions');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cols = Math.max(0, ...blocks.map((b) => (b.kind === 'row' ? b.cells.length : 0)));
  const [W, H] = cols >= 6 ? [792, 612] : [612, 792];
  const M = cols >= 6 ? 36 : 54, width = W - 2 * M;
  const tableSize = cols > 12 ? 6.5 : cols > 8 ? 7.5 : 9.5;
  // Each run of rows is one table, with its own column widths.
  const widths = new Map<number, number[]>();
  for (let i = 0; i < blocks.length;) {
    if (blocks[i].kind !== 'row') { i++; continue; }
    let j = i; while (j < blocks.length && blocks[j].kind === 'row') j++;
    const run = blocks.slice(i, j) as Extract<DocBlock, { kind: 'row' }>[];
    const w = columnWidths(run.map((r) => r.cells.map(safe)), width, (t) => bold.widthOfTextAtSize(t, tableSize));
    for (let k = i; k < j; k++) widths.set(k, w);
    i = j;
  }
  let page = doc.addPage([W, H]);
  let y = H - M;
  const need = (h: number) => { if (y - h < M) { page = doc.addPage([W, H]); y = H - M; } };
  const draw = (text: string, x: number, max: number, size: number, isBold: boolean) => {
    const font = isBold ? bold : regular;
    const lines = wrapLine(safe(text), max, (s) => font.widthOfTextAtSize(s, size));
    for (const line of lines) {
      need(size * 1.35);
      y -= size * 1.35;
      if (line) page.drawText(line, { x, y, size, font, color: rgb(0.1, 0.1, 0.12) });
    }
  };
  for (const [bi, b] of blocks.entries()) {
    if (b.kind === 'heading') {
      y -= 6; draw(b.text, M, width, b.level <= 1 ? 16 : b.level === 2 ? 13.5 : 12, true); y -= 2;
    } else if (b.kind === 'para') {
      draw(b.text, M, width, 10.5, false); y -= 5;
    } else if (b.kind === 'item') {
      need(14); const top = y;
      page.drawText(safe(b.marker), { x: M + 4, y: top - 10.5 * 1.35, size: 10.5, font: regular });
      draw(b.text, M + 22, width - 22, 10.5, false); y -= 2;
    } else {
      const cw = widths.get(bi) ?? [width];
      const size = tableSize;
      const font = b.header ? bold : regular;
      const cellLines = cw.map((col, i) => wrapLine(safe(b.cells[i] ?? ''), col - 6, (s) => font.widthOfTextAtSize(s, size)));
      const rows = Math.max(1, ...cellLines.map((l) => l.length));
      const h = rows * size * 1.35 + 6;
      need(h);
      let x = M;
      cellLines.forEach((lines, i) => {
        const col = cw[i];
        page.drawRectangle({ x, y: y - h, width: col, height: h, borderColor: rgb(0.75, 0.75, 0.78), borderWidth: 0.6 });
        lines.forEach((line, j) => { if (line) page.drawText(line, { x: x + 3, y: y - 3 - (j + 1) * size * 1.35 + 2, size, font, color: rgb(0.1, 0.1, 0.12) }); });
        x += col;
      });
      y -= h;
    }
  }
  return doc.save();
}
