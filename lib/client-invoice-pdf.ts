import type { Invoice, InvoicePayment, WorkOrder } from './types';
import { wrapLine } from './doc-to-pdf';

type Site = Pick<WorkOrder, 'site_name' | 'title' | 'client_reference' | 'wo_number'>;
type ClientExpense = { vendor: string | null; category: string; expense_date: string; receipt_path: string | null };

const safe = (value: unknown) => String(value ?? '').replace(/[^\x20-\x7E]/g, ' ');
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fileSafe = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').trim();

export function invoiceSite(site: Site | null | undefined, invoice: Invoice) {
  const source = [site?.client_reference, site?.site_name, site?.title, invoice.title, invoice.description].filter(Boolean).join(' ');
  const number = source.match(/\b(\d{7})\b/)?.[1] ?? site?.wo_number ?? invoice.invoice_number;
  const rawName = site?.site_name || site?.title || invoice.title || invoice.client_name || 'Site';
  const name = rawName
    .replace(/\b\d{7}\b/g, '')
    .replace(/\bLDS\b\s*[-–—:]?\s*/gi, '')
    .replace(/\s*[-–—]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Site';
  return { number, name };
}

export function clientInvoiceFilename(invoice: Invoice, site?: Site | null) {
  const resolved = invoiceSite(site, invoice);
  return fileSafe(`${resolved.number} - ${resolved.name} - Invoice ${invoice.invoice_number}.pdf`);
}

export function clientExpenseFilename(invoice: Invoice, expense: ClientExpense, site?: Site | null) {
  const resolved = invoiceSite(site, invoice);
  const extension = expense.receipt_path?.match(/(\.[a-z0-9]{1,8})$/i)?.[1].toLowerCase() ?? '';
  const label = expense.vendor?.trim() || expense.category.replace(/[_-]+/g, ' ').trim() || 'Expense';
  return fileSafe(`${resolved.number} - ${resolved.name} - Expense - ${label} - ${expense.expense_date}${extension}`);
}

export async function clientInvoicePdf(invoice: Invoice, payments: InvoicePayment[], site?: Site | null): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H, M] = [612, 792, 42];
  const navy = rgb(0.055, 0.106, 0.18), gold = rgb(0.79, 0.635, 0.294), grey = rgb(0.4, 0.4, 0.43);
  let page = doc.addPage([W, H]);
  let y = H - M;

  const draw = (value: unknown, x: number, yy: number, size = 10, font = regular, color = navy) =>
    page.drawText(safe(value), { x, y: yy, size, font, color });
  const lines = (value: unknown, width: number, size = 10, font = regular) =>
    wrapLine(safe(value), width, (s) => font.widthOfTextAtSize(s, size));
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const ensure = (height: number) => { if (y - height < M) newPage(); };

  const resolved = invoiceSite(site, invoice);
  doc.setTitle(`Invoice ${invoice.invoice_number} - ${resolved.number} ${resolved.name}`);
  doc.setProducer('FAJ Solutions LLC');

  draw('FAJ SOLUTIONS LLC', M, y - 4, 18, bold);
  draw('INVOICE', W - M - bold.widthOfTextAtSize('INVOICE', 18), y - 4, 18, bold);
  y -= 22;
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 2, color: gold });
  y -= 22;
  draw(`Invoice ${invoice.invoice_number}`, M, y, 15, bold);
  draw(`${resolved.number} - ${resolved.name}`, M, y - 18, 11, bold, grey);
  draw(`Issued ${new Date(invoice.created_at).toLocaleDateString('en-US')}`, W - M - 130, y, 9, regular, grey);
  if (invoice.due_date) draw(`Due ${new Date(`${invoice.due_date}T12:00:00`).toLocaleDateString('en-US')}`, W - M - 130, y - 15, 9, regular, grey);
  y -= 55;

  draw('BILLED TO', M, y, 8, bold, grey);
  draw('FROM', 350, y, 8, bold, grey);
  y -= 16;
  draw(invoice.client_name || 'Client', M, y, 12, bold);
  draw('FAJ Solutions LLC', 350, y, 12, bold);
  y -= 15;
  if (invoice.client_email) draw(invoice.client_email, M, y, 9, regular, grey);
  draw('fajsolutions@gmail.com', 350, y, 9, regular, grey);
  y -= 28;

  if (invoice.description) {
    for (const line of lines(invoice.description, W - 2 * M, 9)) { draw(line, M, y, 9, regular, grey); y -= 12; }
    y -= 8;
  }

  const cols = [M, M + 300, M + 355, M + 430];
  page.drawRectangle({ x: M, y: y - 18, width: W - 2 * M, height: 18, color: navy });
  ['Description', 'Qty', 'Rate', 'Amount'].forEach((h, i) => draw(h, cols[i] + 4, y - 12, 8, bold, rgb(1, 1, 1)));
  y -= 18;
  for (const item of invoice.line_items) {
    const desc = lines(item.description, 290, 9);
    const height = Math.max(24, desc.length * 12 + 8);
    ensure(height + 5);
    desc.forEach((line, i) => draw(line, cols[0] + 4, y - 14 - i * 12, 9));
    draw(item.quantity, cols[1] + 4, y - 14, 9);
    draw(money(Number(item.rate)), cols[2] + 4, y - 14, 9);
    draw(money(Number(item.quantity) * Number(item.rate)), cols[3] + 4, y - 14, 9, bold);
    page.drawLine({ start: { x: M, y: y - height }, end: { x: W - M, y: y - height }, thickness: 0.5, color: rgb(0.88, 0.88, 0.88) });
    y -= height;
  }

  y -= 12;
  const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = Math.max(0, Number(invoice.total) - paid);
  const total = (label: string, value: string, strong = false) => {
    draw(label, 350, y, 10, strong ? bold : regular, strong ? navy : grey);
    draw(value, W - M - (strong ? bold : regular).widthOfTextAtSize(value, 10), y, 10, strong ? bold : regular, strong ? navy : grey);
    y -= 17;
  };
  total('Subtotal', money(Number(invoice.subtotal)));
  if (Number(invoice.tax_amount) > 0) total(`Tax (${invoice.tax_rate}%)`, money(Number(invoice.tax_amount)));
  total('Total', money(Number(invoice.total)), true);
  if (paid > 0) total('Payments received', `- ${money(paid)}`);
  page.drawLine({ start: { x: 350, y: y + 5 }, end: { x: W - M, y: y + 5 }, thickness: 1.5, color: navy });
  total('Balance due', money(balance), true);

  if (invoice.notes) {
    y -= 8;
    ensure(55);
    draw('Notes', M, y, 9, bold, gold); y -= 14;
    for (const line of lines(invoice.notes, W - 2 * M, 9)) { draw(line, M, y, 9, regular, grey); y -= 12; }
  }

  draw('Thank you for your business.', M, M - 4, 9, regular, grey);
  return doc.save();
}
