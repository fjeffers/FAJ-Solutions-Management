import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFICE_GROUPS, searchOffice } from './office-menu';

/** The view names in app/page.tsx's VIEWS list. */
function appViews(): string[] {
  const src = readFileSync(join(__dirname, '..', 'app', 'page.tsx'), 'utf8');
  const m = /const VIEWS = \[([\s\S]*?)\] as const;/.exec(src);
  if (!m) throw new Error('VIEWS list not found in app/page.tsx');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('Office hub', () => {
  it('lists every screen in the owner app, once', () => {
    const listed = OFFICE_GROUPS.flatMap((g) => g.items.map((i) => i.view)).filter((v): v is string => !!v);
    const views = appViews().filter((v) => v !== 'office');
    expect(views.length).toBeGreaterThan(20);
    expect([...listed].sort()).toEqual([...views].sort());
  });

  it('search matches name, hint and group, every word', () => {
    expect(searchOffice(OFFICE_GROUPS, '').length).toBe(OFFICE_GROUPS.length);
    const pay = searchOffice(OFFICE_GROUPS, 'pay').flatMap((g) => g.items.map((i) => i.label));
    expect(pay).toContain('Pay Techs');
    expect(pay).toContain('Payments Made');
    expect(searchOffice(OFFICE_GROUPS, 'tech map').flatMap((g) => g.items.map((i) => i.label))).toEqual(['Dispatch Map']);
    expect(searchOffice(OFFICE_GROUPS, 'zzz')).toEqual([]);
  });
});
