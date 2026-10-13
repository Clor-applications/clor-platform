import { describe, expect, it } from 'vitest';

import {
  componentApplies,
  evaluateCondition,
  monthsOfService,
  type EligibilityFacts,
} from '../services/payroll/eligibility.js';

/**
 * Who gets paid what, and why.
 *
 * These are the rules that decide whether a component lands on somebody's
 * payslip, so every one of them is a statement about money. Two failure modes
 * matter more than the rest, and both are tested here rather than described:
 *
 *   paying somebody who should not be paid, quietly — a typo in a field name,
 *   an empty rule set, an operator this version does not know;
 *
 *   overriding a decision made by hand — a named exclusion losing to a rule.
 *
 * Both are errors in the direction nobody checks, because the payslip looks
 * ordinary either way.
 */

const person = (over: Partial<EligibilityFacts> = {}): EligibilityFacts => ({
  employeeId: 'emp-1',
  department: 'Engineering',
  designation: 'Engineer',
  status: 'ACTIVE',
  branchId: 'br-chennai',
  payrollStatus: 'IN_PAYROLL',
  payGroupId: 'pg-monthly',
  taxRegime: 'NEW',
  annualCtc: 1_200_000,
  monthlyCtc: 100_000,
  monthsOfService: 18,
  ...over,
});

describe('one condition, against one person', () => {
  it('compares text without caring about case or stray spaces', () => {
    expect(evaluateCondition({ field: 'department', operator: 'EQ', value: ' engineering ' }, person())).toBe(true);
    expect(evaluateCondition({ field: 'department', operator: 'EQ', value: 'Sales' }, person())).toBe(false);
    expect(evaluateCondition({ field: 'department', operator: 'NE', value: 'Sales' }, person())).toBe(true);
    expect(evaluateCondition({ field: 'designation', operator: 'CONTAINS', value: 'engin' }, person())).toBe(true);
  });

  it('reads a list the way somebody types one', () => {
    const c = { field: 'department', operator: 'IN', value: 'Sales, Engineering ,Support' };
    expect(evaluateCondition(c, person())).toBe(true);
    expect(evaluateCondition({ ...c, operator: 'NOT_IN' }, person())).toBe(false);
  });

  it('compares numbers as numbers', () => {
    expect(evaluateCondition({ field: 'annualCtc', operator: 'GT', value: '1000000' }, person())).toBe(true);
    expect(evaluateCondition({ field: 'annualCtc', operator: 'LT', value: '1000000' }, person())).toBe(false);
    expect(evaluateCondition({ field: 'monthsOfService', operator: 'GE', value: '12' }, person())).toBe(true);
    /* Text where a number belongs is not a match, and not a crash. */
    expect(evaluateCondition({ field: 'annualCtc', operator: 'GT', value: 'lots' }, person())).toBe(false);
  });

  it('treats a boolean as the flag it is', () => {
    expect(evaluateCondition({ field: 'pfApplicable', operator: 'EQ', value: 'true' }, person({ pfApplicable: true }))).toBe(true);
    expect(evaluateCondition({ field: 'pfApplicable', operator: 'EQ', value: 'false' }, person({ pfApplicable: true }))).toBe(false);
  });

  it('answers IS_SET on what is actually there', () => {
    expect(evaluateCondition({ field: 'costCenterId', operator: 'IS_NOT_SET' }, person())).toBe(true);
    expect(evaluateCondition({ field: 'costCenterId', operator: 'IS_SET' }, person({ costCenterId: 'cc-1' }))).toBe(true);
  });

  it('refuses a field it does not know rather than matching everybody', () => {
    /* A typo — `departmnet` — must not pay an allowance to the whole company.
       The expensive mistake is the permissive one, and it is invisible. */
    expect(evaluateCondition({ field: 'departmnet', operator: 'EQ', value: 'Engineering' }, person())).toBe(false);
    expect(evaluateCondition({ field: 'salary', operator: 'GT', value: '0' }, person())).toBe(false);
  });

  it('refuses an operator it does not know', () => {
    expect(evaluateCondition({ field: 'department', operator: 'MATCHES', value: 'Eng' }, person())).toBe(false);
  });

  it('does not let a blank value satisfy a negative test', () => {
    /* "Department is not Sales" against somebody with no department reads as
       true in plain English and pays an allowance for an incomplete record. */
    const nobody = person({ department: null });
    expect(evaluateCondition({ field: 'department', operator: 'NE', value: 'Sales' }, nobody)).toBe(false);
    expect(evaluateCondition({ field: 'department', operator: 'NOT_IN', value: 'Sales' }, nobody)).toBe(false);
  });
});

