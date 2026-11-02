import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MONEY_TAB_VIEWS, OFFICE_GROUPS, SIDEBAR_VIEWS, officeGroupOf, searchOffice } from './office-menu';

/** The view names in app/page.tsx's VIEWS list. */
function appViews(): string[] {
  const src = readFileSync(join(__dirname, '..', 'app', 'admin', 'page.tsx'), 'utf8');
  const m = /const VIEWS = \[([\s\S]*?)\] as const;/.exec(src);
  if (!m) throw new Error('VIEWS list not found in app/admin/page.tsx');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('Office hub', () => {
  it('every screen is in the left menu, on the Office page or a tab of the Financials dashboard — once', () => {
    const listed = OFFICE_GROUPS.flatMap((g) => g.items.map((i) => i.view)).filter((v): v is string => !!v);
    const views = appViews();
    expect(views.length).toBeGreaterThan(20);
    expect([...listed, ...SIDEBAR_VIEWS, ...MONEY_TAB_VIEWS].sort()).toEqual([...views].sort());
  });

  it('knows which Office section a screen is in', () => {
    expect(officeGroupOf('financials')).toBe('Money');
    expect(officeGroupOf('payments')).toBeNull(); // a tab of the Financials dashboard
    expect(officeGroupOf('sitelog')).toBe('Jobs');
    expect(new Set(OFFICE_GROUPS.map((g) => g.id)).size).toBe(OFFICE_GROUPS.length);
    expect(officeGroupOf('dashboard')).toBeNull();
  });

  it('search matches name, hint and group, every word', () => {
    expect(searchOffice(OFFICE_GROUPS, '').length).toBe(OFFICE_GROUPS.length);
    const pay = searchOffice(OFFICE_GROUPS, 'pay').flatMap((g) => g.items.map((i) => i.label));
    // Pay Techs and Payments Made are tabs of the Financials dashboard now.
    expect(pay).toContain('Financials dashboard');
    expect(searchOffice(OFFICE_GROUPS, 'tech map').flatMap((g) => g.items.map((i) => i.label))).toEqual(['Dispatch Map']);
    expect(searchOffice(OFFICE_GROUPS, 'zzz')).toEqual([]);
  });
});
