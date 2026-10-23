import { describe, it, expect } from 'vitest';
import { receiptItemRows, type BillSite } from './weekly-bill';

const site = (name: string, wo: string, receipts: unknown[], total: number) =>
  ({ name, wo, address: '', bill: { receipts, totals: { receipts: total } } }) as unknown as BillSite;

describe('the Receipt items sheet', () => {
  it('lists every receipt line by line, the receipt total once, and a plain row for a receipt with no lines', () => {
    const rows = receiptItemRows([
      site('Gaffney', '19101412', [
        { expense_date: '2026-10-21', contractor_name: 'Mike', vendor: 'Home Depot', category: 'materials', amount: 52.1, note: null,
          ai: { items: [{ name: 'Cat6 cable 1000ft', qty: 1, amount: 38.99 }, { name: 'RJ45 ends', qty: 50, amount: 8.5 }] } },
        { expense_date: '2026-10-22', contractor_name: 'Mike', vendor: 'Shell', category: 'fuel', amount: 41.24, note: 'Fill up', ai: null },
      ], 93.34),
    ]);
    expect(rows.slice(2)).toEqual([
      ['Date', 'Site', 'WO', 'Technician', 'Store', 'For', 'Item', 'Qty', 'Item amount', 'Receipt total'],
      ['2026-10-21', 'Gaffney', '19101412', 'Mike', 'Home Depot', 'Materials', 'Cat6 cable 1000ft', 1, 38.99, 52.1],
      ['2026-10-21', 'Gaffney', '19101412', 'Mike', 'Home Depot', 'Materials', 'RJ45 ends', 50, 8.5, ''],
      ['2026-10-22', 'Gaffney', '19101412', 'Mike', 'Shell', 'Fuel', 'Fill up', '', '', 41.24],
      ['Total', '', '', '', '', '', '', '', '', 93.34],
    ]);
  });
});
