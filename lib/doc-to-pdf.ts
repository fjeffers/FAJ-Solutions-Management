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
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/…/g, '...').replace(/[☐-☒□■]/g, '[ ]').replace(/[^\x09\x0A\x20-\x7E -ÿ•]/g, '');

/** The blocks as a letter-size PDF. */
export async function blocksToPdf(blocks: DocBlock[], title: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setProducer('FAJ Solutions'); doc.setCreator('FAJ Solutions');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 54, width = W - 2 * M;
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
  for (const b of blocks) {
    if (b.kind === 'heading') {
      y -= 6; draw(b.text, M, width, b.level <= 1 ? 16 : b.level === 2 ? 13.5 : 12, true); y -= 2;
    } else if (b.kind === 'para') {
      draw(b.text, M, width, 10.5, false); y -= 5;
    } else if (b.kind === 'item') {
      need(14); const top = y;
      page.drawText(safe(b.marker), { x: M + 4, y: top - 10.5 * 1.35, size: 10.5, font: regular });
      draw(b.text, M + 22, width - 22, 10.5, false); y -= 2;
    } else {
      const n = Math.max(1, b.cells.length);
      const col = width / n;
      const size = 9.5;
      const font = b.header ? bold : regular;
      const cellLines = b.cells.map((c) => wrapLine(safe(c), col - 8, (s) => font.widthOfTextAtSize(s, size)));
      const rows = Math.max(1, ...cellLines.map((l) => l.length));
      const h = rows * size * 1.35 + 6;
      need(h);
      cellLines.forEach((lines, i) => {
        const x = M + i * col;
        page.drawRectangle({ x, y: y - h, width: col, height: h, borderColor: rgb(0.75, 0.75, 0.78), borderWidth: 0.6 });
        lines.forEach((line, j) => { if (line) page.drawText(line, { x: x + 4, y: y - 3 - (j + 1) * size * 1.35 + 2, size, font, color: rgb(0.1, 0.1, 0.12) }); });
      });
      y -= h;
    }
  }
  return doc.save();
}
