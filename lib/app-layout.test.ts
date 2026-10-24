import { describe, expect, it } from 'vitest';
import {
  SCREENS, STANDARD_LAYOUT, addSection, isStandard, moveScreen, normalizeLayout, placeOf, removeSection,
  renameScreen, renameSection, resolveLayout, searchSections, sectionOfView, setHidden, setPartShown, shiftScreen,
  shiftSection, visibleLayout,
} from './app-layout';
import { PART_KEYS } from './screen-parts';

const std = () => normalizeLayout(STANDARD_LAYOUT);
const keysOf = (l: ReturnType<typeof std>) => [...l.main, ...l.sections.flatMap((s) => s.items)];

describe('menu layout (Settings -> Menu & screens)', () => {
  it('the standard menu: Dashboard, Dispatch, Schedule, Messages, Office, Settings — everything else in Office', () => {
    const r = visibleLayout(resolveLayout(std()));
    expect(r.main.map((s) => s.label)).toEqual(['Dashboard', 'Dispatch', 'Schedule', 'Messages', 'Office', 'Settings']);
    expect(r.sections.map((s) => s.title)).toEqual(['Every day', 'Money', 'Techs', 'Sales', 'On site']);
    expect(isStandard(STANDARD_LAYOUT)).toBe(true);
  });

  it('every screen appears exactly once, whatever was saved', () => {
    for (const saved of [null, 'junk', 42, {}, { main: 'x' }, { main: ['payments', 'payments', 'nope'], sections: [{ id: 'a', items: ['payments', 'ledger'] }] }]) {
      const keys = keysOf(normalizeLayout(saved));
      expect(keys.sort()).toEqual(Object.keys(SCREENS).sort());
    }
  });

  it('bad or old saved values fall back safely', () => {
    expect(normalizeLayout(null)).toEqual(std());
    const l = normalizeLayout({ main: ['dashboard'], sections: [{ id: 'money', title: '  Cash  ', items: ['ledger'] }], labels: { ledger: '  Books ', bogus: 'x', payments: '' }, hidden: ['office', 'settings', 'w9', 'nope'] });
    expect(l.main).toEqual(['dashboard', 'workorders', 'scheduling', 'messages', 'office', 'settings']); // the rest come back in their usual places
    expect(l.sections[0]).toMatchObject({ id: 'money', title: 'Cash' });
    expect(l.sections[0].items[0]).toBe('ledger');
    expect(l.labels).toEqual({ ledger: 'Books' });
    expect(l.hidden).toEqual(['w9']); // Office and Settings can never be hidden
  });

  it('a left-menu screen added later lands just under the one it follows', () => {
    // A menu saved before Messages existed, with Schedule moved to the bottom.
    const l = normalizeLayout({ main: ['dashboard', 'workorders', 'office', 'scheduling'], sections: STANDARD_LAYOUT.sections });
    expect(l.main).toEqual(['dashboard', 'workorders', 'office', 'settings', 'scheduling', 'messages']); // Settings under Office, Messages under Schedule
  });

  it('a screen added to the app later shows up in its standard section', () => {
    const saved = std();
    saved.sections = saved.sections.map((s) => ({ ...s, items: s.items.filter((k) => k !== 'quotes') }));
    const l = normalizeLayout(saved);
    expect(placeOf(l, 'quotes')).toBe('winning');
  });

  it('rename: kept as typed while typing, tidied on save, blank means the standard name', () => {
    let l = renameScreen(std(), 'sitelog', 'Visits ');
    expect(l.labels.sitelog).toBe('Visits ');
    const siteLog = (x: typeof l) => resolveLayout(x).sections[0].items.find((i) => i.key === 'sitelog')!;
    expect(siteLog(l).label).toBe('Visits');
    expect(normalizeLayout(l).labels.sitelog).toBe('Visits');
    l = renameScreen(l, 'sitelog', '');
    expect(siteLog(l).label).toBe('Site Log');
    expect(normalizeLayout(l).labels).toEqual({});
    expect(normalizeLayout(renameScreen(std(), 'sitelog', 'Site Log')).labels).toEqual({});
  });

  it('hide: off the menu but still listed for the editor; Office and Settings stay', () => {
    let l = setHidden(std(), 'w9', true);
    expect(resolveLayout(l).sections.find((s) => s.id === 'techs')!.items.find((i) => i.key === 'w9')!.hidden).toBe(true);
    expect(visibleLayout(resolveLayout(l)).sections.find((s) => s.id === 'techs')!.items.map((i) => i.key)).not.toContain('w9');
    expect(setHidden(l, 'settings', true)).toBe(l);
    expect(setHidden(l, 'office', true)).toBe(l);
    l = setHidden(l, 'w9', false);
    expect(l.hidden).toEqual([]);
  });

  it('a section with everything hidden drops off the menu', () => {
    const l = setHidden(setHidden(setHidden(std(), 'materials', true), 'maintenance', true), 'network', true);
    expect(visibleLayout(resolveLayout(l)).sections.map((s) => s.id)).not.toContain('onsite');
  });

  it('move a screen to the left menu, to another section, and back', () => {
    let l = moveScreen(std(), 'sitelog', 'main');
    expect(l.main).toEqual(['dashboard', 'workorders', 'scheduling', 'messages', 'office', 'settings', 'sitelog']);
    expect(sectionOfView(resolveLayout(l), 'sitelog')).toBeNull();
    l = moveScreen(l, 'sitelog', 'money');
    expect(placeOf(l, 'sitelog')).toBe('money');
    expect(sectionOfView(resolveLayout(l), 'sitelog')).toBe('money');
    expect(moveScreen(l, 'office', 'money')).toBe(l); // Office stays in the left menu
    expect(moveScreen(l, 'sitelog', 'no-such-section')).toBe(l);
  });

  it('up and down, for screens and sections, stop at the ends', () => {
    let l = shiftScreen(std(), 'office', -1);
    expect(l.main).toEqual(['dashboard', 'workorders', 'scheduling', 'office', 'messages', 'settings']);
    expect(shiftScreen(std(), 'dashboard', -1).main).toEqual(std().main);
    // Every day starts Projects, Field Sheet, Site Log (Projects added 2026-10-13, Field Sheet 2026-10-24).
    l = shiftScreen(std(), 'sitelog', -1);
    expect(l.sections[0].items.slice(0, 3)).toEqual(['projects', 'sitelog', 'fieldsheet']);
    expect(shiftScreen(std(), 'projects', -1).sections[0].items[0]).toBe('projects');
    l = shiftSection(std(), 'money', -1);
    expect(l.sections.map((s) => s.id).slice(0, 2)).toEqual(['money', 'everyday']);
    expect(shiftSection(std(), 'everyday', -1).sections).toEqual(std().sections);
  });

  it('add, rename and remove a section — only an empty one can go', () => {
    let l = addSection(std(), 'Billing', 'billing');
    expect(l.sections.at(-1)).toEqual({ id: 'billing', title: 'Billing', items: [] });
    l = renameSection(l, 'billing', 'Billing day');
    l = moveScreen(l, 'payments', 'billing');
    expect(removeSection(l, 'billing')).toBe(l);
    expect(visibleLayout(resolveLayout(l)).sections.find((s) => s.id === 'billing')!.title).toBe('Billing day');
    l = moveScreen(l, 'payments', 'money');
    expect(removeSection(l, 'billing').sections.map((s) => s.id)).not.toContain('billing');
    expect(isStandard(removeSection(l, 'billing'))).toBe(false); // Payments Made is now at the bottom of Money
  });

  it('a blank section name is saved as "Untitled section"', () => {
    const l = normalizeLayout(renameSection(std(), 'money', '   '));
    expect(l.sections.find((s) => s.id === 'money')!.title).toBe('Untitled section');
  });

  it('screen parts: off only for known parts; on again restores', () => {
    expect(normalizeLayout({ off: ['dash.kpis', 'dash.kpis', 'nope', 7] }).off).toEqual(['dash.kpis']);
    let l = setPartShown(std(), 'job.money', false);
    expect(l.off).toEqual(['job.money']);
    l = setPartShown(l, 'job.money', true);
    expect(l.off).toEqual([]);
    expect(isStandard(setPartShown(std(), 'card.price', false))).toBe(false);
  });

  it('every screen part has its own key', () => {
    expect(new Set(PART_KEYS).size).toBe(PART_KEYS.length);
  });

  it('search uses the new name and the standard one', () => {
    const r = resolveLayout(renameScreen(std(), 'payables', 'Payroll'));
    expect(searchSections(r.sections, 'payroll').flatMap((s) => s.items.map((i) => i.key))).toEqual(['payables']);
    expect(searchSections(r.sections, 'pay techs').flatMap((s) => s.items.map((i) => i.key))).toContain('payables');
    expect(searchSections(r.sections, 'zzz')).toEqual([]);
  });
});
