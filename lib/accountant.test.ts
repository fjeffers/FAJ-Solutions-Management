import { describe, it, expect } from 'vitest';
import { summarize1099, jobMoney, jobsTotals, toCsv, type Row1099 } from './accountant';
import { woPayoutTotal, woProfitOrNull } from './utils';
import type { WorkOrder } from './types';

const row = (name: string, paid: number, over: Partial<Row1099> = {}): Row1099 => ({
  name, contractor_id: name, business_name: null, entity_type: null, tax_id_type: null, tax_id_last4: null,
  address: null, city: null, state: null, zip: null, email: null, w9_received: false, w9_file: false,
  w9_submitted_at: null, paid, payments: 1, ...over,
});

describe('1099 summary', () => {
  it('counts who needs a form at the 2026 $2,000 line, and whose paperwork is missing', () => {
    const rows = [
      row('Davis', 9069.58, { tax_id_last4: '6789', w9_received: true }),
      row('Jere', 5896),
      row('Mutema', 2800),
      row('Tunde', 310),
    ];
    expect(summarize1099(rows, 2026)).toEqual({ total: 18075.58, needing: 3, missingW9: 2, missingTin: 2 });
  });
  it('uses the old $600 line for 2025', () => {
    expect(summarize1099([row('A', 700)], 2025).needing).toBe(1);
    expect(summarize1099([row('A', 700)], 2026).needing).toBe(0);
  });
});

describe('job money comes from lib/utils, unchanged', () => {
  const wo = {
    wo_number: '1', total_amount: 1000, contractor_name: 'Davis', contractor_names: ['Davis'],
    contractor_pay: { Davis: 600 }, mileage_logs: [], materials_used: [], pay_addons: [],
    billable_travel: 0, billable_materials: 0, billable_other: 0, billable_miles: 0,
  } as unknown as WorkOrder;
  it('matches the owner app to the cent', () => {
    const m = jobMoney(wo);
    expect(m.revenue).toBe(1000);
    expect(m.payout).toBe(woPayoutTotal(wo));
    expect(m.profit).toBe(woProfitOrNull(wo));
  });
  it('counts jobs with no pay split instead of guessing their profit', () => {
    const noSplit = { ...wo, contractor_pay: null } as unknown as WorkOrder;
    const t = jobsTotals([wo, noSplit]);
    expect(t.noSplit).toBe(woProfitOrNull(noSplit) === null ? 1 : 0);
    expect(t.revenue).toBe(2000);
  });
});

describe('CSV export', () => {
  it('quotes cells, doubles quotes, and keeps formulas from running', () => {
    const csv = toCsv(['Name', 'Note', 'Amount'], [['Davis "D" Sanders', '=HYPERLINK("x")', -12.5], [null, '@sum', 3]]);
    expect(csv).toBe('"Name","Note","Amount"\r\n"Davis ""D"" Sanders","\'=HYPERLINK(""x"")","-12.5"\r\n"","\'@sum","3"');
  });
});
