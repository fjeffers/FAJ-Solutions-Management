// A spreadsheet formula language for user-defined columns.
//
// Fred asked for "Smartsheet's formula and Monday's formula" in his own app.
// Both are the same idea: a column whose value is computed from the other
// columns on the row, written by the person using it rather than by a
// developer. The two differ mainly in how they name a column —
//
//   Monday      {Hours} * {Labor Rate}
//   Smartsheet  [Hours]@row * [Labor Rate]@row
//
// — so both spellings are accepted, and @row is allowed and ignored, because
// every formula here is a per-row formula.
//
// This is a real tokenizer and parser, NOT eval(). A formula is typed by the
// user and stored in the database; handing that to eval would let anything
// with write access to a settings row run arbitrary code in every browser
// that opens the page. There is no way to reach outside this evaluator: it
// knows numbers, strings, booleans, the field values it is handed, and the
// functions listed below.

import { todayISO } from './utils';

export type FormulaValue = number | string | boolean | null;
export type FormulaFields = Record<string, FormulaValue>;

export class FormulaError extends Error {}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type Tok =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'field'; v: string }
  | { k: 'name'; v: string }
  | { k: 'op'; v: string }
  | { k: '('; }
  | { k: ')'; }
  | { k: ','; }
  | { k: 'end' };

const OPERATORS = ['<>', '>=', '<=', '!=', '+', '-', '*', '/', '^', '%', '=', '>', '<', '&'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (/\s/.test(c)) { i++; continue; }

    // {Column} — Monday's spelling
    if (c === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new FormulaError('A { is missing its closing }');
      out.push({ k: 'field', v: src.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }

    // [Column] — Smartsheet's spelling, optionally followed by @row
    if (c === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new FormulaError('A [ is missing its closing ]');
      out.push({ k: 'field', v: src.slice(i + 1, end).trim() });
      i = end + 1;
      // @row means "this row", which is the only row a column formula sees.
      if (src.slice(i).match(/^\s*@row/i)) i += src.slice(i).match(/^\s*@row/i)![0].length;
      continue;
    }

    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new FormulaError('A quoted text value is missing its closing quote');
      out.push({ k: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      out.push({ k: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i))!;
      out.push({ k: 'name', v: m[0] });
      i += m[0].length;
      continue;
    }

    if (c === '(') { out.push({ k: '(' }); i++; continue; }
    if (c === ')') { out.push({ k: ')' }); i++; continue; }
    if (c === ',' || c === ';') { out.push({ k: ',' }); i++; continue; }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ k: 'op', v: op }); i += op.length; continue; }

    throw new FormulaError(`I don't understand the character "${c}"`);
  }
  out.push({ k: 'end' });
  return out;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

