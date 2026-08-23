import { describe, it, expect } from 'vitest';
import {
  runFormula, checkFormula, formatFormulaValue, normaliseFieldName, fieldsFrom, FUNCTION_NAMES,
} from './formula';

// A real Site Log row, in the words the grid uses for its headings.
const ROW = {
  'Date': '2026-08-21',
  'Customer/Brand': "Wendy's",
  'Site/Location': '1331',
  'Site Name': 'Hillside',
  'Hours': 2,
  'Price': 55,
  'Round Trip Miles': 117.4,
  'Mileage Total': 58.7,
  'Materials Cost': null,
  'Other Charges': null,
  'Invoice Status': 'not_invoiced',
  'Labor Total': 110,
  'Line Total': 168.7,
};

const run = (f: string, row = ROW) => runFormula(f, row);
const val = (f: string, row = ROW) => {
  const r = run(f, row);
  if (!r.ok) throw new Error(`expected success, got: ${r.error}`);
  return r.value;
};
const err = (f: string, row = ROW) => {
  const r = run(f, row);
  if (r.ok) throw new Error(`expected an error, got: ${String(r.value)}`);
  return r.error;
};

describe('column references', () => {
  it("accepts Monday's {Column} spelling", () => {
    expect(val('{Hours} * {Price}')).toBe(110);
  });

  it("accepts Smartsheet's [Column] spelling, with or without @row", () => {
    expect(val('[Hours] * [Price]')).toBe(110);
    expect(val('[Hours]@row * [Price]@row')).toBe(110);
  });

  it('matches a column name ignoring case, spaces and punctuation', () => {
    expect(val('{hours}')).toBe(2);
    expect(val('{LABOR TOTAL}')).toBe(110);
    expect(val('{roundtripmiles}')).toBe(117.4);
    expect(val('{Customer/Brand}')).toBe("Wendy's");
  });

  it('says which column is missing rather than failing silently', () => {
    expect(err('{Widgets} * 2')).toContain('Widgets');
  });

  it('treats an empty column as zero in arithmetic, not as an error', () => {
    expect(val('{Materials Cost} + 5')).toBe(5);
  });

  it('nudges towards brackets when a bare word is used', () => {
    expect(err('Hours * 2')).toContain('{Hours}');
  });
});

describe('arithmetic', () => {
  it('follows precedence, not left to right', () => {
    expect(val('2 + 3 * 4')).toBe(14);
    expect(val('(2 + 3) * 4')).toBe(20);
  });

  it('handles negatives and decimals', () => {
    expect(val('-5 + 2.5')).toBe(-2.5);
    expect(val('0.1 + 0.2')).toBe(0.3);   // not 0.30000000000000004
  });

  it('raises to a power, right-associatively', () => {
    expect(val('2 ^ 3')).toBe(8);
    expect(val('2 ^ 3 ^ 2')).toBe(512);   // 2^(3^2), not (2^3)^2
  });

  it('refuses to divide by zero instead of returning Infinity', () => {
    expect(err('{Line Total} / 0')).toContain('divide by zero');
  });

  it('rebuilds the Line Total from its parts', () => {
    expect(val('{Labor Total} + {Mileage Total} + {Materials Cost} + {Other Charges}')).toBe(168.7);
  });
});

describe('comparison and logic', () => {
  it('compares numbers as numbers', () => {
    expect(val('{Hours} > 1')).toBe(true);
    expect(val('{Hours} >= 2')).toBe(true);
    expect(val('{Hours} <> 3')).toBe(true);
  });

  it('compares text as text, ignoring case', () => {
    expect(val('{Invoice Status} = "not_invoiced"')).toBe(true);
    expect(val('{Site Name} = "hillside"')).toBe(true);
  });

  it('reads a comparison after arithmetic, the way a spreadsheet does', () => {
    expect(val('1 + 1 = 2')).toBe(true);
  });

  it('supports AND, OR and NOT', () => {
    expect(val('{Hours} > 1 AND {Line Total} > 100')).toBe(true);
    expect(val('{Hours} > 5 OR {Line Total} > 100')).toBe(true);
    expect(val('NOT({Hours} > 5)')).toBe(true);
  });
});

describe('functions', () => {
  it('IF picks a branch', () => {
    expect(val('IF({Invoice Status} = "not_invoiced", "BILL ME", "done")')).toBe('BILL ME');
  });

  it('IF does not evaluate the branch it does not take', () => {
    // The false branch divides by zero. Taking the true branch must not blow up.
    expect(val('IF({Hours} > 0, {Line Total} / {Hours}, {Line Total} / 0)')).toBe(84.35);
  });

  it('SUM, MIN, MAX, AVG and COUNT ignore blanks', () => {
    expect(val('SUM({Labor Total}, {Mileage Total}, {Materials Cost})')).toBe(168.7);
    expect(val('MIN({Hours}, {Price})')).toBe(2);
    expect(val('MAX({Hours}, {Price})')).toBe(55);
    expect(val('AVG(2, 4, 6)')).toBe(4);
    expect(val('COUNT({Hours}, {Materials Cost})')).toBe(1);
  });

  it('rounds', () => {
    expect(val('ROUND(168.749, 1)')).toBe(168.7);
    expect(val('ROUND(2.5)')).toBe(3);
    expect(val('ROUNDUP(2.1)')).toBe(3);
    expect(val('ROUNDDOWN(2.9)')).toBe(2);
  });

  it('works with text', () => {
    expect(val('CONCAT({Site Name}, " #", {Site/Location})')).toBe('Hillside #1331');
    expect(val('{Site Name} & " " & {Site/Location}')).toBe('Hillside 1331');
    expect(val('UPPER({Site Name})')).toBe('HILLSIDE');
    expect(val('LEN({Site Name})')).toBe(8);
    expect(val('CONTAINS("hill", {Site Name})')).toBe(true);
  });

  it('answers whether a cell is blank', () => {
    expect(val('ISBLANK({Materials Cost})')).toBe(true);
    expect(val('ISBLANK({Hours})')).toBe(false);
  });

  it('does date arithmetic', () => {
    expect(val('DAYS("2026-08-21", "2026-08-01")')).toBe(20);
    expect(val('YEAR({Date})')).toBe(2026);
    expect(val('MONTH({Date})')).toBe(8);
  });

  it('IFERROR catches a bad calculation', () => {
    expect(val('IFERROR({Line Total} / 0, "n/a")')).toBe('n/a');
  });

  it('names an unknown function rather than guessing', () => {
    expect(err('VLOOKUP(1)')).toContain('VLOOKUP');
  });
});

