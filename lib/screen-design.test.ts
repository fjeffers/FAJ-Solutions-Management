import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MAX, DASH_PART_KEYS, JOB_PART_KEYS, STANDARD_DESIGN, addLinks, addNote, dashRows, editBlock, isStandardDesign,
  moveDashBefore, moveJob, normalizeDesign, removeBlock, setDashWidth, setDesignNow, designNow, shiftDash, shiftJob,
} from './screen-design';
import { SCREEN_PARTS } from './screen-parts';
import { STANDARD_LAYOUT, isStandardMenu, normalizeLayout, renameScreen, resetMenu, setPartShown } from './app-layout';

const std = () => normalizeDesign(STANDARD_DESIGN);
const keys = (d: ReturnType<typeof std>) => d.dash.map((b) => b.key);

describe('screen designer', () => {
  it('knows every Dashboard and job-page part listed in "What each screen shows"', () => {
    const parts = (screen: string) => SCREEN_PARTS.find((s) => s.screen === screen)!.parts.map((p) => p.key).sort();
    expect([...DASH_PART_KEYS].sort()).toEqual(parts('Dashboard'));
    expect([...JOB_PART_KEYS].sort()).toEqual(parts('Job page'));
  });

  it('nothing saved, or a damaged value, gives the standard screens', () => {
    expect(normalizeDesign(undefined)).toEqual(std());
    expect(normalizeDesign('nonsense')).toEqual(std());
    expect(isStandardDesign(normalizeDesign({ dash: 7, jobSide: 'x' }))).toBe(true);
  });

  it('a block missing from a saved design comes back in its standard place', () => {
    const d = normalizeDesign({ dash: [{ kind: 'part', key: 'dash.payments', width: 'full' }, { kind: 'part', key: 'dash.kpis', width: 'half' }] });
    // The field blocks, new on 2026-10-18, land after Needs your attention on a design saved before them.
    expect(keys(d)).toEqual(['dash.attention', 'dash.field', 'dash.coming', 'dash.payments', 'dash.kpis', 'dash.status', 'dash.outstanding']);
    expect(d.dash.find((b) => b.key === 'dash.kpis')!.width).toBe('half');
  });

  it('every job card sits in exactly one column', () => {
    // job.money and job.quickEdit are gone (Fred, 2026-10-18), so a saved layout drops them.
    const d = normalizeDesign({ jobSide: ['job.photos', 'job.fields', 'job.fields', 'job.money', 'nope'], jobBelow: ['job.photos', 'job.techs'] });
    expect(d.jobSide.slice(0, 2)).toEqual(['job.photos', 'job.fields']);
    expect(d.jobBelow[0]).toBe('job.techs');
    expect([...d.jobSide, ...d.jobBelow].sort()).toEqual([...JOB_PART_KEYS].sort());
  });

  it('half blocks pair up in a row; a lone half block takes the whole row', () => {
    const rows = (ws: ('full' | 'half')[]) => dashRows(ws.map((width, i) => ({ key: String(i), width }))).map((r) => r.map((b) => b.key).join('+'));
    expect(rows(['full', 'half', 'half', 'full'])).toEqual(['0', '1+2', '3']);
    expect(rows(['half', 'full', 'half', 'half', 'half'])).toEqual(['0', '1', '2+3', '4']);
  });

  it('reordering and widths', () => {
    let d = shiftDash(std(), 'dash.field', -1);
    expect(keys(d).slice(0, 2)).toEqual(['dash.field', 'dash.attention']);
    d = moveDashBefore(d, 'dash.payments', 'dash.field');
    expect(keys(d)[0]).toBe('dash.payments');
    d = moveDashBefore(d, 'dash.payments', null);
    expect(keys(d).at(-1)).toBe('dash.payments');
    expect(moveDashBefore(d, 'dash.payments', 'missing')).toBe(d);
    d = setDashWidth(d, 'dash.status', 'half');
    expect(normalizeDesign(d).dash.find((b) => b.key === 'dash.status')!.width).toBe('half');
  });

  it('notes and shortcut blocks: added at the top, edited, kept safe, removed', () => {
    let d = addNote(std(), 'note:a1');
    d = addLinks(d, 'links:b2');
    expect(keys(d).slice(0, 2)).toEqual(['links:b2', 'note:a1']);
    d = editBlock(d, 'note:a1', { title: 'Call   the bank', text: 'Before Friday\nAsk about the line', color: 'red' });
    d = editBlock(d, 'links:b2', { views: ['invoices', 'site-visits', 'not-a-screen'] });
    const saved = normalizeDesign(JSON.parse(JSON.stringify(d)), (v) => v !== 'not-a-screen');
    const note = saved.dash.find((b) => b.key === 'note:a1');
    expect(note).toMatchObject({ kind: 'note', title: 'Call the bank', text: 'Before Friday\nAsk about the line', color: 'red' });
    expect(saved.dash.find((b) => b.key === 'links:b2')).toMatchObject({ kind: 'links', views: ['invoices', 'site-visits'] });
    // Standard blocks can't be removed — only hidden.
    expect(keys(removeBlock(saved, 'dash.kpis'))).toContain('dash.kpis');
    expect(keys(removeBlock(saved, 'note:a1'))).not.toContain('note:a1');
  });

  it('a bad custom block is dropped, and there is a limit', () => {
    const d = normalizeDesign({ dash: [{ kind: 'note', key: 'note:BAD KEY' }, { kind: 'note', key: 'note:ok', color: 'neon' }, { kind: 'mystery', key: 'x' }] });
    expect(d.dash.filter((b) => b.kind !== 'part')).toEqual([{ kind: 'note', key: 'note:ok', width: 'half', title: '', text: '', color: 'plain' }]);
    let many = std();
    for (let i = 0; i < CUSTOM_MAX + 3; i++) many = addNote(many, `note:n${i}`);
    expect(many.dash.filter((b) => b.kind === 'note')).toHaveLength(CUSTOM_MAX);
  });

  it('job cards move up, down and between the columns', () => {
    // Standard side: time requests, techs, your fields. Your fields moves up one, above Techs.
    let d = shiftJob(std(), 'job.fields', -1);
    expect(d.jobSide.indexOf('job.fields')).toBe(1);
    d = moveJob(d, 'job.fields', 'below', 'job.report');
    expect(d.jobSide).not.toContain('job.fields');
    expect(d.jobBelow.indexOf('job.fields')).toBe(d.jobBelow.indexOf('job.report') - 1);
    d = moveJob(d, 'job.photos', 'side');
    expect(d.jobSide.at(-1)).toBe('job.photos');
    expect(moveJob(d, 'not.a.card', 'side')).toBe(d);
  });

  it('is saved with the menu, and resetting the menu keeps the arrangement', () => {
    const l = normalizeLayout({ ...STANDARD_LAYOUT, design: setDashWidth(std(), 'dash.kpis', 'half') });
    expect(l.design.dash.find((b) => b.key === 'dash.kpis')!.width).toBe('half');
    // A shortcut to a screen that no longer exists is dropped when the menu loads.
    const withLinks = normalizeLayout({ design: editBlock(addLinks(std(), 'links:x'), 'links:x', { views: ['invoices', 'gone-screen'] }) });
    expect(withLinks.design.dash.find((b) => b.key === 'links:x')).toMatchObject({ views: ['invoices'] });

    const changed = setPartShown(renameScreen(l, 'customers', 'Clients'), 'dash.status', false);
    expect(isStandardMenu(changed)).toBe(false);
    const reset = resetMenu(changed);
    expect(isStandardMenu(reset)).toBe(true);
    expect(reset.off).toEqual(['dash.status']);
    expect(reset.design.dash.find((b) => b.key === 'dash.kpis')!.width).toBe('half');
  });

  it('screens fall back to standard when nothing is set', () => {
    setDesignNow(undefined);
    expect(designNow()).toEqual(std());
  });
});
