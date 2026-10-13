import { describe, it, expect } from 'vitest';

import { compileFormula, evaluateFormula, validateFormula, FormulaError, FORMULA_VARIABLES } from '../services/payroll/formula.js';

/**
 * A salary formula is stored data that the server evaluates for every employee
 * in a payroll run. `eval` or `new Function` here would mean anyone who can
 * edit a salary component can run code inside the API process, against a
 * database holding everybody's pay — so the first group below is the one that
 * matters most. The rest hold the arithmetic a payslip depends on.
 */

const VARS = {
  BASIC: 40000,
  GROSS: 80000,
  CTC: 1200000,
  MONTHLY_CTC: 100000,
  WORKING_DAYS: 30,
  PAYABLE_DAYS: 24,
  LWP_DAYS: 6,
  VARIABLE_PAY: 5000,
  OVERTIME: 1200,
  PF_WAGE: 15000,
  ESI_WAGE: 21000,
};

describe('a formula cannot reach outside itself', () => {
  /* Each of these parses as perfectly ordinary JavaScript. None of them is a
     formula, and the grammar has no way to represent any of them. */
  const attacks = [
    'process.exit(1)',
    'require("fs")',
    'global.process',
    'constructor.constructor("return 1")()',
    'this.constructor',
    '(()=>1)()',
    'BASIC.toString',
    'BASIC["constructor"]',
    'import("fs")',
    'new Date()',
    'GROSS; process',
    'eval("1")',
    'BASIC = 99999',
    '`${BASIC}`',
    'a?.b',
  ];

  for (const source of attacks) {
    it(`refuses ${source}`, () => {
      expect(validateFormula(source).ok).toBe(false);
      expect(() => compileFormula(source)).toThrow(FormulaError);
    });
  }

  it('refuses a name that is not a payroll variable, however innocent', () => {
    const verdict = validateFormula('SALARY * 2');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain('SALARY');
  });

  it('refuses a function that is not on the list', () => {
    const verdict = validateFormula('SQRT(BASIC)');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain('SQRT');
  });

  it('never evaluates anything while merely validating a bad formula', () => {
    /* Validation is what runs against untrusted input first, so it must be
       total: a verdict, never a thrown error that a caller forgot to catch. */
    for (const source of [...attacks, '', '((', '1 +', '*/']) {
      expect(() => validateFormula(source)).not.toThrow();
      expect(validateFormula(source).ok).toBe(false);
    }
  });
});

describe('the arithmetic a payslip depends on', () => {
  it('works a percentage of a component', () => {
    expect(evaluateFormula('BASIC * 0.4', VARS)).toBe(16000);
  });

  it('keeps multiplication tighter than addition', () => {
    expect(evaluateFormula('BASIC + BASIC * 0.5', VARS)).toBe(60000);
    expect(evaluateFormula('(BASIC + BASIC) * 0.5', VARS)).toBe(40000);
  });

  it('prorates on days', () => {
    expect(evaluateFormula('BASIC * PAYABLE_DAYS / WORKING_DAYS', VARS)).toBe(32000);
  });

  it('reads a negative sign as a sign, not a subtraction', () => {
    expect(evaluateFormula('-BASIC + GROSS', VARS)).toBe(40000);
  });

  it('answers a condition', () => {
    expect(evaluateFormula('IF(GROSS > 50000, GROSS * 0.05, 0)', VARS)).toBe(4000);
    expect(evaluateFormula('IF(GROSS > 500000, GROSS * 0.05, 0)', VARS)).toBe(0);
  });

  it('caps and floors', () => {
    /* The shape of a PF contribution: 12% of wages, capped at the ceiling. */
    expect(evaluateFormula('MIN(BASIC * 0.12, 1800)', VARS)).toBe(1800);
    expect(evaluateFormula('MAX(BASIC * 0.001, 100)', VARS)).toBe(100);
  });

  it('rounds where a payslip would', () => {
    expect(evaluateFormula('ROUND(BASIC * 0.0333)', VARS)).toBe(1332);
    expect(evaluateFormula('FLOOR(BASIC * 0.0333)', VARS)).toBe(1332);
    expect(evaluateFormula('CEIL(BASIC * 0.03331)', VARS)).toBe(1333);
  });

  it('nests conditions the way a slab does', () => {
    const slab = 'IF(GROSS > 100000, 2500, IF(GROSS > 50000, 1800, 0))';
    expect(evaluateFormula(slab, { ...VARS, GROSS: 120000 })).toBe(2500);
    expect(evaluateFormula(slab, { ...VARS, GROSS: 80000 })).toBe(1800);
    expect(evaluateFormula(slab, { ...VARS, GROSS: 20000 })).toBe(0);
  });
});

describe('what it does when the numbers are awkward', () => {
  it('treats a variable nobody supplied as zero, not as nothing', () => {
    /* A structure that mentions overtime in a month with none should pay
       nothing, not produce a payslip reading NaN. */
    expect(evaluateFormula('BASIC + OVERTIME', { BASIC: 1000 })).toBe(1000);
  });

  it('refuses to divide by zero rather than printing Infinity on a payslip', () => {
    expect(() => evaluateFormula('BASIC / WORKING_DAYS', { BASIC: 1000, WORKING_DAYS: 0 })).toThrow(FormulaError);
    expect(validateFormula('BASIC / 0').ok).toBe(false);
  });

  it('refuses an empty formula', () => {
    expect(validateFormula('   ').ok).toBe(false);
  });

  it('refuses one too long to read', () => {
    expect(validateFormula(`BASIC${' + 1'.repeat(200)}`).ok).toBe(false);
  });

  it('says which bracket is missing rather than failing silently', () => {
    const verdict = validateFormula('IF(GROSS > 1, 2, 3');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toMatch(/bracket|ended/i);
  });

  it('counts the arguments a function was given', () => {
    const verdict = validateFormula('IF(GROSS > 1, 2)');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain('3');
  });
});

describe('what the screen is told', () => {
  it('reports which variables a formula uses, so a change of base can be traced', () => {
    const verdict = validateFormula('BASIC * 0.5 + OVERTIME');
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.variables.sort()).toEqual(['BASIC', 'OVERTIME']);
  });

  it('returns a worked sample, so somebody can see what it does before saving', () => {
    const verdict = validateFormula('BASIC * 0.5');
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.sample).toBe(20000);
  });

  it('offers a variable list the parser actually accepts', () => {
    /* The list the screen shows and the list the parser allows are the same
       list; a documented variable that is rejected on save is a trap. */
    for (const v of FORMULA_VARIABLES) {
      expect(validateFormula(`${v.name} * 1`).ok).toBe(true);
    }
  });

  it('is case-insensitive about names, because a person typing one is', () => {
    expect(evaluateFormula('basic * 0.5', VARS)).toBe(20000);
  });
});

describe('parsing once and using many times', () => {
  it('evaluates the same tree per employee without reparsing', () => {
    const compiled = compileFormula('BASIC * 0.4');
    expect(compiled.evaluate({ BASIC: 10000 })).toBe(4000);
    expect(compiled.evaluate({ BASIC: 50000 })).toBe(20000);
    expect(compiled.source).toBe('BASIC * 0.4');
  });
});
