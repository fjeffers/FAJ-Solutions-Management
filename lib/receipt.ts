// Receipt text → line items, no AI required. Handles the shapes store
// receipts actually take (Home Depot, Lowes, supply houses):
//   "2X4X8 KD STUD  <A>  3.98"
//   "ROMEX 14/2 50FT   45.97"
//   "4 @ 2.99         11.96"
//   "QTY 2  EMT STRAP  1.58"
// Payment/total lines (SUBTOTAL, TAX, VISA...) are excluded.

export type ReceiptItem = {
  name: string;
  quantity: number;
  unit_cost: number;
};

const NOT_ITEMS = /^(sub\s?total|total|tax|sales\s?tax|cash|change|credit|debit|visa|master|amex|discover|balance|payment|tender|auth|approval|card|account|xxxx|invoice|order|receipt|store|phone|tel|thank|return|policy|cashier|register|www\.|http)/i;

function cleanName(s: string): string {
  return s
    .replace(/<[A-Z]>/g, '')          // Home Depot tax-code markers like <A>
    .replace(/\b\d{6,}\b/g, '')       // long SKU/UPC digit runs
    .replace(/\s{2,}/g, ' ')
    .replace(/[~*#]+/g, '')
    .trim();
}

export function parseReceiptText(text: string): { items: ReceiptItem[]; vendor: string | null } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const vendor = lines.length > 0 && !/\d{2}[./]\d{2}/.test(lines[0]) ? cleanName(lines[0]).slice(0, 40) || null : null;

  const items: ReceiptItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (NOT_ITEMS.test(line)) continue;

    // "4 @ 2.99   11.96" — quantity line (name may be on the previous line)
    let m = line.match(/^(.*?)\s*(\d+(?:\.\d+)?)\s*@\s*\$?(\d+(?:[.,]\d{2}))\s+\$?(\d+[.,]\d{2})\s*$/);
    if (m) {
      const inlineName = cleanName(m[1]);
      const prevLine = i > 0 ? lines[i - 1] : '';
      const prevIsName = !NOT_ITEMS.test(prevLine) && !/\d+[.,]\d{2}\s*$/.test(prevLine);
      const name = inlineName || (prevIsName ? cleanName(prevLine) : '');
      if (name) {
        items.push({ name, quantity: Number(m[2]), unit_cost: Number(m[3].replace(',', '.')) });
        continue;
      }
    }

    // "QTY 2 EMT STRAP 1.58" or "2 x EMT STRAP 1.58"
    m = line.match(/^(?:qty\s*)?(\d{1,3})\s*(?:x\s+)?(.+?)\s+\$?(\d+[.,]\d{2})\s*$/i);
    if (m && /^qty|^\d{1,3}\s*x\s/i.test(line)) {
      const name = cleanName(m[2]);
      const total = Number(m[3].replace(',', '.'));
      const qty = Number(m[1]);
      if (name && qty > 0) {
        items.push({ name, quantity: qty, unit_cost: Math.round((total / qty) * 100) / 100 });
        continue;
      }
    }

    // Plain "NAME ....... 45.97" line
    m = line.match(/^(.+?)\s+\$?(\d{1,4}[.,]\d{2})\s*[A-Z]?\s*$/);
    if (m) {
      const name = cleanName(m[1]);
      // Names that are purely numeric/date-like are noise, not items
      if (name && name.length >= 3 && !/^[\d\s./-]+$/.test(name)) {
        items.push({ name, quantity: 1, unit_cost: Number(m[2].replace(',', '.')) });
      }
    }
  }
  return { items, vendor };
}

export function receiptTotal(items: ReceiptItem[]): number {
  return Math.round(items.reduce((s, i) => s + i.quantity * i.unit_cost, 0) * 100) / 100;
}
