import { describe, expect, it } from 'vitest';
import {
  EMPTY_FIELDS, activeFields, addField, answeredFields, displayAnswer, inputValue, normalizeFields, renameField,
  setAnswer, setFieldHidden, setFieldKind, setFieldOptions, shiftField, type FieldDef,
} from './custom-fields';

const withFields = () => {
  let f = addField(EMPTY_FIELDS, 'jobs', 'Gate code', 'text', 'gate')!;
  f = addField(f, 'jobs', 'Client PO', 'number', 'po')!;
  f = addField(f, 'jobs', 'Permit needed', 'yesno', 'permit')!;
  return f;
};
const def = (kind: FieldDef['kind'], id = 'x'): FieldDef => ({ id, label: 'X', kind, options: [], hidden: false });

describe('custom fields', () => {
  it('add fields; no blank or repeated names', () => {
    const f = withFields();
    expect(activeFields('jobs', f).map((d) => d.label)).toEqual(['Gate code', 'Client PO', 'Permit needed']);
    expect(addField(f, 'jobs', 'gate CODE', 'text')).toBeNull();
    expect(addField(f, 'jobs', '  ', 'text')).toBeNull();
    expect(addField(f, 'techs', 'Gate code', 'text')).not.toBeNull(); // each list is separate
  });

  it('bad or old saved values fall back safely', () => {
    expect(normalizeFields(null)).toEqual(EMPTY_FIELDS);
    const f = normalizeFields({ jobs: [{ id: 'a', label: '  Gate  code ', kind: 'weird' }, { id: 'a', label: 'dup' }, { label: 'no id' }, 'junk'], techs: 'nope' });
    expect(f.jobs).toEqual([{ id: 'a', label: 'Gate code', kind: 'text', options: [], hidden: false }]);
    expect(f.techs).toEqual([]);
  });

  it('answers: blank removes, numbers stored as numbers, yes/no as true/false', () => {
    let v = setAnswer({}, def('number', 'po'), '$1,250.50');
    expect(v).toEqual({ po: 1250.5 });
    v = setAnswer(v, def('number', 'po'), 'TBD');
    expect(v).toEqual({ po: 'TBD' }); // kept as typed rather than lost
    v = setAnswer(v, def('number', 'po'), '   ');
    expect(v).toEqual({});
    v = setAnswer(v, def('yesno', 'permit'), 'yes');
    expect(v).toEqual({ permit: true });
    expect(inputValue(v, def('yesno', 'permit'))).toBe('yes');
    v = setAnswer(v, def('yesno', 'permit'), '');
    expect(v).toEqual({});
  });

  it('answers read as words on the record', () => {
    expect(displayAnswer({ x: true }, def('yesno'))).toBe('Yes');
    expect(displayAnswer({ x: 1250.5 }, def('number'))).toBe('1,250.5');
    expect(displayAnswer({ x: '2026-10-05' }, def('date'))).toBe('Oct 5, 2026');
    expect(displayAnswer({}, def('text'))).toBe('');
  });

  it('rename keeps every answer; remove hides the field but keeps its answers', () => {
    let f = withFields();
    const record = { gate: '1234#', po: 88 };
    f = renameField(f, 'jobs', 'gate', 'Gate / door code');
    expect(answeredFields('jobs', record, normalizeFields(f))).toEqual([{ label: 'Gate / door code', value: '1234#' }, { label: 'Client PO', value: '88' }]);
    f = setFieldHidden(f, 'jobs', 'po', true);
    expect(answeredFields('jobs', record, f).map((x) => x.label)).toEqual(['Gate / door code']);
    f = setFieldHidden(f, 'jobs', 'po', false);
    expect(answeredFields('jobs', record, f).map((x) => x.label)).toContain('Client PO');
  });

  it('list choices: one per line or comma-separated, no repeats', () => {
    const f = setFieldOptions(setFieldKind(withFields(), 'jobs', 'gate', 'choice'), 'jobs', 'gate', 'North gate, South gate\nNorth gate\n\n');
    expect(f.jobs[0]).toMatchObject({ kind: 'choice', options: ['North gate', 'South gate'] });
  });

  it('reorder among the fields on the form', () => {
    let f = shiftField(withFields(), 'jobs', 'po', -1);
    expect(activeFields('jobs', f).map((d) => d.id)).toEqual(['po', 'gate', 'permit']);
    f = setFieldHidden(f, 'jobs', 'gate', true);
    f = shiftField(f, 'jobs', 'permit', -1);
    expect(activeFields('jobs', f).map((d) => d.id)).toEqual(['permit', 'po']);
    expect(shiftField(f, 'jobs', 'permit', -1)).toEqual(f);
  });
});
