import { describe, it, expect } from 'vitest';
import { enrichWorkOrders, getStatus, fmtMoney, contractorShareOfWO, contractorOwedOnWO, woPayoutTotal, woProfit, todayISO, addDaysISO, workOrderBreakdown, workOrderBreakdownText, woTechPayTotal, clientPaidMaterials, ownStockMaterials, materialsReimbursement, materialsForTech, payAddonsTotal, payAddonsForTech, payBreakdown, PAY_ADDON_KINDS, payAddonLabel, billableExtras, billableAddons, payAddonAmount, techPayToShow } from './utils';
import type { WorkOrder, Payment, PayAddon } from './types';

// Minimal builders — only the fields the money math actually reads.
const wo = (over: Partial<WorkOrder>): WorkOrder =>
  ({ wo_number: '1001', total_amount: 100, created_at: '2026-01-01T00:00:00Z', ...over } as WorkOrder);

const pay = (over: Partial<Payment>): Payment =>
  ({ wo_number: '1001', amount: 0, payment_date: '2026-01-02', ...over } as Payment);

describe('enrichWorkOrders', () => {
  // These state the tech's pay outright. They used to rely on the legacy
  // "no split means the tech gets the whole client price" guess to supply a
  // payout figure, which is exactly the assumption that made every unpriced
  // job show a fictional debt and $0 profit.

  it('marks a WO with no payments as pending with full amount remaining', () => {
    const [e] = enrichWorkOrders([wo({ total_amount: 500, contractor_pay: { Tech: 500 } })], []);
    expect(e.payment_status).toBe('pending');
    expect(e.paid).toBe(0);
    expect(e.remaining).toBe(500);
  });

  it('marks a partially paid WO as partial and tracks remaining', () => {
    const [e] = enrichWorkOrders([wo({ total_amount: 500, contractor_pay: { Tech: 500 } })], [pay({ amount: 200 })]);
    expect(e.payment_status).toBe('partial');
    expect(e.paid).toBe(200);
    expect(e.remaining).toBe(300);
  });

  it('sums multiple payments for the same WO', () => {
    const [e] = enrichWorkOrders(
      [wo({ total_amount: 500, contractor_pay: { Tech: 500 } })],
      [pay({ amount: 200 }), pay({ amount: 150 }), pay({ amount: 150 })],
    );
    expect(e.payment_status).toBe('paid');
    expect(e.paid).toBe(500);
    expect(e.remaining).toBe(0);
  });

  it('never reports negative remaining on overpayment', () => {
    const [e] = enrichWorkOrders([wo({ total_amount: 100, contractor_pay: { Tech: 100 } })], [pay({ amount: 150 })]);
    expect(e.payment_status).toBe('paid');
    expect(e.remaining).toBe(0);
  });

  it('only counts payments matching the WO number', () => {
    const [a, b] = enrichWorkOrders(
      [wo({ wo_number: '1001', total_amount: 100, contractor_pay: { Tech: 100 }, created_at: '2026-01-02T00:00:00Z' }),
       wo({ wo_number: '1002', total_amount: 100, contractor_pay: { Tech: 100 }, created_at: '2026-01-01T00:00:00Z' })],
      [pay({ wo_number: '1002', amount: 100 })],
    );
    // sorted newest-first: a = 1001, b = 1002
    expect(a.wo_number).toBe('1001');
    expect(a.payment_status).toBe('pending');
    expect(b.payment_status).toBe('paid');
  });

  it('handles string amounts from the database', () => {
    const [e] = enrichWorkOrders(
      [wo({ total_amount: 300, contractor_pay: { Tech: 300 } })],
      [pay({ amount: '100.50' as unknown as number }), pay({ amount: '99.50' as unknown as number })],
    );
    expect(e.paid).toBe(200);
    expect(e.payment_status).toBe('partial');
    expect(e.remaining).toBe(100);
  });

  it('sorts newest first by created_at', () => {
    const list = enrichWorkOrders(
      [wo({ wo_number: '1001', created_at: '2026-01-01T00:00:00Z' }),
       wo({ wo_number: '1003', created_at: '2026-03-01T00:00:00Z' }),
       wo({ wo_number: '1002', created_at: '2026-02-01T00:00:00Z' })],
      [],
    );
    expect(list.map((w) => w.wo_number)).toEqual(['1003', '1002', '1001']);
  });
});

