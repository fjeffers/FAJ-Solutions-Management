import { describe, it, expect } from 'vitest';
import { reassignWorkOrder, paidToTechOnWO, describeReassignment } from './reassign';
import type { Payment, WorkOrder } from './types';

const wo = (over: Partial<WorkOrder> = {}): WorkOrder => ({
  id: 'w1', wo_number: '19101350', user_id: 'u',
  contractor_name: 'Jere Jones', contractor_names: ['Jere Jones'],
  lead_contractor_name: 'Jere Jones',
  total_amount: 1000, contractor_pay: { 'Jere Jones': 600 },
  wo_status: 'Assigned', assignment_responses: null, archived_at: null,
  mileage_logs: null, materials_used: null, pay_addons: null,
  ...over,
} as unknown as WorkOrder);

const pay = (name: string, amount: number, woNumber = '19101350'): Payment =>
  ({ id: `p-${name}-${amount}`, wo_number: woNumber, contractor_name: name, amount } as Payment);

describe('what a tech has actually been paid on a job', () => {
  it('adds up their payments on that job only', () => {
    const payments = [pay('Jere Jones', 200), pay('Jere Jones', 100), pay('Bryant Knight', 50)];
    expect(paidToTechOnWO(payments, '19101350', 'Jere Jones')).toBe(300);
  });

  it('ignores payments on a different job', () => {
    expect(paidToTechOnWO([pay('Jere Jones', 200, '19101999')], '19101350', 'Jere Jones')).toBe(0);
  });

  it('is zero when they have been paid nothing', () => {
    expect(paidToTechOnWO([], '19101350', 'Jere Jones')).toBe(0);
  });
});

