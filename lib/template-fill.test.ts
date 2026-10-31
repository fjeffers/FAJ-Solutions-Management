import { describe, it, expect } from 'vitest';
import { fillCount, fillFromJob, parseFill, planFill, planSize, STARTER_CLIENTS } from './template-fill';
import { addStarterClients, parseTemplates, setTemplateFill, setTemplateStartAsks, type JobTemplate } from './capture';

const EMPTY = { client_links: [], tasks: 0, questions: 0 };

describe('client template fill', () => {
  it('keeps only known, non-empty fields and tidy lists', () => {
    expect(parseFill(null)).toBeUndefined();
    expect(parseFill({ description: '   ', bogus: 'x' })).toBeUndefined();
    expect(parseFill({
      customer_name: " Wendy's ", client_links: ['https://a', '', 4],
      tasks: [{ category: 'Pre Visit', label: 'Call the GM' }, { category: 'Nope', label: 'Photos' }, { label: '' }],
      questions: ['Store open?', ''],
    })).toEqual({
      customer_name: "Wendy's", client_links: ['https://a'],
      tasks: [{ category: 'Pre Visit', label: 'Call the GM' }, { category: 'On Site', label: 'Photos' }],
      questions: ['Store open?'],
    });
  });

  it('fills in only what the work order still has empty', () => {
    const fill = parseFill({
      customer_name: 'Dunkin', description: 'Swap the router', client_links: ['https://x', 'https://y'],
      tasks: [{ category: 'On Site', label: 'Photo of rack' }], questions: ['Router serial?'],
    });
    const plan = planFill(fill, { ...EMPTY, customer_name: 'Dunkin Brands', description: '', client_links: ['https://x'], tasks: 2 });
    expect(plan).toEqual({ fields: { description: 'Swap the router' }, links: ['https://y'], tasks: [], questions: ['Router serial?'] });
    expect(planSize(plan)).toBe(3);
    expect(planSize(planFill(undefined, EMPTY))).toBe(0);
    expect(fillCount(fill)).toBe(5);
  });

  it("reads a work order's details back as a fill, old checklist groups renamed", () => {
    expect(fillFromJob({
      customer_name: 'LDS', description: 'Install', site_name: 'x',
      tasks: [{ category: 'Prep', label: 'Pack' }, { category: 'Post', label: 'Upload' }], questions: ['Q1'],
    } as never)).toEqual({
      customer_name: 'LDS', description: 'Install',
      tasks: [{ category: 'Pre Visit', label: 'Pack' }, { category: 'Post Site', label: 'Upload' }], questions: ['Q1'],
    });
  });
});

describe('client templates on job templates', () => {
  const T: JobTemplate = { id: 'lds', name: 'LDS', items: ['travel'] };
  it('saves and reads back the fill, and drops it when emptied', () => {
    const list = setTemplateFill([T], 'lds', { customer_name: 'NetView' });
    expect(parseTemplates(JSON.parse(JSON.stringify(list)))).toEqual([{ ...T, fill: { customer_name: 'NetView' } }]);
    expect(setTemplateFill(list, 'lds', {})).toEqual([T]);
  });
  it('keeps the fill when the check-in items change', () => {
    const list = setTemplateFill([T], 'lds', { customer_name: 'NetView' });
    const ask = { id: 'a1', label: 'Truck', kind: 'photo' as const };
    expect(setTemplateStartAsks(setTemplateStartAsks(list, 'lds', [ask]), 'lds', [])).toEqual(list);
  });
  it('adds the starters that are missing, by name', () => {
    const out = addStarterClients([{ id: 'lds-1', name: 'lds', items: [] }], STARTER_CLIENTS, 'abc');
    expect(out.map((t) => t.name)).toEqual(['lds', "Wendy's", 'Dunkin']);
    expect(out[1].fill).toEqual({ customer_name: "Wendy's" });
    expect(out[1].items).toContain('odometer');
    const lds = addStarterClients([], STARTER_CLIENTS, 'abc')[0];
    expect(lds.fill?.description).toContain('Cat6A');
    expect(lds.items).not.toContain('deliverables');
  });
});