describe('getStatus', () => {
  it('matches enrichWorkOrders status logic at the boundaries', () => {
    const order = wo({ total_amount: 100 });
    expect(getStatus(order, [])).toBe('pending');
    expect(getStatus(order, [pay({ amount: 99.99 })])).toBe('partial');
    expect(getStatus(order, [pay({ amount: 100 })])).toBe('paid');
  });
});

describe('contractorShareOfWO', () => {
  it('gives a single tech the full total', () => {
    const w = wo({ contractor_name: 'Jere', total_amount: 400 });
    expect(contractorShareOfWO(w, 'Jere')).toBe(400);
  });

  it('returns 0 for a tech not on the WO', () => {
    const w = wo({ contractor_name: 'Jere', total_amount: 400 });
    expect(contractorShareOfWO(w, 'Darnell')).toBe(0);
  });

  it('uses the pay split when defined', () => {
    const w = wo({
      contractor_name: 'Jere', total_amount: 400,
      contractor_names: ['Jere', 'Darnell'],
      contractor_pay: { Jere: 250, Darnell: 150 },
    });
    expect(contractorShareOfWO(w, 'Jere')).toBe(250);
    expect(contractorShareOfWO(w, 'Darnell')).toBe(150);
  });

  it('gives a tech missing from a defined split 0', () => {
    const w = wo({
      contractor_name: 'Jere', total_amount: 400,
      contractor_names: ['Jere', 'Darnell'],
      contractor_pay: { Jere: 400 },
    });
    expect(contractorShareOfWO(w, 'Darnell')).toBe(0);
  });

  it('falls back to primary-takes-all on multi-tech WOs without a split', () => {
    const w = wo({
      contractor_name: 'Jere', total_amount: 400,
      contractor_names: ['Jere', 'Darnell'],
      contractor_pay: null,
    });
    expect(contractorShareOfWO(w, 'Jere')).toBe(400);
    expect(contractorShareOfWO(w, 'Darnell')).toBe(0);
  });
});

describe('client price vs tech pay', () => {
  it('a single tech with explicit pay gets that amount; the rest is profit', () => {
    const w = wo({ contractor_name: 'Jere', total_amount: 500, contractor_pay: { Jere: 300 } });
    expect(contractorShareOfWO(w, 'Jere')).toBe(300);
    expect(woPayoutTotal(w)).toBe(300);
    expect(woProfit(w)).toBe(200);
  });

  it('a WO is paid when the techs are covered, not the client price', () => {
    const w = wo({ contractor_name: 'Jere', total_amount: 500, contractor_pay: { Jere: 300 } });
    const [e] = enrichWorkOrders([w], [pay({ amount: 300 })]);
    expect(e.payment_status).toBe('paid');
    expect(e.remaining).toBe(0);
  });

  it('legacy WO without tech pay: tech gets the full client price, zero profit', () => {
    const w = wo({ contractor_name: 'Jere', total_amount: 500 });
    expect(contractorShareOfWO(w, 'Jere')).toBe(500);
    expect(woProfit(w)).toBe(0);
  });

  it('profit accounts for mileage as a cost', () => {
    const w = wo({
      contractor_name: 'Jere', total_amount: 500,
      contractor_pay: { Jere: 300 },
      mileage_logs: [{ id: 'm1', contractor_name: 'Jere', miles: 50, rate: 0.7, note: null }],
    });
    expect(woPayoutTotal(w)).toBeCloseTo(335, 2);
    expect(woProfit(w)).toBeCloseTo(165, 2);
  });
});

