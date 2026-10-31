import { describe, expect, it } from 'vitest';
import { normalizeLayout, STANDARD_LAYOUT } from './app-layout';
import { woNextStep } from './wo-next-step';
import { attentionItems } from './attention';

describe('saved menu picks up the new section names', () => {
  it('renames Every day to Jobs and On site to Setup unless Fred named them himself', () => {
    const saved = {
      ...STANDARD_LAYOUT,
      sections: STANDARD_LAYOUT.sections.map((s) =>
        s.id === 'everyday' ? { ...s, title: 'Every day' } : s.id === 'setup' ? { ...s, id: 'onsite', title: 'On site' } : s),
    };
    const titles = normalizeLayout(saved).sections.map((s) => s.title);
    expect(titles).toContain('Jobs');
    expect(titles).toContain('Setup');
    expect(titles).not.toContain('Every day');
    const mine = { ...saved, sections: saved.sections.map((s) => (s.id === 'everyday' ? { ...s, title: 'My jobs' } : s)) };
    expect(normalizeLayout(mine).sections.map((s) => s.title)).toContain('My jobs');
  });
});

describe('On Hold', () => {
  it('shows where the job stood, with nothing to do until it comes off hold', () => {
    const n = woNextStep({ status: 'On Hold', techs: ['Dwayne'], saved: true, responses: { Dwayne: { status: 'accepted', at: '' } } });
    expect(n.step).toBe('accepted');
    expect(n.action).toBeNull();
    expect(n.note).toMatch(/On hold/);
  });
});

describe('Waiting on you: tech receipts', () => {
  it('lists receipts to approve and links to Dispatch', () => {
    const items = attentionItems({ workOrders: [], surveys: [], quotes: [], contracts: [], invoices: [], invoicePayments: [], waiting: { receipts: 3 } });
    const r = items.find((i) => i.kind === 'receipts_waiting');
    expect(r?.title).toBe('3 receipts');
    expect(r?.view).toBe('workorders');
  });
});

describe('held jobs stay off the tech app', () => {
  it('drops On Hold rows and keeps the rest', async () => {
    const { notOnHold } = await import('./wf');
    const rows = [{ wo_number: '1', wo_status: 'Assigned' }, { wo_number: '2', wo_status: 'On Hold' }, { wo_number: '3', wo_status: null }];
    expect(notOnHold(rows).map((r) => r.wo_number)).toEqual(['1', '3']);
  });
});
