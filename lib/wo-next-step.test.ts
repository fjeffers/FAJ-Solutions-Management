import { describe, expect, it } from 'vitest';
import { woNextStep, WO_STEPS } from './wo-next-step';

const at = '2026-10-31T12:00:00Z';

describe('next step on a work order', () => {
  it('walks the eight steps in order', () => {
    expect(WO_STEPS.map((s) => s.key)).toEqual(['tech', 'sent', 'accepted', 'onsite', 'done', 'approved', 'invoiced', 'paid']);
  });

  it('a job with no tech asks for one', () => {
    expect(woNextStep({ saved: true, status: 'Open', techs: [] })).toMatchObject({ step: 'tech', action: { do: 'pick-tech' } });
  });

  it('waits for every tech to accept, and names who is left', () => {
    const n = woNextStep({ saved: true, status: 'Assigned', techs: ['Paul', 'Kendell'], responses: { Paul: { status: 'accepted', at } } });
    expect(n.step).toBe('sent');
    expect(n.note).toContain('Kendell');
    expect(n.note).not.toContain('Paul');
    expect(n.action).toBeNull();
  });

  it('a turned-down job asks for another tech', () => {
    expect(woNextStep({ saved: true, status: 'Assigned', techs: ['Paul'], responses: { Paul: { status: 'declined', at } } }))
      .toMatchObject({ step: 'sent', action: { do: 'pick-tech' } });
  });

  it('an unsaved job with a tech says to save', () => {
    expect(woNextStep({ saved: false, techs: ['Paul'] }).note).toMatch(/^Save/);
  });

  it('accepted, then on site once checked in', () => {
    const r = { Paul: { status: 'accepted' as const, at } };
    expect(woNextStep({ saved: true, status: 'Assigned', techs: ['Paul'], responses: r }).step).toBe('accepted');
    expect(woNextStep({ saved: true, status: 'Assigned', techs: ['Paul'], responses: r, checkedIn: true }).step).toBe('onsite');
    expect(woNextStep({ saved: true, status: 'In Progress', techs: ['Paul'] }).step).toBe('onsite');
  });

  it('work done asks to approve, approved asks for the invoice, invoiced asks for payment', () => {
    expect(woNextStep({ saved: true, status: 'Work Done', techs: ['Paul'] }).action?.do).toBe('approve');
    expect(woNextStep({ saved: true, status: 'Approved', techs: ['Paul'] }).action?.do).toBe('invoice');
    expect(woNextStep({ saved: true, status: 'Approved', techs: ['Paul'], invoiced: true })).toMatchObject({ step: 'invoiced', action: { do: 'mark-paid' } });
    expect(woNextStep({ saved: true, status: 'Paid', techs: ['Paul'] })).toMatchObject({ step: 'paid', action: null });
  });
});