describe('the formulas Fred would actually write', () => {
  it('profit margin on a visit', () => {
    expect(val('ROUND({Labor Total} / {Line Total}, 2)')).toBe(0.65);
  });

  it('effective hourly rate including travel', () => {
    expect(val('IF({Hours} = 0, 0, ROUND({Line Total} / {Hours}, 2))')).toBe(84.35);
  });

  it('flags anything still unbilled', () => {
    expect(val('IF({Invoice Status} = "not_invoiced", "⚠ UNBILLED", "")')).toBe('⚠ UNBILLED');
  });

  it('travel as a share of the job', () => {
    expect(val('ROUND({Mileage Total} / {Line Total}, 3)')).toBe(0.348);
  });

  it('cost per mile driven', () => {
    expect(val('ROUND({Line Total} / {Round Trip Miles}, 2)')).toBe(1.44);
  });

  it('a two-hour minimum top-up', () => {
    expect(val('IF({Hours} < 2, (2 - {Hours}) * {Price}, 0)', { ...ROW, Hours: 0.75 })).toBe(68.75);
  });
});

describe('errors are reported, never thrown', () => {
  it('an unclosed bracket', () => {
    expect(err('({Hours} * 2')).toContain(')');
  });

  it('an unclosed column reference', () => {
    expect(err('{Hours * 2')).toContain('}');
  });

  it('an unclosed quote', () => {
    expect(err('CONCAT("abc)')).toContain('quote');
  });

  it('a stray character', () => {
    expect(err('{Hours} $ 2')).toContain('$');
  });

  it('trailing rubbish', () => {
    expect(err('{Hours} 2')).toContain('extra');
  });

  it('an empty formula is blank, not an error', () => {
    expect(val('')).toBe(null);
    expect(val('   ')).toBe(null);
  });

  it('a leading = is accepted, as in a spreadsheet', () => {
    expect(val('={Hours} * {Price}')).toBe(110);
  });
});

describe('nothing escapes the evaluator', () => {
  // A formula is user input stored in the database and run in every browser
  // that opens the grid. These must be parse errors, not code.
  const attacks = [
    'constructor',
    'this.constructor.constructor("return 1")()',
    'process.exit(1)',
    'globalThis',
    '__proto__',
    'window.location = "x"',
    'fetch("https://example.com")',
    'require("fs")',
    'eval("1+1")',
    '[].constructor',
  ];
  for (const a of attacks) {
    it(`refuses ${a}`, () => {
      const r = run(a);
      // Either it fails to parse, or it is treated as an unknown name/column —
      // never executed.
      expect(r.ok).toBe(false);
    });
  }

  it('a column whose value is a string is never run as code', () => {
    const r = runFormula('{Notes}', { Notes: 'alert(1)' });
    expect(r).toEqual({ ok: true, value: 'alert(1)' });
  });
});

describe('checkFormula', () => {
  it('accepts a formula that only uses known columns', () => {
    expect(checkFormula('{Hours} * {Price}', ['Hours', 'Price']).ok).toBe(true);
  });

  it('rejects one that references a column that does not exist', () => {
    const r = checkFormula('{Widgets}', ['Hours']);
    expect(r.ok).toBe(false);
  });
});

describe('formatting', () => {
  it('shows money, percent, number and text', () => {
    expect(formatFormulaValue(168.7, 'money')).toBe('$168.70');
    expect(formatFormulaValue(0.65, 'percent')).toBe('65%');
    expect(formatFormulaValue(168.749, 'number')).toBe('168.75');
    expect(formatFormulaValue('Hillside', 'text')).toBe('Hillside');
  });

  it('shows a true/false result as Yes/No', () => {
    expect(formatFormulaValue(true, 'text')).toBe('Yes');
    expect(formatFormulaValue(false, 'number')).toBe('No');
  });

  it('shows nothing for a blank result', () => {
    expect(formatFormulaValue(null, 'money')).toBe('');
  });
});

describe('helpers', () => {
  it('normalises a column name', () => {
    expect(normaliseFieldName('Round Trip Miles')).toBe('roundtripmiles');
    expect(normaliseFieldName('Customer/Brand')).toBe('customerbrand');
  });

  it('builds the lookup from a row', () => {
    expect(fieldsFrom({ 'Labor Total': 110 })).toEqual({ labortotal: 110 });
  });

  it('lists the functions it supports, for the editor to show', () => {
    expect(FUNCTION_NAMES).toContain('IF');
    expect(FUNCTION_NAMES).toContain('ROUND');
    expect(FUNCTION_NAMES.length).toBeGreaterThan(20);
  });
});