describe('mileage in owed math', () => {
  const mileageWO = wo({
    contractor_name: 'Jere', total_amount: 400,
    // Jere's labour, stated rather than guessed from the client price.
    contractor_pay: { Jere: 400 },
    mileage_logs: [
      { id: 'm1', contractor_name: 'Jere', miles: 50, rate: 0.7, note: null },
    ],
  });

  it('payout total includes mileage', () => {
    expect(woPayoutTotal(mileageWO)).toBeCloseTo(435, 2); // 400 + 50*0.70
  });

  it('a WO is not "paid" until mileage is covered too', () => {
    const [e] = enrichWorkOrders([mileageWO], [pay({ amount: 400 })]);
    expect(e.payment_status).toBe('partial');
    expect(e.remaining).toBeCloseTo(35, 2);
    const [f] = enrichWorkOrders([mileageWO], [pay({ amount: 435 })]);
    expect(f.payment_status).toBe('paid');
  });

  it('a tech is owed their pay share plus their own mileage only', () => {
    const splitWO = wo({
      contractor_name: 'Jere', total_amount: 400,
      contractor_names: ['Jere', 'Darnell'],
      contractor_pay: { Jere: 250, Darnell: 150 },
      mileage_logs: [
        { id: 'm1', contractor_name: 'Jere', miles: 50, rate: 0.7, note: null },
        { id: 'm2', contractor_name: 'Darnell', miles: 10, rate: 0.7, note: null },
      ],
    });
    expect(contractorOwedOnWO(splitWO, 'Jere')).toBeCloseTo(285, 2);    // 250 + 35
    expect(contractorOwedOnWO(splitWO, 'Darnell')).toBeCloseTo(157, 2); // 150 + 7
  });

  it('no mileage means owed equals the pay share', () => {
    const plain = wo({ contractor_name: 'Jere', total_amount: 400 });
    expect(contractorOwedOnWO(plain, 'Jere')).toBe(400);
  });
});

describe('fmtMoney', () => {
  it('formats dollars and cents', () => {
    expect(fmtMoney(1234.5)).toBe('$1,234.50');
    expect(fmtMoney(0)).toBe('$0.00');
    expect(fmtMoney(null)).toBe('$0.00');
  });
});

describe('todayISO — dates are Eastern, not UTC', () => {
  it('is still yesterday in Eastern when UTC has already ticked over', () => {
    // 9pm Eastern on 23 Aug is 01:00 UTC on the 24th. Fred works nights, so a
    // visit added then was being dated tomorrow.
    expect(todayISO(new Date('2026-08-24T01:00:00Z'))).toBe('2026-08-23');
  });

  it('handles standard time as well as daylight saving', () => {
    // January: Eastern is UTC-5, so 02:00 UTC on the 15th is 9pm on the 14th.
    expect(todayISO(new Date('2026-01-15T02:00:00Z'))).toBe('2026-01-14');
    // August: Eastern is UTC-4, so 02:00 UTC on the 15th is 10pm on the 14th.
    expect(todayISO(new Date('2026-08-15T02:00:00Z'))).toBe('2026-08-14');
  });

  it('agrees with UTC during the working day', () => {
    expect(todayISO(new Date('2026-08-23T16:00:00Z'))).toBe('2026-08-23');
  });

  it('rolls over at Eastern midnight, not UTC midnight', () => {
    expect(todayISO(new Date('2026-08-24T03:59:00Z'))).toBe('2026-08-23'); // 11:59pm ET
    expect(todayISO(new Date('2026-08-24T04:01:00Z'))).toBe('2026-08-24'); // 12:01am ET
  });
});

