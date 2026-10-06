// Fred's own fields on jobs, techs and customers (Settings -> Custom fields;
// Fred, 2026-10-05: "full admin privilege in settings").
//
// The definitions live on Fred's user_settings row (`fields`, migration 110);
// each job / tech / customer keeps its answers in its own `custom` column,
// keyed by the field's id — so renaming a field never loses an answer.
//
// Office only: the tech portal never receives these (migration 110 strips
// `custom` from the portal link; the tech app's functions name their columns).
//
// Nothing is deleted. "Remove" takes a field off the forms; its answers stay
// on the records, and Restore brings it back with them.

export type FieldKind = 'text' | 'longtext' | 'number' | 'date' | 'yesno' | 'choice';
export type FieldTarget = 'jobs' | 'techs' | 'customers';

export type FieldDef = { id: string; label: string; kind: FieldKind; options: string[]; hidden: boolean };
export type FieldSets = Record<FieldTarget, FieldDef[]>;
export type CustomValues = Record<string, unknown>;

export const FIELD_KINDS: { kind: FieldKind; label: string }[] = [
  { kind: 'text', label: 'Short text' },
  { kind: 'longtext', label: 'Long text' },
  { kind: 'number', label: 'Number' },
  { kind: 'date', label: 'Date' },
  { kind: 'yesno', label: 'Yes / No' },
  { kind: 'choice', label: 'Pick from a list' },
];
export const FIELD_TARGETS: { target: FieldTarget; label: string; one: string }[] = [
  { target: 'jobs', label: 'Jobs', one: 'job' },
  { target: 'techs', label: 'Techs', one: 'tech' },
  { target: 'customers', label: 'Customers', one: 'customer' },
];
export const FIELD_NAME_MAX = 40;
export const FIELD_LIMIT = 30;

const KINDS = new Set<string>(FIELD_KINDS.map((k) => k.kind));
const clean = (v: unknown, max = FIELD_NAME_MAX) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export const EMPTY_FIELDS: FieldSets = { jobs: [], techs: [], customers: [] };

function normalizeSet(raw: unknown): FieldDef[] {
  const out: FieldDef[] = [];
  const ids = new Set<string>();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const id = clean(rec.id, 40);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const kind = (KINDS.has(String(rec.kind)) ? rec.kind : 'text') as FieldKind;
    const options = Array.isArray(rec.options)
      ? [...new Set(rec.options.map((o) => clean(o, 60)).filter(Boolean))].slice(0, 50)
      : [];
    out.push({ id, label: clean(rec.label) || 'Untitled field', kind, options, hidden: rec.hidden === true });
    if (out.length >= FIELD_LIMIT * 2) break;
  }
  return out;
}

/** A saved value (or anything else) made safe to use. */
export function normalizeFields(raw: unknown): FieldSets {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { jobs: normalizeSet(src.jobs), techs: normalizeSet(src.techs), customers: normalizeSet(src.customers) };
}

// ── The definitions in use right now (set by the owner app) ──────────────────
let current: FieldSets = EMPTY_FIELDS;
export function setFieldsNow(f: FieldSets): void { current = f; }
export function fieldsNow(): FieldSets { return current; }

/** The fields shown on a form or record: not removed, in Fred's order. */
export function activeFields(target: FieldTarget, f: FieldSets = current): FieldDef[] {
  return f[target].filter((d) => !d.hidden);
}

// ── Answers ─────────────────────────────────────────────────────────────────

export function asValues(raw: unknown): CustomValues {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as CustomValues) } : {};
}

/**
 * Set one answer from a form box. Blank removes it. Numbers are stored as
 * numbers when they read as one (commas and $ allowed), otherwise as typed.
 */
