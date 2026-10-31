import { describe, expect, it } from 'vitest';

/**
 * The approval rule spec, version 2 (docs/people/workflow-engine/SPEC.md 5.2),
 * on its own: a version 1 rule normalises to version 2 and reads back the
 * same, its conditions decide exactly as the first engine's did, and
 * cleanRule refuses what the spec refuses, naming the step and field.
 */
const { normaliseSteps, normaliseStep, toV1, legacySteps, v1Exact, holds, allHold, cleanRule, isRuleProblem } = await import('../services/people/approvals/spec.js');
const { conditionHolds } = await import('../services/people/approvals/engine.js');

/* Today's preset rules, as the modules write them (selfService, leaving, money/expenses, shiftSwaps, requestForms), and SPEC 5.4's chains in the first shape. */
const PRESETS: Record<string, any[]> = {
  PROFILE_CHANGE: [{ order: 1, approver: { kind: 'HR' }, dueDays: 5, overdue: { action: 'REMIND' } }],
  LEAVING: [
    { order: 1, approver: { kind: 'MANAGER' }, dueDays: 3, overdue: { action: 'HAND_ON', to: { kind: 'HR' } } },
    { order: 2, approver: { kind: 'HR' }, dueDays: 3, overdue: { action: 'REMIND' } },
  ],
  EXPENSE_CLAIM: [
    { order: 1, approver: { kind: 'MANAGER' }, dueDays: 2, overdue: { action: 'REMIND' } },
    { order: 2, approver: { kind: 'HR' }, condition: { field: 'monthTotal', op: 'gt', value: '5000' }, dueDays: 2, overdue: { action: 'REMIND' } },
  ],
  SALARY_ADVANCE: [{ order: 1, approver: { kind: 'HR' }, dueDays: 3, overdue: { action: 'REMIND' } }],
  SHIFT_SWAP: [
    { order: 1, approver: { kind: 'MANAGER' }, dueDays: 2, overdue: { action: 'REMIND' } },
    { order: 2, approver: { kind: 'COLLEAGUE_MANAGER' }, dueDays: 2, overdue: { action: 'REMIND' } },
  ],
  FORM_MANAGER_HR: [
    { order: 1, approver: { kind: 'MANAGER' }, dueDays: 4, overdue: { action: 'REMIND' } },
    { order: 2, approver: { kind: 'HR' }, dueDays: 4, overdue: { action: 'REMIND' } },
  ],
  JOB_CHANGE_GRADE: [
    { order: 1, approver: { kind: 'MANAGER' }, dueDays: 2, overdue: { action: 'HAND_ON', to: { kind: 'HR' } } },
    { order: 2, approver: { kind: 'USER', id: 'u-head' }, condition: { field: 'gradeId', op: 'changed' }, dueDays: 2 },
    { order: 3, approver: { kind: 'MANAGER_OF_MANAGER' }, condition: { field: 'departmentId', op: 'eq', value: 'd-design' }, dueDays: 1 },
    { order: 4, approver: { kind: 'ROLE', id: 'r-fin' }, condition: { field: 'departmentId', op: 'ne', value: 'd-design' }, dueDays: 1 },
  ],
  LEAVE_DAYS: [
    { order: 1, approver: { kind: 'MANAGER' }, dueDays: 2 },
    { order: 2, approver: { kind: 'MANAGER_OF_MANAGER' }, dueDays: 2, condition: { field: 'days', op: 'gt', value: '2' } },
    { order: 3, approver: { kind: 'HR' }, dueDays: 2, condition: { field: 'days', op: 'lt', value: '1' } },
    { order: 4, approver: { kind: 'USER', id: 'u-x' }, dueDays: 2, condition: { field: 'leaveTypeId', op: 'eq', value: 'lt-sick' } },
  ],
  CHAIN_MANAGER_THEN_HR: [{ order: 1, approver: { kind: 'MANAGER' }, dueDays: 2 }, { order: 2, approver: { kind: 'HR' }, dueDays: 2 }],
};