describe('addDaysISO', () => {
  it('adds whole days', () => {
    expect(addDaysISO('2026-08-23', 7)).toBe('2026-08-30');
    expect(addDaysISO('2026-08-23', -7)).toBe('2026-08-16');
  });

  it('does not slip a day across the daylight-saving changes', () => {
    expect(addDaysISO('2026-03-07', 1)).toBe('2026-03-08');   // clocks go forward
    expect(addDaysISO('2026-10-31', 1)).toBe('2026-11-01');   // clocks go back
  });

  it('crosses month and year ends', () => {
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('hands back a bad date rather than NaN', () => {
    expect(addDaysISO('nonsense', 1)).toBe('nonsense');
  });
});

describe('workOrderBreakdown', () => {
  const wo = (over: Record<string, unknown>) => ({
    pay_type: 'Hourly', hourly_rate: 55, hours_worked: 2, total_amount: 168.7,
    billable_travel: 58.7, billable_miles: 117.4, billable_materials: null, billable_other: null,
    materials_used: [],
    ...over,
  } as Parameters<typeof workOrderBreakdown>[0]);

  it('breaks the Hillside job into the labour and travel that make it up', () => {
    const b = workOrderBreakdown(wo({}));
    expect(b.labor).toBe(110);
    expect(b.mileage).toBe(58.7);
    expect(b.other).toBe(0);          // nothing unexplained
    expect(b.total).toBe(168.7);
    // The distance is shown too, so the charge can be checked at a glance.
    expect(workOrderBreakdownText(wo({}))).toBe('2h × $55.00 = $110.00  +  Travel 117.4 mi = $58.70');
  });

  it('adds up: the parts always account for the whole total', () => {
    const shapes = [
      wo({}),
      wo({ materials_used: [{ id: 'x', material_id: null, name: 'CAT6', quantity: 2, unit_cost: 60, client_pays: true }], total_amount: 288.7 }),
      wo({ pay_type: 'Fixed', hourly_rate: null, hours_worked: null, total_amount: 2680.9, billable_travel: 80.9 }),
      wo({ billable_travel: null, total_amount: 110 }),
    ];
    for (const w of shapes) {
      const b = workOrderBreakdown(w);
      expect(Math.round((b.labor + b.mileage + b.materials + b.other) * 100) / 100).toBe(b.total);
    }
  });

  it('calls the whole fee the job price on a fixed job', () => {
    const text = workOrderBreakdownText(wo({
      pay_type: 'Fixed', hourly_rate: null, hours_worked: null,
      total_amount: 2600, billable_travel: null, materials_used: [],
    }));
    expect(text).toBe('Job price $2,600.00');
  });

  it('shows an unexplained gap rather than hiding it', () => {
    // Total says more than the named parts — that difference is real.
    const b = workOrderBreakdown(wo({ total_amount: 300 }));
    expect(b.other).toBe(131.3);
    expect(workOrderBreakdownText(wo({ total_amount: 300 }))).toContain('Other $131.30');
  });

  it('says nothing at all when there is nothing to break down', () => {
    expect(workOrderBreakdownText(wo({
      pay_type: 'Fixed', hourly_rate: null, hours_worked: null,
      total_amount: 0, billable_travel: null, materials_used: [],
    }))).toBe('');
  });
});

describe('client charges are never mistaken for tech pay', () => {
  const hillside = {
    wo_number: '19101348', pay_type: 'Hourly', hourly_rate: 55, hours_worked: 2,
    total_amount: 168.7, billable_travel: 58.7, billable_materials: null, billable_other: null,
    contractor_pay: null, contractor_name: 'Frederick Jeffers', contractor_names: null,
    mileage_logs: [], materials_used: [],
  } as unknown as WorkOrder;

  it('billing a client for travel does not become money owed to the tech', () => {
    // The whole point: $168.70 in, of which $58.70 is travel the client pays.
    // The old fallback handed the tech the entire client price.
    expect(woTechPayTotal(hillside)).toBe(110);
    expect(woPayoutTotal(hillside)).toBe(110);
    expect(woProfit(hillside)).toBe(58.7);
  });

  it('reimbursing the tech is a separate, deliberate act', () => {
    const reimbursed = {
      ...hillside,
      mileage_logs: [{ id: 'm', contractor_name: 'Frederick Jeffers', miles: 117.4, rate: 0.5, note: null }],
    } as WorkOrder;
    expect(woPayoutTotal(reimbursed)).toBe(168.7);
    expect(woProfit(reimbursed)).toBe(0);
  });

  it('leaves older work orders exactly as they were', () => {
    // No billable extras recorded — the fallback still gives the tech the lot.
    const legacy = { ...hillside, total_amount: 600, billable_travel: null } as WorkOrder;
    expect(woTechPayTotal(legacy)).toBe(600);
  });

  it('counts only the materials the client actually bought', () => {
    const rows = [
      { id: 'a', material_id: null, name: 'CAT6 spool', quantity: 1, unit_cost: 200, client_pays: false },
      { id: 'b', material_id: null, name: 'Faceplates left on site', quantity: 4, unit_cost: 12, client_pays: true },
    ];
    expect(clientPaidMaterials(rows)).toBe(48);
    expect(ownStockMaterials(rows)).toBe(200);
  });
});

describe('what a tech is actually owed', () => {
  const wo = (over: Record<string, unknown>) => ({
    total_amount: 400, billable_travel: null, billable_miles: null,
    billable_materials: null, billable_other: null,
    contractor_name: 'Ana Reyes', contractor_names: ['Ana Reyes'],
    contractor_pay: { 'Ana Reyes': 200 },
    mileage_logs: [{ id: 'm', contractor_name: 'Ana Reyes', miles: 100, rate: 0.5, note: null }],
    materials_used: [
      { id: 'a', material_id: null, name: 'Faceplates', quantity: 4, unit_cost: 30, reimburse: true },
      { id: 'b', material_id: 'stock-1', name: 'CAT6 off the van', quantity: 1, unit_cost: 200, reimburse: false },
    ],
    ...over,
  } as unknown as WorkOrder);

  it('pays back the materials the tech bought, which used to be swallowed', () => {
    // $200 labour + $50 mileage + $120 of faceplates she paid for.
    expect(materialsReimbursement(wo({}).materials_used)).toBe(120);
    expect(contractorOwedOnWO(wo({}), 'Ana Reyes')).toBe(370);
  });

  it('counts every reimbursement in the payout and the profit', () => {
    expect(woPayoutTotal(wo({}))).toBe(370);
    expect(woProfit(wo({}))).toBe(30);   // $400 client − $370 out
  });

  it('does not pay back stock the business already owned', () => {
    const stockOnly = wo({
      materials_used: [{ id: 'b', material_id: 'stock-1', name: 'CAT6', quantity: 1, unit_cost: 200, reimburse: false }],
    });
    expect(materialsReimbursement(stockOnly.materials_used)).toBe(0);
    expect(contractorOwedOnWO(stockOnly, 'Ana Reyes')).toBe(250);
  });

  it('gives an unattributed purchase to the lead tech, not to nobody', () => {
    expect(materialsForTech(wo({}).materials_used, 'Ana Reyes', 'Ana Reyes')).toBe(120);
    expect(materialsForTech(wo({}).materials_used, 'Someone Else', 'Ana Reyes')).toBe(0);
  });

  it('attributes a purchase to whoever is recorded as buying it', () => {
    const rows = [{ id: 'a', material_id: null, name: 'Anchors', quantity: 1, unit_cost: 40, reimburse: true, bought_by: 'Marco' }];
    expect(materialsForTech(rows, 'Marco', 'Ana Reyes')).toBe(40);
    expect(materialsForTech(rows, 'Ana Reyes', 'Ana Reyes')).toBe(0);
  });

  it('leaves work orders with no material flags exactly as they were', () => {
    const legacy = wo({ materials_used: [{ id: 'a', material_id: null, name: 'Bits', quantity: 1, unit_cost: 99 }] });
    expect(materialsReimbursement(legacy.materials_used)).toBe(0);
  });
});

describe('pay add-ons', () => {
  const addon = (over: Partial<PayAddon>): PayAddon => ({
    id: 'a1', kind: 'materials', label: 'Materials', amount: 35, deduct: false,
    bill_client: true, pay_tech: true, ...over,
  });

  const wo = (addons: PayAddon[]) => ({
    total_amount: 400, billable_travel: null, billable_miles: null,
    billable_materials: null, billable_other: null,
    contractor_name: 'Ana Reyes', contractor_names: ['Ana Reyes'],
    contractor_pay: { 'Ana Reyes': 120 },
    mileage_logs: [], materials_used: [], pay_addons: addons,
  } as unknown as WorkOrder);

  it('adds what should be added and takes off what should not', () => {
    // The shape of the Field Nation panel Fred works from: labour, an
    // additional charge that adds, a service charge and tax that come off.
    const w = wo([
      addon({ id: 'a', kind: 'materials', amount: 35 }),
      addon({ id: 'b', kind: 'service_fee', label: 'Platform fee', amount: 23.10, deduct: true }),
      addon({ id: 'c', kind: 'tax', label: 'Tax', amount: 0.36, deduct: true }),
    ]);
    expect(payAddonsTotal(w.pay_addons)).toBe(11.54);   // 35 − 23.10 − 0.36
    expect(woPayoutTotal(w)).toBe(131.54);              // 120 labour + 11.54
  });

  it('is zero, not NaN, with no add-ons at all', () => {
    expect(payAddonsTotal([])).toBe(0);
    expect(payAddonsTotal(null)).toBe(0);
    expect(woPayoutTotal(wo([]))).toBe(120);
  });

  it('gives each tech their own lines, and unattributed ones to the lead', () => {
    const addons = [
      addon({ id: 'a', amount: 35 }),
      addon({ id: 'b', amount: 40, contractor_name: 'Marco' }),
    ];
    expect(payAddonsForTech(addons, 'Ana Reyes', 'Ana Reyes')).toBe(35);
    expect(payAddonsForTech(addons, 'Marco', 'Ana Reyes')).toBe(40);
  });

  it('reaches what a tech is owed, not just the job total', () => {
    const w = wo([addon({ id: 'a', kind: 'per_diem', label: 'Per diem', amount: 50 })]);
    expect(contractorOwedOnWO(w, 'Ana Reyes')).toBe(170);   // 120 + 50
  });

  it('splits the panel into what adds and what deducts', () => {
    const b = payBreakdown(wo([
      addon({ id: 'a', amount: 35 }),
      addon({ id: 'b', kind: 'tax', amount: 0.36, deduct: true }),
    ]));
    expect(b.labour).toBe(120);
    expect(b.additions).toHaveLength(1);
    expect(b.deductions).toHaveLength(1);
    expect(b.total).toBe(154.64);
  });

  it('knows which way each kind normally goes', () => {
    expect(PAY_ADDON_KINDS.find((k) => k.kind === 'tax')?.deduct).toBe(true);
    expect(PAY_ADDON_KINDS.find((k) => k.kind === 'service_fee')?.deduct).toBe(true);
    expect(PAY_ADDON_KINDS.find((k) => k.kind === 'mileage')?.deduct).toBe(false);
    expect(payAddonLabel('tolls_parking')).toBe('Tolls / parking');
  });

  it('leaves work orders that have no add-ons exactly as they were', () => {
    const legacy = { ...wo([]), pay_addons: undefined } as unknown as WorkOrder;
    expect(woPayoutTotal(legacy)).toBe(120);
  });
});

describe('one list, two sides', () => {
  const wo = (addons: PayAddon[], over: Record<string, unknown> = {}) => ({
    total_amount: 0, billable_travel: null, billable_miles: null,
    billable_materials: null, billable_other: null,
    pay_type: 'Hourly', hourly_rate: 55, hours_worked: 2,
    contractor_name: 'Ana Reyes', contractor_names: ['Ana Reyes'],
    contractor_pay: { 'Ana Reyes': 110 },
    mileage_logs: [], materials_used: [], pay_addons: addons,
    ...over,
  } as unknown as WorkOrder);

  const line = (over: Partial<PayAddon>): PayAddon => ({
    id: 'x', kind: 'mileage', label: 'Mileage', amount: 58.7,
    deduct: false, bill_client: true, pay_tech: false, ...over,
  });

  it('bills the client without paying the tech', () => {
    const w = wo([line({})]);
    expect(billableExtras(w)).toBe(58.7);   // revenue
    expect(payAddonsTotal(w.pay_addons)).toBe(0);      // nothing out
    expect(woPayoutTotal(w)).toBe(110);
  });

  it('pays the tech without billing the client', () => {
    const w = wo([line({ bill_client: false, pay_tech: true })]);
    expect(billableExtras(w)).toBe(0);
    expect(woPayoutTotal(w)).toBe(168.7);
  });

  it('does both when the travel is charged on and handed back', () => {
    const w = wo([line({ bill_client: true, pay_tech: true })]);
    expect(billableExtras(w)).toBe(58.7);
    expect(woPayoutTotal(w)).toBe(168.7);
  });

  it('never turns a deduction into revenue', () => {
    const w = wo([line({ kind: 'tax', label: 'Tax', amount: 12, deduct: true, bill_client: true, pay_tech: true })]);
    expect(billableExtras(w)).toBe(0);       // a tax is not something a client buys
    expect(woPayoutTotal(w)).toBe(98);       // 110 − 12
  });

  it('reads the old columns only while a job has no add-ons', () => {
    const legacy = wo([], { billable_travel: 58.7 });
    expect(billableExtras(legacy)).toBe(58.7);

    // Once a job has add-ons they are the whole story, so travel recorded both
    // ways cannot be counted twice.
    const migrated = wo([line({ amount: 58.7 })], { billable_travel: 58.7 });
    expect(billableExtras(migrated)).toBe(58.7);
  });
});

describe('a pay line does hours or miles as readily as a flat figure', () => {
  it('works out qty × rate', () => {
    // The Hillside job, as two lines rather than five fields.
    expect(payAddonAmount({ amount: 0, qty: 2, rate: 55 })).toBe(110);
    expect(payAddonAmount({ amount: 0, qty: 117.4, rate: 0.5 })).toBe(58.7);
  });

  it('uses the flat amount when there is no rate', () => {
    expect(payAddonAmount({ amount: 35, qty: null, rate: null })).toBe(35);
  });

  it('lets a rate of zero mean zero, not "fall back to the amount"', () => {
    expect(payAddonAmount({ amount: 999, qty: 3, rate: 0 })).toBe(0);
  });

  it('totals a job built entirely from lines', () => {
    const lines: PayAddon[] = [
      { id: 'l', kind: 'labour', label: 'Labour', amount: 0, qty: 2, rate: 55,
        deduct: false, bill_client: true, pay_tech: true },
      { id: 'm', kind: 'mileage', label: 'Mileage', amount: 0, qty: 117.4, rate: 0.5,
        deduct: false, bill_client: true, pay_tech: false },
      { id: 't', kind: 'tax', label: 'Tax', amount: 0.36, qty: null, rate: null,
        deduct: true, bill_client: false, pay_tech: true },
    ];
    expect(billableAddons(lines)).toBe(168.7);      // what Wendy's pays
    expect(payAddonsTotal(lines)).toBe(109.64);     // 110 labour − 0.36 tax
  });
});

describe('a job with no agreed tech pay', () => {
  // Eight of Fred's nine live jobs were in this state. The app assumed the tech
  // got the entire client price, so a $1,138.25 Wendy's job read as $1,138.25
  // owed and $0 profit — on work nobody had been paid a penny for.
  it('states no debt, because nobody has agreed a figure', () => {
    const [e] = enrichWorkOrders([wo({ total_amount: 1138.25, contractor_pay: null })], []);
    expect(e.pay_set).toBe(false);
    expect(e.remaining).toBe(0);
    expect(e.payout_total).toBe(0);
  });

  it('is never called settled while the figure is missing', () => {
    const [e] = enrichWorkOrders(
      [wo({ total_amount: 500, contractor_pay: null })],
      [pay({ amount: 500 })],
    );
    expect(e.payment_status).toBe('pending');
  });

  it('still owes the tech what they laid out', () => {
    // Mileage and materials are money the tech actually spent. Those are known
    // even when the labour is not, so they must not vanish with the guess.
    const [e] = enrichWorkOrders([wo({
      total_amount: 800,
      contractor_pay: null,
      mileage_logs: [{ id: 'm', contractor_name: 'Tech', miles: 100, rate: 0.5, note: null }],
    })], []);
    expect(e.pay_set).toBe(false);
    expect(e.payout_total).toBe(50);
    expect(e.remaining).toBe(50);
  });

  it('reports a real figure the moment one is entered', () => {
    const [e] = enrichWorkOrders(
      [wo({ total_amount: 1138.25, contractor_pay: { 'Frederick Jeffers': 400 } })],
      [],
    );
    expect(e.pay_set).toBe(true);
    expect(e.payout_total).toBe(400);
    expect(e.remaining).toBe(400);
    // and the profit the card shows
    expect(Math.round((1138.25 - e.payout_total) * 100) / 100).toBe(738.25);
  });
});

describe('techPayToShow (what a tech email may say about pay)', () => {
  const base = { contractor_name: 'Frederick Jeffers', contractor_names: ['Frederick Jeffers'], total_amount: 866.46,
    mileage_logs: [], materials_used: [], pay_addons: [] } as unknown as Parameters<typeof techPayToShow>[0];
  it('never shows the client price when no tech pay was entered (Gaffney, 2026-10-18)', () => {
    expect(techPayToShow({ ...base, contractor_pay: null }, 'Frederick Jeffers')).toBeNull();
    expect(techPayToShow({ ...base, contractor_pay: {} }, 'Frederick Jeffers')).toBeNull();
  });
  it('shows the pay the office entered for that tech', () => {
    const wo = { ...base, contractor_names: ['Paul Gibbs', 'Raja Bennett'], contractor_name: 'Paul Gibbs',
      contractor_pay: { 'Paul Gibbs': 400, 'Raja Bennett': 250 } };
    expect(techPayToShow(wo, 'Paul Gibbs')).toBe(400);
    expect(techPayToShow(wo, 'Raja Bennett')).toBe(250);
  });
  it('says nothing for a tech with no entry of their own', () => {
    const wo = { ...base, contractor_names: ['Paul Gibbs', 'Raja Bennett'], contractor_pay: { 'Paul Gibbs': 400 } };
    expect(techPayToShow(wo, 'Raja Bennett')).toBeNull();
  });
});