describe('handing a job to another tech', () => {
  it('moves the whole allocation when nothing has been paid', () => {
    const r = reassignWorkOrder(wo(), [], 'Jere Jones', 'Bryant Knight')!;
    expect(r.contractor_names).toEqual(['Bryant Knight']);
    expect(r.lead_contractor_name).toBe('Bryant Knight');
    expect(r.contractor_pay).toEqual({ 'Bryant Knight': 600 });
    expect(r.keptByOutgoing).toBe(0);
    expect(r.movedToIncoming).toBe(600);
  });

  it('leaves money already paid with the tech who earned it', () => {
    // Jere was allocated $600 and has had $250. That $250 is his — he did the
    // work he was paid for — so only the unpaid $350 moves.
    const r = reassignWorkOrder(wo(), [pay('Jere Jones', 250)], 'Jere Jones', 'Bryant Knight')!;
    expect(r.keptByOutgoing).toBe(250);
    expect(r.movedToIncoming).toBe(350);
    expect(r.contractor_pay).toEqual({ 'Jere Jones': 250, 'Bryant Knight': 350 });
    // He stays on the job, so his payment still has a job to belong to.
    expect(r.contractor_names).toContain('Jere Jones');
    expect(r.contractor_names).toContain('Bryant Knight');
  });

  it('moves nothing when the outgoing tech was already paid in full', () => {
    const r = reassignWorkOrder(wo(), [pay('Jere Jones', 600)], 'Jere Jones', 'Bryant Knight')!;
    expect(r.keptByOutgoing).toBe(600);
    expect(r.movedToIncoming).toBe(0);
    expect(r.contractor_pay['Bryant Knight']).toBe(0);
  });

  it('never hands over more than was allocated, even if overpaid', () => {
    // An overpayment is its own problem; it must not become a negative transfer.
    const r = reassignWorkOrder(wo(), [pay('Jere Jones', 900)], 'Jere Jones', 'Bryant Knight')!;
    expect(r.keptByOutgoing).toBe(600);
    expect(r.movedToIncoming).toBe(0);
  });

  it('leaves the rest of the crew and their pay alone', () => {
    const job = wo({
      contractor_names: ['Jere Jones', 'Davis Sanders'],
      contractor_pay: { 'Jere Jones': 600, 'Davis Sanders': 300 },
    });
    const r = reassignWorkOrder(job, [], 'Jere Jones', 'Bryant Knight')!;
    expect(r.contractor_names).toEqual(['Bryant Knight', 'Davis Sanders']);
    expect(r.contractor_pay).toEqual({ 'Bryant Knight': 600, 'Davis Sanders': 300 });
  });

  it('keeps the crew order, so the lead stays the lead', () => {
    const job = wo({
      contractor_names: ['Davis Sanders', 'Jere Jones'],
      lead_contractor_name: 'Davis Sanders',
      contractor_pay: { 'Davis Sanders': 400, 'Jere Jones': 200 },
    });
    const r = reassignWorkOrder(job, [], 'Jere Jones', 'Bryant Knight')!;
    expect(r.contractor_names).toEqual(['Davis Sanders', 'Bryant Knight']);
    expect(r.lead_contractor_name).toBe('Davis Sanders');
  });

  it('gives a legacy job with no pay map a real one', () => {
    // No contractor_pay means the single tech got the whole client price.
    const legacy = wo({ contractor_pay: null, total_amount: 450 });
    const r = reassignWorkOrder(legacy, [], 'Jere Jones', 'Bryant Knight')!;
    expect(r.contractor_pay).toEqual({ 'Bryant Knight': 450 });
  });

  it('makes the new tech answer for themselves', () => {
    const job = wo({
      assignment_responses: {
        'Jere Jones': { status: 'accepted', at: '2026-08-01' },
        'Davis Sanders': { status: 'accepted', at: '2026-08-01' },
      },
      contractor_names: ['Jere Jones', 'Davis Sanders'],
      contractor_pay: { 'Jere Jones': 600, 'Davis Sanders': 300 },
    });
    const r = reassignWorkOrder(job, [], 'Jere Jones', 'Bryant Knight')!;
    // Bryant has agreed to nothing; Davis's own answer stands.
    expect(r.assignment_responses).toEqual({
      'Davis Sanders': { status: 'accepted', at: '2026-08-01' },
    });
  });

  it('clears the responses entirely when nobody is left who answered', () => {
    const job = wo({ assignment_responses: { 'Jere Jones': { status: 'accepted', at: 'x' } } });
    expect(reassignWorkOrder(job, [], 'Jere Jones', 'Bryant Knight')!.assignment_responses).toBeNull();
  });

  it('refuses a move that makes no sense', () => {
    expect(reassignWorkOrder(wo(), [], 'Jere Jones', 'Jere Jones')).toBeNull();
    expect(reassignWorkOrder(wo(), [], 'Nobody At All', 'Bryant Knight')).toBeNull();
    expect(reassignWorkOrder(wo(), [], '', 'Bryant Knight')).toBeNull();
    // Already on the job — nothing to move.
    const two = wo({ contractor_names: ['Jere Jones', 'Bryant Knight'] });
    expect(reassignWorkOrder(two, [], 'Jere Jones', 'Bryant Knight')).toBeNull();
  });
});

describe('telling Fred what the move will do', () => {
  it('spells out a clean handover', () => {
    const r = reassignWorkOrder(wo(), [], 'Jere Jones', 'Bryant Knight')!;
    expect(describeReassignment(r, 'Jere Jones', 'Bryant Knight'))
      .toBe('Jere Jones comes off the job. Bryant Knight takes it on for $600.00.');
  });

  it('spells out a part-paid handover', () => {
    const r = reassignWorkOrder(wo(), [pay('Jere Jones', 250)], 'Jere Jones', 'Bryant Knight')!;
    expect(describeReassignment(r, 'Jere Jones', 'Bryant Knight'))
      .toBe('Jere Jones keeps $250.00 already paid and stays on the job for that. '
          + 'Bryant Knight takes over the remaining $350.00.');
  });
});