export function setAnswer(values: CustomValues, def: FieldDef, input: string | boolean): CustomValues {
  const next = { ...values };
  if (def.kind === 'yesno') {
    if (input === true || input === 'yes') next[def.id] = true;
    else if (input === false || input === 'no') next[def.id] = false;
    else delete next[def.id];
    return next;
  }
  const text = String(input);
  if (!text.trim()) { delete next[def.id]; return next; }
  if (def.kind === 'number') {
    const n = Number(text.replace(/[$,\s]/g, ''));
    next[def.id] = text.trim() !== '' && Number.isFinite(n) && /\d/.test(text) && !/[^\d.,$\s-]/.test(text) ? n : text;
    return next;
  }
  next[def.id] = def.kind === 'longtext' ? text.slice(0, 4000) : text.slice(0, 500);
  return next;
}

/** What a form box shows for an answer. */
export function inputValue(values: CustomValues, def: FieldDef): string {
  const v = values[def.id];
  if (v === undefined || v === null) return '';
  if (def.kind === 'yesno') return v === true ? 'yes' : v === false ? 'no' : '';
  return String(v);
}

/** An answer as words, for a record's page. Empty string when there's none. */
export function displayAnswer(values: CustomValues, def: FieldDef): string {
  const v = values[def.id];
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (def.kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return String(v);
}

/** The answered fields on a record, as name/answer pairs (removed fields left out). */
export function answeredFields(target: FieldTarget, raw: unknown, f: FieldSets = current): { label: string; value: string }[] {
  const values = asValues(raw);
  return activeFields(target, f)
    .map((d) => ({ label: d.label, value: displayAnswer(values, d) }))
    .filter((x) => x.value !== '');
}

// ── Changes Fred makes in Settings. Each returns new field sets. ─────────────

const mapSet = (f: FieldSets, t: FieldTarget, g: (defs: FieldDef[]) => FieldDef[]): FieldSets => ({ ...f, [t]: g(f[t]) });

/** Null when the name is blank, already used, or there are too many fields. */
export function addField(f: FieldSets, t: FieldTarget, label: string, kind: FieldKind, id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`): FieldSets | null {
  const name = clean(label);
  if (!name || f[t].some((d) => d.label.toLowerCase() === name.toLowerCase())) return null;
  if (activeFields(t, f).length >= FIELD_LIMIT) return null;
  return mapSet(f, t, (defs) => [...defs, { id, label: name, kind: KINDS.has(kind) ? kind : 'text', options: [], hidden: false }]);
}

/** Kept as typed while Fred types; tidied on save. */
export function renameField(f: FieldSets, t: FieldTarget, id: string, label: string): FieldSets {
  return mapSet(f, t, (defs) => defs.map((d) => (d.id === id ? { ...d, label: label.slice(0, FIELD_NAME_MAX) } : d)));
}

export function setFieldKind(f: FieldSets, t: FieldTarget, id: string, kind: FieldKind): FieldSets {
  return mapSet(f, t, (defs) => defs.map((d) => (d.id === id ? { ...d, kind } : d)));
}

/** The choices for a "Pick from a list" field, typed one per line or comma-separated. */
export function setFieldOptions(f: FieldSets, t: FieldTarget, id: string, text: string): FieldSets {
  const options = text.split(/[\n,]/).map((o) => o.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return mapSet(f, t, (defs) => defs.map((d) => (d.id === id ? { ...d, options: [...new Set(options)].slice(0, 50) } : d)));
}

export function setFieldHidden(f: FieldSets, t: FieldTarget, id: string, hidden: boolean): FieldSets {
  return mapSet(f, t, (defs) => defs.map((d) => (d.id === id ? { ...d, hidden } : d)));
}

export function shiftField(f: FieldSets, t: FieldTarget, id: string, dir: -1 | 1): FieldSets {
  return mapSet(f, t, (defs) => {
    // Move among the fields on the form; removed ones keep their place behind.
    const active = defs.filter((d) => !d.hidden);
    const i = active.findIndex((d) => d.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= active.length) return defs;
    [active[i], active[j]] = [active[j], active[i]];
    return [...active, ...defs.filter((d) => d.hidden)];
  });
}
