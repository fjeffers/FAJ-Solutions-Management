import { describe, it, expect } from 'vitest';
import {
  asks, parseCapture, parseTemplates, templateOf, ALL_CAPTURE, STARTER_TEMPLATES, type JobTemplate,
  toggleItem, addTemplate, renameTemplate, setTemplateItems, removeTemplate,
} from './capture';

// Two of Fred's own templates, for the tests (there are no ready-made ones).
const PORTAL: JobTemplate = { id: 'portal', name: 'Client portal job', items: ['travel', 'odometer', 'receipts', 'notes'] };
const LDS: JobTemplate = { id: 'lds', name: 'LDS', items: [] };

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

  it('asks for nothing but time on site when a new job is left blank', () => {
    expect(ALL_CAPTURE.some((k) => asks([], k))).toBe(false);
  });

  it('keeps saved templates safe, offers no ready-made ones, and allows a blank one', () => {
    expect(STARTER_TEMPLATES).toEqual([]);
    expect(parseTemplates(undefined)).toEqual([]);
    const saved = parseTemplates([
      { id: 'cable', name: '  Cabling   install ', items: ['travel', 'photos', 'checklist', 'bogus'] },
      { id: 'cable', name: 'Duplicate id', items: ['travel'] },
      { id: 'BAD ID', name: 'x', items: ['travel'] },
      { id: 'empty', name: 'Nothing ticked', items: [] },
    ]);
    expect(saved).toEqual([
      { id: 'cable', name: 'Cabling install', items: ['travel', 'photos', 'checklist'] },
      { id: 'empty', name: 'Nothing ticked', items: [] },
    ]);
  });

  it('knows which template a job uses', () => {
    expect(templateOf(['notes', 'receipts', 'odometer', 'travel'], [PORTAL, LDS])?.id).toBe('portal');
    expect(templateOf(['travel'], [PORTAL, LDS])).toBeNull();
    expect(templateOf(null, [PORTAL, LDS])).toBeNull();
    expect(templateOf([], [PORTAL, LDS])?.id).toBe('lds');
    // Two templates with the same ticks: the check-in items tell them apart.
    const permit = { id: 'permit', name: 'Permit job', items: PORTAL.items, startAsks: [{ id: 'ask-p', label: 'Permit number', kind: 'answer' as const }] };
    const both = [PORTAL, permit];
    expect(templateOf(permit.items, both, permit.startAsks)?.id).toBe('permit');
    expect(templateOf(permit.items, both, [])?.id).toBe(PORTAL.id);
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
    const list = addTemplate([PORTAL], 'Survey', ['photos'], 'q1')!;
    expect(renameTemplate(list, 'survey-q1', 'Client portal job')).toBeNull();
    expect(renameTemplate(list, 'survey-q1', 'Site survey')!.at(-1)!.name).toBe('Site survey');
    expect(setTemplateItems(list, 'survey-q1', []).at(-1)!.items).toEqual([]);
    expect(setTemplateItems(list, 'survey-q1', ['notes', 'photos']).at(-1)!.items).toEqual(['photos', 'notes']);
    expect(removeTemplate(list, 'survey-q1')).toEqual([PORTAL]);
  });

  it('starts a new template blank', () => {
    expect(addTemplate([], 'LDS', [], 'z1')).toEqual([{ id: 'lds-z1', name: 'LDS', items: [] }]);
  });
});

describe('check-in items on templates', () => {
  it('keeps them with the template, and drops them when emptied', async () => {
    const { setTemplateStartAsks } = await import('./capture');
    const ask = { id: 'ask-1', label: 'Photo of the truck', kind: 'photo' as const };
    const list = setTemplateStartAsks([PORTAL], 'portal', [ask]);
    expect(parseTemplates(JSON.parse(JSON.stringify(list)))[0]).toEqual({ ...PORTAL, startAsks: [ask] });
    expect(setTemplateStartAsks(list, 'portal', [])[0]).toEqual(PORTAL);
  });
});

describe('the template a pasted job names (Generate with AI)', async () => {
  const { templateForText } = await import('./capture');
  it('picks the one template whose name is in the text as a word', () => {
    expect(templateForText('NetView LDS-1110 (Site ID 5011876) at 701 West Buford Street', [PORTAL, LDS])?.id).toBe('lds');
    expect(templateForText('A survey in Golden, CO', [{ id: 'old', name: 'Old', items: [] }])).toBeNull();
    expect(templateForText('Nothing to see', [PORTAL, LDS])).toBeNull();
  });
});