/* A small deterministic generator, so the property runs the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
const VALUES = [null, undefined, '', '0', '2', '3', '5000', '5001', 4999, 6000, 0.5, 'd-design', 'd-sales', 'g2', 'g3', 'lt-sick', 'lt-casual'];
function payloadOf(r: () => number) {
  const p: any = {};
  for (const f of ['monthTotal', 'amount', 'days', 'leaveTypeId', 'departmentId', 'gradeId']) if (r() < 0.6) p[f] = pick(r, VALUES);
  if (r() < 0.5) {
    p.fields = {};
    for (const f of ['gradeId', 'departmentId', 'phone']) if (r() < 0.5) p.fields[f] = { before: pick(r, VALUES), after: pick(r, VALUES) };
  }
  return p;
}
/* What the person it is about carries: a v1 condition must never read it. */
const personOf = (r: () => number) => ({ departmentId: pick(r, ['d-design', 'd-sales', null]), gradeId: pick(r, ['g2', 'g3']), branchId: 'b-1' });

describe('version 1 rules read through normaliseSteps', () => {
  it('each preset becomes version 2 with one approver, ANY, its condition read from the request, its due days', () => {
    const v2 = normaliseSteps(PRESETS.EXPENSE_CLAIM);
    expect(v2).toEqual([
      { order: 1, approvers: [{ kind: 'MANAGER' }], mode: 'ANY', when: [], due: { workingDays: 2 }, overdue: { action: 'REMIND' }, stepIn: null, ifRequester: 'SKIP' },
      { order: 2, approvers: [{ kind: 'HR' }], mode: 'ANY', when: [{ field: 'monthTotal', op: 'gt', value: '5000', from: 'request' }], due: { workingDays: 2 }, overdue: { action: 'REMIND' }, stepIn: null, ifRequester: 'SKIP' },
    ]);
    expect(normaliseSteps(PRESETS.LEAVING)[0].overdue).toEqual({ action: 'HAND_ON', to: { kind: 'HR' } });
  });

  it('a normalised preset reads back in the first shape unchanged, and says so', () => {
    for (const [name, steps] of Object.entries(PRESETS)) {
      const back = legacySteps(normaliseSteps(steps));
      expect(back, name).toEqual(steps.map((s) => ({ order: s.order, approver: s.approver, condition: s.condition ? { value: null, ...s.condition } : null, dueDays: s.dueDays, overdue: s.overdue ?? null })));
      expect(v1Exact(steps), name).toBe(true);
      expect(v1Exact(normaliseSteps(steps)), name).toBe(true);
    }
  });

  it('property: over 4,000 random requests, every preset condition decides exactly as the first engine did', () => {
    const r = rng(20261031);
    let checked = 0;
    for (let n = 0; n < 500; n += 1) {
      const payload = payloadOf(r);
      const person = personOf(r);
      for (const steps of Object.values(PRESETS)) {
        const v2 = normaliseSteps(steps);
        steps.forEach((s, i) => {
          expect(allHold(v2[i].when, { payload, person }), JSON.stringify({ s, payload })).toBe(conditionHolds(s.condition, payload));
          checked += 1;
        });
      }
    }
    expect(checked).toBeGreaterThan(4000);
  });

  it('a step saved through cleanRule in the first shape is the stored step normalised (saving again changes nothing)', () => {
    for (const [name, steps] of Object.entries(PRESETS)) {
      const type = name === 'SHIFT_SWAP' ? 'SHIFT_SWAP' : name.startsWith('LEAVE') ? 'LEAVE' : 'JOB_CHANGE';
      const clean = cleanRule({ requestType: type, name, steps });
      expect(isRuleProblem(clean), name).toBe(false);
      const ok = clean as Exclude<typeof clean, { error: string }>;
      expect(ok.steps.map((s) => ({ ...s, when: s.when.map((c) => ({ ...c, value: c.value == null ? null : String(c.value) })) })), name).toEqual(normaliseSteps(steps));
    }
  });
});

