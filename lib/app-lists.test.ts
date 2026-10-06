import { describe, expect, it } from 'vitest';
import {
  STANDARD_LISTS, addItem, choicesFor, isStandardLists, isUrgent, labelOf, normalizeLists, renameItem, renameStage,
  setItemHidden, setUrgent, shiftItem, stageName,
} from './app-lists';

const std = () => normalizeLists(STANDARD_LISTS);

describe('lists (Settings -> Lists & stages)', () => {
  it('standard lists match the job form as it was', () => {
    const l = std();
    expect(l.priorities.map((i) => i.key)).toEqual(['Low', 'Normal', 'High', 'Critical', 'Emergency']);
    expect(l.priorities.filter((i) => i.urgent).map((i) => i.key)).toEqual(['High', 'Critical', 'Emergency']);
    expect(l.sources[0].key).toBe('Internal');
    expect(isStandardLists(STANDARD_LISTS)).toBe(true);
    expect(stageName('open', l)).toBe('Needs a tech');
    expect(stageName('offered', l)).toBe('Awaiting response');
  });

  it('high priority: Emergency counts now (it never did), and Fred can choose', () => {
    expect(isUrgent('Emergency', std())).toBe(true);
    expect(isUrgent('critical', std())).toBe(true);
    expect(isUrgent('Normal', std())).toBe(false);
    expect(isUrgent('', std())).toBe(false);
    expect(isUrgent('urgent', std())).toBe(true); // an old value from email imports
    const l = setUrgent(std(), 'High', false);
    expect(isUrgent('High', l)).toBe(false);
  });

  it('bad or old saved values fall back safely; standard choices are never lost', () => {
    expect(normalizeLists(null)).toEqual(std());
    const l = normalizeLists({ stages: { open: '  Unassigned ', bogus: 'x', closed: 'Closed' }, priorities: [{ key: 'Rush', urgent: true }, { key: 'rush' }, 'junk'], sources: 'nope' });
    expect(l.stages).toEqual({ open: 'Unassigned' });
    expect(l.priorities.map((i) => i.key)).toEqual(['Rush', 'Low', 'Normal', 'High', 'Critical', 'Emergency']);
    expect(l.priorities[0]).toMatchObject({ label: 'Rush', urgent: true, hidden: false });
    expect(l.sources).toEqual(std().sources);
  });

  it('rename shows the new name everywhere; the value on jobs stays', () => {
    const l = normalizeLists(renameItem(std(), 'serviceTypes', 'Network / IT', 'Networking'));
    expect(labelOf('serviceTypes', 'Network / IT', l)).toBe('Networking');
    expect(labelOf('serviceTypes', 'network / it', l)).toBe('Networking');
    expect(labelOf('serviceTypes', 'Something old', l)).toBe('Something old');
    expect(choicesFor('serviceTypes', null, l)[0]).toEqual({ value: 'Network / IT', label: 'Networking' });
    expect(normalizeLists(renameItem(std(), 'serviceTypes', 'Network / IT', '  ')).serviceTypes[0].label).toBe('Network / IT');
  });

  it('a hidden choice is not offered — unless the job already has it', () => {
    const l = setItemHidden(std(), 'sources', 'Thumbtack', true);
    expect(choicesFor('sources', 'Internal', l).map((c) => c.value)).not.toContain('Thumbtack');
    expect(choicesFor('sources', 'Thumbtack', l).map((c) => c.value)).toContain('Thumbtack');
  });

  it("the job's own value is always a choice, spelled as stored", () => {
    expect(choicesFor('sources', 'fieldnation', std()).filter((c) => c.value.toLowerCase() === 'fieldnation')).toEqual([{ value: 'fieldnation', label: 'FieldNation' }]);
    expect(choicesFor('priorities', 'Whenever', std()).at(-1)).toEqual({ value: 'Whenever', label: 'Whenever' });
  });

  it('add, reorder; no blanks or repeats', () => {
    const l = addItem(std(), 'serviceTypes', 'Starlink')!;
    expect(l.serviceTypes.at(-1)).toEqual({ key: 'Starlink', label: 'Starlink', hidden: false });
    expect(addItem(l, 'serviceTypes', 'starlink')).toBeNull();
    expect(addItem(l, 'serviceTypes', '   ')).toBeNull();
    expect(addItem(std(), 'priorities', 'Rush')!.priorities.at(-1)).toMatchObject({ key: 'Rush', urgent: false });
    const m = shiftItem(l, 'serviceTypes', 'Starlink', -1);
    expect(m.serviceTypes.slice(-2).map((i) => i.key)).toEqual(['Starlink', 'Other']);
    expect(shiftItem(std(), 'priorities', 'Low', -1).priorities).toEqual(std().priorities);
  });

  it('stage names: renamed for the office, blank or same means standard', () => {
    expect(stageName('open', normalizeLists(renameStage(std(), 'open', 'Unassigned')))).toBe('Unassigned');
    expect(normalizeLists(renameStage(std(), 'open', '')).stages).toEqual({});
    expect(normalizeLists(renameStage(std(), 'open', 'Needs a tech')).stages).toEqual({});
  });
});