type Node =
  | { t: 'lit'; v: FormulaValue }
  | { t: 'field'; name: string }
  | { t: 'unary'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

// Higher binds tighter. Comparison sits below arithmetic so 1 + 1 = 2 parses
// as (1 + 1) = 2, the way a spreadsheet reads it.
const PRECEDENCE: Record<string, number> = {
  OR: 1, AND: 2,
  '=': 3, '<>': 3, '!=': 3, '>': 3, '<': 3, '>=': 3, '<=': 3,
  '&': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
  '^': 7,
};

function parse(tokens: Tok[]): Node {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(minPrec = 0): Node {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      let op: string | null = null;
      if (t.k === 'op') op = t.v;
      else if (t.k === 'name' && /^(AND|OR)$/i.test(t.v)) op = t.v.toUpperCase();
      if (!op) break;

      const prec = PRECEDENCE[op];
      if (prec == null || prec < minPrec) break;
      next();
      // ^ is right-associative, everything else left.
      const right = parseExpr(op === '^' ? prec : prec + 1);
      left = { t: 'bin', op, a: left, b: right };
    }
    return left;
  }

  function parseUnary(): Node {
    const t = peek();
    if (t.k === 'op' && (t.v === '-' || t.v === '+')) {
      next();
      return { t: 'unary', op: t.v, a: parseUnary() };
    }
    if (t.k === 'name' && /^NOT$/i.test(t.v) && tokens[pos + 1]?.k === '(') {
      // NOT( ... ) is handled as a call, below.
    }
    return parsePrimary();
  }

  function parsePrimary(): Node {
    const t = next();
    switch (t.k) {
      case 'num': return { t: 'lit', v: t.v };
      case 'str': return { t: 'lit', v: t.v };
      case 'field': return { t: 'field', name: t.v };
      case '(': {
        const inner = parseExpr(0);
        if (next().k !== ')') throw new FormulaError('A ( is missing its closing )');
        return inner;
      }
      case 'name': {
        const upper = t.v.toUpperCase();
        if (upper === 'TRUE') return { t: 'lit', v: true };
        if (upper === 'FALSE') return { t: 'lit', v: false };
        if (peek().k === '(') {
          next();
          const args: Node[] = [];
          if (peek().k !== ')') {
            for (;;) {
              args.push(parseExpr(0));
              const sep = peek();
              if (sep.k === ',') { next(); continue; }
              break;
            }
          }
          if (next().k !== ')') throw new FormulaError(`${upper}( is missing its closing )`);
          return { t: 'call', name: upper, args };
        }
        // A bare word is almost always a column someone forgot to bracket.
        throw new FormulaError(`"${t.v}" is not a function. For a column, write {${t.v}}`);
      }
      default:
        throw new FormulaError('The formula ends before it is finished');
    }
  }

  const node = parseExpr(0);
  if (peek().k !== 'end') throw new FormulaError('There is something extra at the end of the formula');
  return node;
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

const num = (v: FormulaValue): number => {
  if (v == null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  if (isNaN(n)) throw new FormulaError(`"${v}" is not a number`);
  return n;
};

const str = (v: FormulaValue): string => (v == null ? '' : String(v));

const bool = (v: FormulaValue): boolean => {
  if (typeof v === 'boolean') return v;
  if (v == null || v === '') return false;
  if (typeof v === 'number') return v !== 0;
  return true;
};

/** Days between two dates, for DAYS() and date arithmetic. */
function toDate(v: FormulaValue): Date {
  const d = new Date(String(v ?? ''));
  if (isNaN(d.getTime())) throw new FormulaError(`"${v}" is not a date`);
  return d;
}

const round = (n: number, places = 0) => {
  const f = Math.pow(10, places);
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Flattened arguments, so SUM(a, b, c) and SUM(a) both work. */
const nums = (args: FormulaValue[]): number[] => args.filter((a) => a !== null && a !== '').map(num);

type Fn = (args: FormulaValue[]) => FormulaValue;

const FUNCTIONS: Record<string, Fn> = {
  IF:      (a) => (bool(a[0]) ? (a[1] ?? null) : (a[2] ?? null)),
  IFERROR: (a) => a[0] ?? a[1] ?? null,
  AND:     (a) => a.every(bool),
  OR:      (a) => a.some(bool),
  NOT:     (a) => !bool(a[0]),

  SUM:     (a) => round(nums(a).reduce((s, n) => s + n, 0), 10),
  AVG:     (a) => { const v = nums(a); return v.length ? round(v.reduce((s, n) => s + n, 0) / v.length, 10) : 0; },
  AVERAGE: (a) => FUNCTIONS.AVG(a),
  MIN:     (a) => { const v = nums(a); return v.length ? Math.min(...v) : 0; },
  MAX:     (a) => { const v = nums(a); return v.length ? Math.max(...v) : 0; },
  COUNT:   (a) => a.filter((x) => x !== null && x !== '').length,
  ABS:     (a) => Math.abs(num(a[0])),
  ROUND:   (a) => round(num(a[0]), a.length > 1 ? num(a[1]) : 0),
  ROUNDUP: (a) => { const f = Math.pow(10, a.length > 1 ? num(a[1]) : 0); return Math.ceil(num(a[0]) * f) / f; },
  ROUNDDOWN: (a) => { const f = Math.pow(10, a.length > 1 ? num(a[1]) : 0); return Math.floor(num(a[0]) * f) / f; },
  CEILING: (a) => Math.ceil(num(a[0])),
  FLOOR:   (a) => Math.floor(num(a[0])),
  POWER:   (a) => Math.pow(num(a[0]), num(a[1])),
  SQRT:    (a) => Math.sqrt(num(a[0])),

  LEN:     (a) => str(a[0]).length,
  LEFT:    (a) => str(a[0]).slice(0, num(a[1] ?? 1)),
  RIGHT:   (a) => str(a[0]).slice(-num(a[1] ?? 1)),
  UPPER:   (a) => str(a[0]).toUpperCase(),
  LOWER:   (a) => str(a[0]).toLowerCase(),
  TRIM:    (a) => str(a[0]).trim(),
  CONCAT:  (a) => a.map(str).join(''),
  CONCATENATE: (a) => a.map(str).join(''),
  CONTAINS: (a) => str(a[1]).toLowerCase().includes(str(a[0]).toLowerCase()),

  ISBLANK: (a) => a[0] === null || a[0] === '' || a[0] === undefined,
  ISNUMBER: (a) => a[0] !== null && a[0] !== '' && !isNaN(Number(a[0])),

  // Eastern, like every other date in the app — not the UTC day.
  TODAY:   () => todayISO(),
  YEAR:    (a) => toDate(a[0]).getFullYear(),
  MONTH:   (a) => toDate(a[0]).getMonth() + 1,
  DAY:     (a) => toDate(a[0]).getDate(),
  // Smartsheet's argument order: DAYS(later, earlier).
  DAYS:    (a) => Math.round((toDate(a[0]).getTime() - toDate(a[1]).getTime()) / 86_400_000),
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();

function evaluate(node: Node, fields: FormulaFields): FormulaValue {
  switch (node.t) {
    case 'lit': return node.v;

    case 'field': {
      // Column names are matched case- and space-insensitively, so {laborrate}
      // finds "Labor Rate". Typing the header exactly is a lot to ask.
      const key = normaliseFieldName(node.name);
      if (!(key in fields)) {
        throw new FormulaError(`There is no column called "${node.name}"`);
      }
      return fields[key];
    }

    case 'unary': {
      const v = evaluate(node.a, fields);
      return node.op === '-' ? -num(v) : num(v);
    }

    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`There is no function called ${node.name}`);
      // IF must not evaluate the branch it does not take, so a formula can
      // guard a division: IF({Hours} = 0, 0, {Total} / {Hours}).
      if (node.name === 'IF') {
        const test = bool(evaluate(node.args[0], fields));
        const branch = test ? node.args[1] : node.args[2];
        return branch ? evaluate(branch, fields) : null;
      }
      if (node.name === 'IFERROR') {
        try { return evaluate(node.args[0], fields); }
        catch { return node.args[1] ? evaluate(node.args[1], fields) : null; }
      }
      return fn(node.args.map((a) => evaluate(a, fields)));
    }

    case 'bin': {
      if (node.op === 'AND') return bool(evaluate(node.a, fields)) && bool(evaluate(node.b, fields));
      if (node.op === 'OR') return bool(evaluate(node.a, fields)) || bool(evaluate(node.b, fields));

      const a = evaluate(node.a, fields);
      const b = evaluate(node.b, fields);

      switch (node.op) {
        case '&': return str(a) + str(b);
        case '+': return round(num(a) + num(b), 10);
        case '-': return round(num(a) - num(b), 10);
        case '*': return round(num(a) * num(b), 10);
        case '/':
          if (num(b) === 0) throw new FormulaError('Cannot divide by zero');
          return round(num(a) / num(b), 10);
        case '%': return num(a) % num(b);
        case '^': return Math.pow(num(a), num(b));
        // Text compares as text, everything else as a number, so "Paid" = "Paid"
        // works and 2 = 2.0 works.
        case '=':  return compare(a, b) === 0;
        case '<>':
        case '!=': return compare(a, b) !== 0;
        case '>':  return compare(a, b) > 0;
        case '<':  return compare(a, b) < 0;
        case '>=': return compare(a, b) >= 0;
        case '<=': return compare(a, b) <= 0;
        default: throw new FormulaError(`I don't understand the operator "${node.op}"`);
      }
    }
  }
}

function compare(a: FormulaValue, b: FormulaValue): number {
  const bothNumeric =
    (a === null || a === '' || !isNaN(Number(a))) &&
    (b === null || b === '' || !isNaN(Number(b)));
  if (bothNumeric) return num(a) - num(b);
  const as = str(a).toLowerCase();
  const bs = str(b).toLowerCase();
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** Column names match ignoring case, spaces and punctuation. */
export function normaliseFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Build the lookup a formula sees, keyed so {Labor Rate} finds "Labor Rate". */
export function fieldsFrom(row: Record<string, FormulaValue>): FormulaFields {
  const out: FormulaFields = {};
  for (const [k, v] of Object.entries(row)) out[normaliseFieldName(k)] = v;
  return out;
}

export type FormulaResult =
  | { ok: true; value: FormulaValue }
  | { ok: false; error: string };

/**
 * Run a formula against one row.
 *
 * Never throws: a bad formula is an everyday event when it is being typed, and
 * one broken column must not take down the grid it lives in.
 */
export function runFormula(expression: string, row: Record<string, FormulaValue>): FormulaResult {
  const src = (expression ?? '').trim().replace(/^=/, '');
  if (!src) return { ok: true, value: null };
  try {
    return { ok: true, value: evaluate(parse(tokenize(src)), fieldsFrom(row)) };
  } catch (e) {
    return { ok: false, error: e instanceof FormulaError ? e.message : 'That formula could not be worked out' };
  }
}

/**
 * Check a formula without a row — for the editor, so a mistake is caught as it
 * is typed rather than as a column of errors. Field values are stubbed, so this
 * catches spelling and shape, not arithmetic on real data.
 */
export function checkFormula(expression: string, columnNames: string[]): FormulaResult {
  const stub: Record<string, FormulaValue> = {};
  for (const n of columnNames) stub[n] = 1;
  return runFormula(expression, stub);
}

/** How a computed value is shown. */
export type FormulaFormat = 'number' | 'money' | 'percent' | 'text';

export function formatFormulaValue(v: FormulaValue, format: FormulaFormat): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (format === 'text') return String(v);
  const n = Number(v);
  if (isNaN(n)) return String(v);
  if (format === 'money') {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  if (format === 'percent') return `${round(n * 100, 1)}%`;
  return String(round(n, 2));
}