describe('conditions, version 2', () => {
  const facts = { payload: { amount: 5000, days: 3, kind: 'WFH' }, person: { departmentId: 'd-1', branchId: 'pune' } };
  it('compares numbers with gt, gte, lt, lte, and text with eq, ne, in', () => {
    expect(holds({ field: 'amount', op: 'gte', value: 5000 }, facts)).toBe(true);
    expect(holds({ field: 'amount', op: 'gt', value: 5000 }, facts)).toBe(false);
    expect(holds({ field: 'days', op: 'lte', value: 3 }, facts)).toBe(true);
    expect(holds({ field: 'days', op: 'lt', value: 3 }, facts)).toBe(false);
    expect(holds({ field: 'kind', op: 'in', value: ['ON_DUTY', 'WFH'] }, facts)).toBe(true);
    expect(holds({ field: 'kind', op: 'ne', value: 'WFH' }, facts)).toBe(false);
  });
  it('a field the request does not carry is read from the person it is about, unless the condition says the request only', () => {
    expect(holds({ field: 'branchId', op: 'eq', value: 'pune' }, facts)).toBe(true);
    expect(holds({ field: 'departmentId', op: 'in', value: ['d-1', 'd-2'] }, facts)).toBe(true);
    expect(holds({ field: 'branchId', op: 'eq', value: 'pune', from: 'request' }, facts)).toBe(false);
  });
  it('a record change reads the new value; changed needs a change', () => {
    const f = { payload: { fields: { gradeId: { before: 'g2', after: 'g3' } } }, person: { gradeId: 'g2' } };
    expect(holds({ field: 'gradeId', op: 'eq', value: 'g3' }, f)).toBe(true);
    expect(holds({ field: 'gradeId', op: 'changed' }, f)).toBe(true);
    expect(holds({ field: 'phone', op: 'changed' }, f)).toBe(false);
  });
});