describe('whether a component applies at all', () => {
  const period = { periodStart: '2026-03-01', periodEnd: '2026-03-31' };

  it('keeps a structure component to the structure', () => {
    const c = { appliesTo: 'STRUCTURE' };
    expect(componentApplies(c, person(), { onStructure: true, ...period }).applies).toBe(true);
    expect(componentApplies(c, person(), { onStructure: false, ...period }).applies).toBe(false);
  });

  it('reaches everybody when it says so, structure or not', () => {
    const verdict = componentApplies({ appliesTo: 'ALL_EMPLOYEES' }, person(), { onStructure: false, ...period });
    expect(verdict.applies).toBe(true);
  });

  it('ANDs every condition', () => {
    const c = {
      appliesTo: 'CONDITIONS',
      conditions: [
        { field: 'department', operator: 'EQ', value: 'Engineering' },
        { field: 'annualCtc', operator: 'GE', value: '1000000' },
      ],
    };
    expect(componentApplies(c, person(), { onStructure: false, ...period }).applies).toBe(true);
    expect(componentApplies(c, person({ annualCtc: 500_000 }), { onStructure: false, ...period }).applies).toBe(false);
  });

  it('names the condition that failed, so a payslip can say why', () => {
    const c = {
      appliesTo: 'CONDITIONS',
      conditions: [{ field: 'department', operator: 'EQ', value: 'Sales' }],
    };
    const verdict = componentApplies(c, person(), { onStructure: false, ...period });
    expect(verdict.applies).toBe(false);
    expect(verdict.reason).toContain('department');
  });

  it('matches nobody when a conditional component has no conditions', () => {
    /* The empty rule set reads two ways, and one of them pays the whole
       company because somebody deleted the last row while editing. */
    const verdict = componentApplies({ appliesTo: 'CONDITIONS', conditions: [] }, person(), {
      onStructure: false,
      ...period,
    });
    expect(verdict.applies).toBe(false);
  });

  it('lets a named exclusion beat every rule', () => {
    const c = {
      appliesTo: 'ALL_EMPLOYEES',
      employeeTargets: [{ employeeId: 'emp-1', mode: 'EXCLUDE' }],
    };
    expect(componentApplies(c, person(), { onStructure: true, ...period }).applies).toBe(false);
  });

  it('lets an inclusion reach somebody the conditions miss', () => {
    const c = {
      appliesTo: 'CONDITIONS',
      conditions: [{ field: 'department', operator: 'EQ', value: 'Sales' }],
      employeeTargets: [{ employeeId: 'emp-1', mode: 'INCLUDE' }],
    };
    expect(componentApplies(c, person(), { onStructure: false, ...period }).applies).toBe(true);
  });

  it('prefers the exclusion when somebody is named twice', () => {
    const c = {
      appliesTo: 'ALL_EMPLOYEES',
      employeeTargets: [
        { employeeId: 'emp-1', mode: 'INCLUDE' },
        { employeeId: 'emp-1', mode: 'EXCLUDE' },
      ],
    };
    expect(componentApplies(c, person(), { onStructure: true, ...period }).applies).toBe(false);
  });

  it('places a one-time component in its own period and no other', () => {
    const c = { appliesTo: 'ALL_EMPLOYEES', oneTimeDate: '2026-03-15' };
    expect(componentApplies(c, person(), { onStructure: false, ...period }).applies).toBe(true);
    expect(
      componentApplies(c, person(), { onStructure: false, periodStart: '2026-04-01', periodEnd: '2026-04-30' }).applies
    ).toBe(false);
  });

  it('holds a one-time inclusion to that period too', () => {
    /* "March bonus, and include Priya" means include her in March — not in
       every month after it, which is what an inclusion that skipped the date
       check would do. */
    const c = {
      appliesTo: 'CONDITIONS',
      conditions: [{ field: 'department', operator: 'EQ', value: 'Sales' }],
      oneTimeDate: '2026-03-15',
      employeeTargets: [{ employeeId: 'emp-1', mode: 'INCLUDE' }],
    };
    expect(componentApplies(c, person(), { onStructure: false, ...period }).applies).toBe(true);
    expect(
      componentApplies(c, person(), { onStructure: false, periodStart: '2026-04-01', periodEnd: '2026-04-30' }).applies
    ).toBe(false);
  });
});

describe('length of service', () => {
  it('counts whole months, and not a day early', () => {
    expect(monthsOfService('2025-01-20', '2026-01-20')).toBe(12);
    expect(monthsOfService('2025-01-20', '2026-01-19')).toBe(11);
    expect(monthsOfService('2026-03-01', '2026-03-31')).toBe(0);
  });

  it('answers null rather than guessing when a date is missing', () => {
    expect(monthsOfService(null, '2026-01-01')).toBeNull();
    expect(monthsOfService('not a date', '2026-01-01')).toBeNull();
  });
});
