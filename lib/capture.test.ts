import { describe, it, expect } from 'vitest';
import {
  asks, parseCapture, parseTemplates, templateOf, ALL_CAPTURE, STARTER_TEMPLATES,
  toggleItem, addTemplate, renameTemplate, setTemplateItems, removeTemplate,
} from './capture';

describe('what a job asks the tech for', () => {
  it('asks for everything when the job has no list, as every job did before', () => {
    expect(ALL_CAPTURE.every((k) => asks(null, k))).toBe(true);
    expect(asks(['travel', 'receipts'], 'receipts')).toBe(true);
    expect(asks(['travel', 'receipts'], 'photos')).toBe(false);
  });

  it('reads a stored list into the standard order, dropping anything unknown', () => {
    expect(parseCapture(['receipts', 'nonsense', 'travel', 'travel'])).toEqual(['travel', 'receipts']);
    expect(parseCapture(null)).toBeNull();
    expect(parseCapture([])).toEqual([]);
  });

  it('keeps saved templates safe and offers the starters until there are some', () => {
    expect(parseTemplates(undefined)).toEqual(STARTER_TEMPLATES);
    const saved = parseTemplates([
      { id: 'cable', name: '  Cabling   install ', items: ['travel', 'photos', 'checklist', 'bogus'] },
      { id: 'cable', name: 'Duplicate id', items: ['travel'] },
      { id: 'BAD ID', name: 'x', items: ['travel'] },
      { id: 'empty', name: 'Nothing ticked', items: [] },
    ]);
    expect(saved).toEqual([{ id: 'cable', name: 'Cabling install', items: ['travel', 'photos', 'checklist'] }]);
  });

  it('knows which template a job uses', () => {
    expect(templateOf(['notes', 'receipts', 'odometer', 'travel'], STARTER_TEMPLATES)?.id).toBe('portal');
    expect(templateOf(['travel'], STARTER_TEMPLATES)).toBeNull();
    expect(templateOf(null, STARTER_TEMPLATES)).toBeNull();
    // Two templates with the same ticks: the check-in items tell them apart.
    const permit = { id: 'permit', name: 'Permit job', items: STARTER_TEMPLATES[0].items, startAsks: [{ id: 'ask-p', label: 'Permit number', kind: 'answer' as const }] };
    const both = [STARTER_TEMPLATES[0], permit];
    expect(templateOf(permit.items, both, permit.startAsks)?.id).toBe('permit');
    expect(templateOf(permit.items, both, [])?.id).toBe(STARTER_TEMPLATES[0].id);
  });
});

describe('editing templates', () => {
  it('ticks and unticks in the standard order', () => {
    expect(toggleItem(['receipts'], 'travel')).toEqual(['travel', 'receipts']);
    expect(toggleItem(['travel', 'receipts'], 'travel')).toEqual(['receipts']);
  });

  it('adds a template with a tidy name and refuses a duplicate or an empty one', () => {
    const one = addTemplate([], '  Store   refresh ', ['photos', 'travel'], 'Ab12');
    expect(one).toEqual([{ id: 'store-refresh-ab12', name: 'Store refresh', items: ['travel', 'photos'] }]);
    expect(addTemplate(one!, 'store REFRESH', ['travel'], 'x9')).toBeNull();
    expect(addTemplate(one!, '   ', ['travel'], 'x9')).toBeNull();
    // Saved templates read back the same.
    expect(parseTemplates(one)).toEqual(one);
  });

  it('renames, changes items and removes', () => {
    const list = addTemplate(STARTER_TEMPLATES, 'Survey', ['photos'], 'q1')!;
    expect(renameTemplate(list, 'survey-q1', 'Full job')).toBeNull();
    expect(renameTemplate(list, 'survey-q1', 'Site survey')!.at(-1)!.name).toBe('Site survey');
    expect(setTemplateItems(list, 'survey-q1', []).at(-1)!.items).toEqual(['photos']);
    expect(setTemplateItems(list, 'survey-q1', ['notes', 'photos']).at(-1)!.items).toEqual(['photos', 'notes']);
    expect(removeTemplate(list, 'survey-q1')).toEqual(STARTER_TEMPLATES);
  });
});

describe('check-in items on templates', () => {
  it('keeps them with the template, and drops them when emptied', async () => {
    const { setTemplateStartAsks } = await import('./capture');
    const ask = { id: 'ask-1', label: 'Photo of the truck', kind: 'photo' as const };
    const list = setTemplateStartAsks(STARTER_TEMPLATES, 'portal', [ask]);
    expect(parseTemplates(JSON.parse(JSON.stringify(list)))[0]).toEqual({ ...STARTER_TEMPLATES[0], startAsks: [ask] });
    expect(setTemplateStartAsks(list, 'portal', [])[0]).toEqual(STARTER_TEMPLATES[0]);
  });
});