describe('cleanRule refuses what the spec refuses, naming the step and field', () => {
  const step = (extra: Record<string, unknown> = {}) => ({ approvers: [{ kind: 'HR' }], mode: 'ANY', due: { workingDays: 2 }, ...extra });
  const refuse = (input: any) => {
    const r = cleanRule({ name: 'x', ...input });
    expect(isRuleProblem(r)).toBe(true);
    return r as { error: string; step?: number; field?: string };
  };
  it('version 2 steps with several approvers, ALL mode, hours, step-in and next-up are kept', () => {
    const r = cleanRule({ requestType: 'EXPENSE_CLAIM', name: 'Big claims', steps: [
      step({ approvers: [{ kind: 'DEPARTMENT_HEAD' }, { kind: 'PAYROLL' }], mode: 'ALL', due: { hours: 8 }, overdue: { action: 'AUTO_APPROVE', afterHours: 4 }, stepIn: 'OWNER', ifRequester: 'NEXT_UP', when: [{ field: 'amount', op: 'gte', value: 5000 }] }),
      step({ approvers: [{ kind: 'OWNER' }] }),
    ] });
    expect(isRuleProblem(r)).toBe(false);
    const ok = r as any;
    expect(ok.steps[0]).toMatchObject({ mode: 'ALL', due: { hours: 8 }, stepIn: 'OWNER', ifRequester: 'NEXT_UP', overdue: { action: 'AUTO_APPROVE', afterHours: 4 } });
    expect(toV1(ok.steps[0]).exact).toBe(false);
  });
  it('approving on its own when late: never on the last step, never money', () => {
    expect(refuse({ requestType: 'JOB_CHANGE', steps: [step({ overdue: { action: 'AUTO_APPROVE' } })] })).toMatchObject({ step: 1, field: 'overdue' });
    expect(refuse({ requestType: 'SALARY_ADVANCE', steps: [step({ overdue: { action: 'AUTO_APPROVE' } }), step()] })).toMatchObject({ step: 1, field: 'overdue' });
  });
  it('auto-approve rules: never for money, never for leave yet', () => {
    expect(refuse({ requestType: 'SALARY_ADVANCE', steps: [step()], autoApprove: [{ when: [{ field: 'amount', op: 'lt', value: 100 }] }] })).toMatchObject({ field: 'autoApprove' });
    expect(refuse({ requestType: 'LEAVE', steps: [step()], autoApprove: [{ when: [{ field: 'days', op: 'lte', value: 1 }] }] })).toMatchObject({ field: 'autoApprove' });
    expect(isRuleProblem(cleanRule({ requestType: 'DOCUMENT_REQUEST', name: 'x', steps: [step()], autoApprove: [{ when: [{ field: 'kind', op: 'eq', value: 'PAYSLIP' }] }] }))).toBe(false);
  });
  it('leave keeps to what its own step walker reads until it moves (phase 2c)', () => {
    expect(refuse({ requestType: 'LEAVE', steps: [step({ approvers: [{ kind: 'HR' }, { kind: 'MANAGER' }] })] })).toMatchObject({ step: 1 });
    expect(refuse({ requestType: 'LEAVE', steps: [step({ approvers: [{ kind: 'DEPARTMENT_HEAD' }] })] })).toMatchObject({ step: 1 });
    expect(refuse({ requestType: 'LEAVE', steps: [step({ due: { hours: 4 } })] })).toMatchObject({ step: 1 });
    expect(isRuleProblem(cleanRule({ requestType: 'LEAVE', name: 'x', steps: [step({ approvers: [{ kind: 'MANAGER' }], when: [{ field: 'days', op: 'gt', value: 2 }] })] }))).toBe(false);
  });
  it('a variant says when it applies; the main rule applies to everyone', () => {
    expect(refuse({ requestType: 'JOB_CHANGE', steps: [step()], variantKey: 'pune' })).toMatchObject({ field: 'appliesWhen' });
    expect(refuse({ requestType: 'JOB_CHANGE', steps: [step()], appliesWhen: [{ field: 'branchId', op: 'eq', value: 'b' }] })).toMatchObject({ field: 'appliesWhen' });
    expect(refuse({ requestType: 'JOB_CHANGE', steps: [step()], variantKey: 'Pune!', appliesWhen: [{ field: 'branchId', op: 'eq', value: 'b' }] })).toMatchObject({ field: 'variantKey' });
  });
  it('the shapes that were wrong before are still wrong', () => {
    expect(refuse({ requestType: 'JOB_CHANGE', steps: [{ approver: { kind: 'NOBODY' }, dueDays: 1 }] })).toMatchObject({ step: 1 });
    expect(refuse({ requestType: 'JOB_CHANGE', steps: [{ approver: { kind: 'USER' }, dueDays: 1 }] })).toMatchObject({ step: 1 });
    expect(refuse({ requestType: 'JOB_CHANGE', steps: [{ approver: { kind: 'HR' }, dueDays: 61 }] })).toMatchObject({ step: 1, field: 'dueDays' });
    expect(refuse({ requestType: 'JOB_CHANGE', steps: [step({ due: { hours: 2, workingDays: 1 } })] })).toMatchObject({ step: 1, field: 'due' });
    expect(refuse({ requestType: 'JOB_CHANGE', steps: [step({ approvers: [{ kind: 'COLLEAGUE_MANAGER' }] })] })).toMatchObject({ step: 1 });
    expect(refuse({ requestType: 'JOB_CHANGE', steps: Array.from({ length: 9 }, () => step()) })).toMatchObject({ field: 'steps' });
    expect(refuse({ requestType: 'JOB_CHANGE', steps: [step({ when: [{ field: 'amount', op: 'gt', value: 'lots' }] })] })).toMatchObject({ step: 1, field: 'when' });
  });
  it('normaliseStep of a version 2 step keeps it', () => {
    const s = { order: 1, approvers: [{ kind: 'OWNER' }], mode: 'ANY', when: [], due: { hours: 3 }, overdue: null, stepIn: null, ifRequester: 'SKIP' };
    expect(normaliseStep(s)).toEqual(s);
  });
});
