/**
 * The approval rule spec, version 2 (docs/people/workflow-engine/SPEC.md 5.2),
 * and the read-through from version 1.
 *
 * Version 1 is the step shape every rule had until now: one approver, one
 * condition, a due time in working days, remind or hand on when late.
 * Version 2 adds several approvers in one step (any one of them, or all of
 * them), several conditions, a due time in hours, auto-approve when late,
 * who may step in, and what happens when the only person who could decide is
 * the requester. A rule saved before this reads through `normaliseSteps` with
 * identical behaviour; it is written as version 2 on its next save.
 *
 * Pure: no database here, so the shapes can be tested on their own.
 */

/* ---- Version 1 (today's JSON) --------------------------------------------- */

/**
 * COLLEAGUE_MANAGER: the manager of the other person a request names (a shift
 * swap's colleague, `payload.colleagueEmployeeId`). Skipped when that is the
 * same manager as the requester's, who has already decided.
 */
export type ApproverSpec = { kind: 'MANAGER' | 'MANAGER_OF_MANAGER' | 'USER' | 'ROLE' | 'HR' | 'COLLEAGUE_MANAGER'; id?: string };
/** gt / lt compare numbers (a leave's days); the others compare text. */
export type Condition = { field: string; op: 'changed' | 'eq' | 'ne' | 'gt' | 'lt'; value?: string | null };
export type StepSpec = { order: number; approver: ApproverSpec; condition?: Condition | null; dueDays: number; overdue?: { action: 'REMIND' | 'HAND_ON'; to?: ApproverSpec } | null };

/* ---- Version 2 ------------------------------------------------------------ */

export const APPROVER_KINDS = ['MANAGER', 'MANAGER_OF_MANAGER', 'DEPARTMENT_HEAD', 'HR', 'PAYROLL', 'OWNER', 'COLLEAGUE_MANAGER', 'ROLE', 'USER'] as const;
export type ApproverKind = (typeof APPROVER_KINDS)[number];
export type Approver = { kind: ApproverKind; id?: string };

export const CONDITION_OPS = ['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'changed'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
/**
 * `from: 'request'`: read the value from the request only (a v1 condition: a
 * job change's new department, a leave's days). Without it, a field the
 * request does not carry is read from the person it is about (their
 * department, branch, work site, employment type, grade), which is what a
 * variant ("branch is Pune") means.
 */
export type ConditionV2 = { field: string; op: ConditionOp; value?: string | number | string[] | null; from?: 'request' };

export type Due = { hours?: number; workingDays?: number };
export type Overdue = { action: 'REMIND' | 'HAND_ON' | 'AUTO_APPROVE'; afterHours?: number; to?: Approver };

export type StepV2 = {
  order: number;
  approvers: Approver[];
  /** ANY: the first decision counts. ALL: each approver must approve; one rejection rejects. */
  mode: 'ANY' | 'ALL';
  /** All must hold, else the step is skipped. */
  when: ConditionV2[];
  due: Due;
  overdue: Overdue | null;
  /** Who may take this step in the approver's place (logged). */
  stepIn: 'HR' | 'OWNER' | null;
  /** When only the requester (or the person it is about) could decide: SKIP as today, or NEXT_UP their own manager, HR, the owner. */
  ifRequester: 'SKIP' | 'NEXT_UP';
};

export type AutoApprove = { when: ConditionV2[] };

export type RuleSpecV2 = {
  requestType: string;
  name: string;
  variantKey: string;
  appliesWhen: ConditionV2[];
  priority: number;
  autoApprove: AutoApprove[];
  steps: StepV2[];
};

export const SPEC_VERSION = 2;

/**
 * Money that leaves the company: never approved by the clock or by a rule on
 * its own (SPEC 5.2). LOAN, SALARY_REVISION and FINAL_SETTLEMENT are Payroll's
 * (phase 3a); SALARY_ADVANCE is People's.
 */
export const MONEY_TYPES = new Set(['LOAN', 'SALARY_REVISION', 'FINAL_SETTLEMENT', 'SALARY_ADVANCE']);
/** Money: always two different people when a step needs several (review of PR #93): advances, claims, and Payroll's types later. */
export const TWO_PERSON_TYPES = new Set([...MONEY_TYPES, 'EMPLOYEE_ADVANCE', 'EXPENSE_CLAIM']);
/** Something about yourself that is never self-approved, whatever the maker-checker setting (SPEC 5.6). Payroll's, phase 3a. */
export const NEVER_SELF_TYPES = new Set(['LOAN', 'SALARY_REVISION', 'FINAL_SETTLEMENT']);

const V1_KINDS = new Set(['MANAGER', 'MANAGER_OF_MANAGER', 'USER', 'ROLE', 'HR', 'COLLEAGUE_MANAGER']);
const V1_OPS = new Set(['changed', 'eq', 'ne', 'gt', 'lt']);
const NUMERIC_OPS = new Set(['gt', 'gte', 'lt', 'lte']);
const DEFAULT_DUE_DAYS = 2;

const isV2Step = (s: unknown) => Boolean(s && typeof s === 'object' && Array.isArray((s as { approvers?: unknown }).approvers));

const approverOf = (a: any): Approver => ({ kind: String(a?.kind || '') as ApproverKind, ...(a?.id ? { id: String(a.id) } : {}) });

/** One stored step, of either version, as version 2. */
export function normaliseStep(raw: unknown, index = 0): StepV2 {
  const s = (raw || {}) as any;
  if (isV2Step(s)) {
    const workingDays = Number(s.due?.workingDays);
    const hours = Number(s.due?.hours);
    return {
      order: Number(s.order) || index + 1,
      approvers: (s.approvers as unknown[]).map(approverOf),
      mode: s.mode === 'ALL' ? 'ALL' : 'ANY',
      when: Array.isArray(s.when) ? s.when.map((c: any) => ({ field: String(c.field), op: c.op, value: c.value ?? null, ...(c.from === 'request' ? { from: 'request' as const } : {}) })) : [],
      due: Number.isFinite(hours) && hours > 0 ? { hours } : { workingDays: Number.isFinite(workingDays) && workingDays > 0 ? workingDays : DEFAULT_DUE_DAYS },
      overdue: s.overdue?.action ? { action: s.overdue.action, ...(s.overdue.afterHours ? { afterHours: Number(s.overdue.afterHours) } : {}), ...(s.overdue.to?.kind ? { to: approverOf(s.overdue.to) } : {}) } : null,
      stepIn: s.stepIn === 'HR' || s.stepIn === 'OWNER' ? s.stepIn : null,
      ifRequester: s.ifRequester === 'NEXT_UP' ? 'NEXT_UP' : 'SKIP',
    };
  }
  /* Version 1: `approver` becomes `approvers: [approver]` with ANY, `condition` becomes `when: [condition]` read from the request only, `dueDays` becomes working days. */
  const dueDays = Number(s.dueDays);
  return {
    order: Number(s.order) || index + 1,
    approvers: [approverOf(s.approver)],
    mode: 'ANY',
    when: s.condition ? [{ field: String(s.condition.field), op: s.condition.op, value: s.condition.value ?? null, from: 'request' }] : [],
    /* A v1 step always had dueDays; the engine used it as given (reply used 2 when it was missing). */
    due: { workingDays: Number.isFinite(dueDays) ? dueDays : DEFAULT_DUE_DAYS },
    overdue: s.overdue?.action ? { action: s.overdue.action, ...(s.overdue.to?.kind ? { to: approverOf(s.overdue.to) } : {}) } : null,
    stepIn: null,
    ifRequester: 'SKIP',
  };
}

/** A rule's stored steps, of either version (or a mix), as version 2. */
export function normaliseSteps(raw: unknown): StepV2[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s, i) => normaliseStep(s, i));
}

/** Conditions stored on a rule (appliesWhen, autoApprove[].when). */
export function normaliseConditions(raw: unknown): ConditionV2[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => c && typeof c === 'object' && (c as any).field).map((c: any) => ({ field: String(c.field), op: c.op, value: c.value ?? null, ...(c.from === 'request' ? { from: 'request' as const } : {}) }));
}
export function normaliseAutoApprove(raw: unknown): AutoApprove[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a: any) => ({ when: normaliseConditions(a?.when) })).filter((a) => a.when.length);
}

/**
 * A version 2 step as the version 1 shape, for the code that still reads the
 * first shape (leave's own step walker, the request types HR makes, the
 * profile-change due days). `exact` is false when the step uses something
 * version 1 cannot say; the returned step then keeps the first approver and
 * condition only.
 */
export function toV1(step: StepV2): { step: StepSpec; exact: boolean } {
  const first = step.when[0];
  const kind = step.approvers[0]?.kind;
  const exact =
    step.approvers.length === 1 && V1_KINDS.has(kind) && step.mode === 'ANY' && step.when.length <= 1 && (!first || (V1_OPS.has(first.op) && !Array.isArray(first.value))) &&
    step.due.workingDays !== undefined && step.due.hours === undefined && (!step.overdue || ((step.overdue.action === 'REMIND' || step.overdue.action === 'HAND_ON') && !step.overdue.afterHours && (!step.overdue.to || V1_KINDS.has(step.overdue.to.kind)))) &&
    step.stepIn === null && step.ifRequester === 'SKIP';
  const dueDays = step.due.workingDays ?? Math.max(1, Math.ceil((step.due.hours || 24) / 24));
  return {
    exact,
    step: {
      order: step.order,
      approver: { kind: kind as ApproverSpec['kind'], ...(step.approvers[0]?.id ? { id: step.approvers[0].id } : {}) },
      condition: first ? { field: first.field, op: first.op as Condition['op'], value: first.value == null ? null : String(first.value) } : null,
      dueDays,
      overdue: step.overdue && step.overdue.action !== 'AUTO_APPROVE' ? { action: step.overdue.action, ...(step.overdue.to ? { to: { kind: step.overdue.to.kind as ApproverSpec['kind'], ...(step.overdue.to.id ? { id: step.overdue.to.id } : {}) } } : {}) } : step.overdue ? { action: 'REMIND' } : null,
    },
  };
}

/** Stored steps of either version, in the version 1 shape. */
export function legacySteps(raw: unknown): StepSpec[] {
  return normaliseSteps(raw).map((s) => toV1(s).step);
}
/** True when every stored step reads exactly in the version 1 shape (the current rules screen can edit it). */
export function v1Exact(raw: unknown): boolean {
  return normaliseSteps(raw).every((s) => toV1(s).exact);
}

/* ---- Conditions ------------------------------------------------------------ */

/** Read from the person's record (5.2 fields offered per type), whatever the request carries. */
export const PERSON_FIELDS = new Set(['departmentId', 'branchId', 'establishmentId', 'employeeTypeId', 'gradeId']);

/**
 * What a request of this type carries that the server, not the asker, sets (5.2): a money request's
 * amount and month total, leave's days and type; a record change (job, profile) or a request type HR made
 * carries its own fields. Anything else has nothing a condition may read from the request.
 */
export function requestFieldsOf(requestType: string): Set<string> | 'ANY' {
  if (requestType === 'JOB_CHANGE' || requestType === 'PROFILE_CHANGE' || requestType.startsWith('FORM:')) return 'ANY';
  if (TWO_PERSON_TYPES.has(requestType)) return new Set(['amount', 'monthTotal']);
  if (requestType === 'LEAVE') return new Set(['days', 'leaveTypeId']);
  return new Set();
}

export type Facts = {
  /** The request's own values: `fields` for a record change ({ before, after }), and top-level values (amount, days, ...). */
  payload: { fields?: Record<string, { before: unknown; after: unknown }>; [k: string]: unknown };
  /** The person it is about: departmentId, branchId, establishmentId, employeeTypeId, gradeId. */
  person?: Record<string, unknown> | null;
};

/**
 * Does one condition hold? For a v1 condition (read from the request) this is
 * exactly the first engine's `conditionHolds`: a record change reads the new
 * value, otherwise the request's own value; gt and lt compare numbers, the
 * rest compare text.
 */
export function holds(c: ConditionV2, facts: Facts): boolean {
  const payload = facts.payload || {};
  const f = payload.fields?.[c.field];
  if (c.op === 'changed') return Boolean(f) && String(f!.before ?? '') !== String(f!.after ?? '');
  /*
   * The person's own department, branch, grade, work site and type come from their record, never from the
   * request: whoever asks writes the payload, and could otherwise pick a variant or an auto-approval
   * (review of PR #93). Only a condition that says `from: 'request'` (a job change's new department; every
   * version 1 condition) reads the request.
   */
  const raw: unknown = c.from !== 'request' && PERSON_FIELDS.has(c.field) ? facts.person?.[c.field] ?? null : f ? f.after : (payload as any)[c.field];
  if (NUMERIC_OPS.has(c.op)) {
    const n = Number(raw);
    const v = Number(c.value);
    if (!Number.isFinite(n) || !Number.isFinite(v)) return false;
    return c.op === 'gt' ? n > v : c.op === 'gte' ? n >= v : c.op === 'lt' ? n < v : n <= v;
  }
  const text = String(raw ?? '');
  if (c.op === 'in') return (Array.isArray(c.value) ? c.value : [c.value]).map((v) => String(v ?? '')).includes(text);
  return c.op === 'eq' ? text === String(c.value ?? '') : text !== String(c.value ?? '');
}

export const allHold = (cs: ConditionV2[] | null | undefined, facts: Facts) => (cs || []).every((c) => holds(c, facts));

/** When a step opening now is due. */
export function dueAtFrom(now: Date, due: Due, addWorkingDays: (from: Date, days: number) => Date) {
  if (due.hours && due.hours > 0) return new Date(now.getTime() + due.hours * 3_600_000);
  return addWorkingDays(now, due.workingDays ?? DEFAULT_DUE_DAYS);
}

/* ---- Validation (cleanRule) ------------------------------------------------ */

export type RuleProblem = { error: string; step?: number; field?: string };

const problem = (error: string, step?: number, field?: string): RuleProblem => ({ error, ...(step ? { step } : {}), ...(field ? { field } : {}) });

const MAX_STEPS = 8;
const MAX_APPROVERS = 5;
const MAX_CONDITIONS = 6;

function cleanApprover(raw: any, requestType: string, at: number, field: string, leave: boolean): Approver | RuleProblem {
  const kind = String(raw?.kind || '');
  if (!(APPROVER_KINDS as readonly string[]).includes(kind)) return problem(`Step ${at}: who decides must be the manager, their manager, the department head, HR, Payroll, the owner, a named person, or a role.`, at, field);
  if (kind === 'COLLEAGUE_MANAGER' && requestType !== 'SHIFT_SWAP') return problem(`Step ${at}: the colleague's manager decides shift swaps only.`, at, field);
  /* Leave walks its own steps until it moves onto the engine (phase 2c): the kinds it knows. */
  if (leave && !['MANAGER', 'MANAGER_OF_MANAGER', 'USER', 'ROLE', 'HR'].includes(kind)) return problem(`Step ${at}: leave steps are decided by the manager, their manager, HR, a named person or a role for now.`, at, field);
  if ((kind === 'USER' || kind === 'ROLE') && !String(raw?.id || '').trim()) return problem(`Step ${at}: name the person or role.`, at, field);
  return { kind: kind as ApproverKind, ...(kind === 'USER' || kind === 'ROLE' ? { id: String(raw.id).trim() } : {}) };
}

function cleanCondition(raw: any, at: number | undefined, field: string, ops: readonly string[], requestType: string, legacy = false): ConditionV2 | RuleProblem {
  const op = String(raw?.op || '');
  const name = String(raw?.field || '').trim();
  const where = at ? `Step ${at}: ` : '';
  if (!ops.includes(op) || !name || name.length > 60) return problem(`${where}a condition names a field and one of ${ops.join(', ')}.`, at, field);
  /* A version 2 condition reads the person's record, or only what this type of request carries (review of PR #93). Version 1 steps keep what they could always say. */
  const fromRequest = raw.from === 'request' || op === 'changed' || !PERSON_FIELDS.has(name);
  const allowed = requestFieldsOf(requestType);
  if (!legacy && fromRequest && allowed !== 'ANY' && !allowed.has(name)) {
    return problem(`${where}this kind of request does not carry "${name}". Conditions read the person's department, branch, grade, work site or employment type${allowed.size ? `, or ${[...allowed].join(', ')}` : ''}.`, at, field);
  }
  if (NUMERIC_OPS.has(op) && !Number.isFinite(Number(raw.value))) return problem(`${where}more or fewer than how many?`, at, field);
  if (op === 'in') {
    const list = Array.isArray(raw.value) ? raw.value.map((v: unknown) => String(v ?? '').trim()).filter(Boolean) : [];
    if (!list.length || list.length > 50) return problem(`${where}"is one of" needs one to fifty values.`, at, field);
    return { field: name, op: 'in', value: list, ...(raw.from === 'request' ? { from: 'request' as const } : {}) };
  }
  const value = raw.value == null || raw.value === '' ? null : NUMERIC_OPS.has(op) ? Number(raw.value) : String(raw.value).slice(0, 200);
  return { field: name, op: op as ConditionOp, value, ...(raw.from === 'request' ? { from: 'request' as const } : {}) };
}

const isProblem = (x: unknown): x is RuleProblem => Boolean(x && typeof x === 'object' && 'error' in (x as object));

/**
 * One step from a client, either shape, checked and written as version 2.
 * A version 1 step (the current rules screen) normalises exactly as a stored
 * one does, so saving it again changes nothing about who decides.
 */
function cleanStep(raw: any, i: number, requestType: string, isLast: boolean): StepV2 | RuleProblem {
  const at = i + 1;
  const leave = requestType === 'LEAVE';
  const v2 = isV2Step(raw);
  const approversRaw: unknown[] = v2 ? raw.approvers : [raw?.approver];
  if (!approversRaw.length) return problem(`Step ${at}: say who decides.`, at, 'approvers');
  if (approversRaw.length > MAX_APPROVERS) return problem(`Step ${at}: five people or groups at most in one step.`, at, 'approvers');
  const approvers: Approver[] = [];
  for (const a of approversRaw) {
    const c = cleanApprover(a, requestType, at, v2 ? 'approvers' : 'approver', leave);
    if (isProblem(c)) return c;
    approvers.push(c);
  }
  const mode = v2 && raw.mode === 'ALL' ? 'ALL' : 'ANY';
  if (v2 && raw.mode && raw.mode !== 'ALL' && raw.mode !== 'ANY') return problem(`Step ${at}: any one of them, or all of them.`, at, 'mode');

  const whenRaw: unknown[] = v2 ? (Array.isArray(raw.when) ? raw.when : []) : raw?.condition ? [raw.condition] : [];
  if (whenRaw.length > MAX_CONDITIONS) return problem(`Step ${at}: six conditions at most.`, at, 'when');
  const when: ConditionV2[] = [];
  for (const c of whenRaw) {
    /* A v1 condition takes the v1 operators and is read from the request, as before. */
    const x = cleanCondition(c, at, v2 ? 'when' : 'condition', v2 ? CONDITION_OPS : ['changed', 'eq', 'ne', 'gt', 'lt'], requestType, !v2);
    if (isProblem(x)) return x;
    when.push(v2 ? x : { ...x, value: x.value == null ? null : String(x.value), from: 'request' });
  }

  let due: Due;
  if (v2) {
    const hours = raw.due?.hours;
    const days = raw.due?.workingDays;
    if (hours != null && days != null) return problem(`Step ${at}: a due time in hours or in working days, not both.`, at, 'due');
    if (hours != null) {
      const h = Number(hours);
      if (!Number.isInteger(h) || h < 1 || h > 1440) return problem(`Step ${at}: due in 1 hour to 60 days.`, at, 'due');
      due = { hours: h };
    } else {
      const d = Number(days);
      if (!Number.isInteger(d) || d < 1 || d > 60) return problem(`Step ${at}: due in 1 to 60 working days.`, at, 'due');
      due = { workingDays: d };
    }
  } else {
    const d = Number(raw?.dueDays);
    if (!Number.isFinite(d) || d < 1 || d > 60) return problem(`Step ${at}: due in 1 to 60 working days.`, at, 'dueDays');
    due = { workingDays: d };
  }

  let overdue: Overdue | null = null;
  if (raw?.overdue) {
    const action = String(raw.overdue.action || '');
    const allowed = v2 ? ['REMIND', 'HAND_ON', 'AUTO_APPROVE'] : ['REMIND', 'HAND_ON'];
    if (!allowed.includes(action)) return problem(v2 ? `Step ${at}: when overdue, remind, hand on, or approve on its own.` : `Step ${at}: when overdue, remind or hand on.`, at, 'overdue');
    overdue = { action: action as Overdue['action'] };
    if (raw.overdue.afterHours != null) {
      const h = Number(raw.overdue.afterHours);
      if (!Number.isInteger(h) || h < 1 || h > 720) return problem(`Step ${at}: act 1 to 720 hours after the reminder.`, at, 'overdue');
      overdue.afterHours = h;
    }
    if (raw.overdue.to) {
      const to = cleanApprover(raw.overdue.to, requestType, at, 'overdue', leave);
      if (isProblem(to)) return to;
      overdue.to = to;
    }
    if (action === 'HAND_ON' && !overdue.to) return problem(`Step ${at}: say who it is handed on to.`, at, 'overdue');
    if (action === 'AUTO_APPROVE') {
      if (MONEY_TYPES.has(requestType)) return problem(`Step ${at}: money is never approved on its own when late.`, at, 'overdue');
      if (isLast) return problem(`Step ${at}: the last step is never approved on its own; a person decides it.`, at, 'overdue');
      if (leave) return problem(`Step ${at}: leave is not approved on its own when late.`, at, 'overdue');
    }
  }

  const stepIn = v2 && (raw.stepIn === 'HR' || raw.stepIn === 'OWNER') ? raw.stepIn : null;
  if (v2 && raw.stepIn != null && !stepIn) return problem(`Step ${at}: HR or the owner may step in, or nobody.`, at, 'stepIn');
  const ifRequester = v2 && raw.ifRequester === 'NEXT_UP' ? 'NEXT_UP' : 'SKIP';
  if (v2 && raw.ifRequester != null && raw.ifRequester !== 'SKIP' && raw.ifRequester !== 'NEXT_UP') return problem(`Step ${at}: when it would be their own, skip it or send it up.`, at, 'ifRequester');

  const step: StepV2 = { order: at, approvers, mode, when, due, overdue, stepIn, ifRequester };
  /* Leave still walks its own steps in the first shape (phase 2c moves it): nothing it would read differently. */
  if (leave && !toV1(step).exact) return problem(`Step ${at}: leave steps take one approver, one condition and a due time in working days until leave moves onto the new steps.`, at, 'approvers');
  return step;
}

/**
 * A rule from a client, checked: steps (either shape), the variant it is,
 * and when it approves on its own. Answers the rule as version 2, or the
 * first problem with the step and field named (RULE_INVALID).
 */
export function cleanRule(input: { requestType: string; name: string; steps: unknown; variantKey?: unknown; appliesWhen?: unknown; priority?: unknown; autoApprove?: unknown }): RuleSpecV2 | RuleProblem {
  const { requestType } = input;
  const raw = input.steps;
  if (!Array.isArray(raw) || !raw.length) return problem('A rule needs at least one step.', undefined, 'steps');
  if (raw.length > MAX_STEPS) return problem('Eight steps at most.', undefined, 'steps');
  const steps: StepV2[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const s = cleanStep(raw[i], i, requestType, i === raw.length - 1);
    if (isProblem(s)) return s;
    steps.push(s);
  }
  const variantKey = input.variantKey == null ? '' : String(input.variantKey).trim();
  if (variantKey && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(variantKey)) return problem('A variant key is lower-case letters, digits and dashes.', undefined, 'variantKey');
  const leave = requestType === 'LEAVE';
  const appliesWhen: ConditionV2[] = [];
  if (input.appliesWhen != null) {
    if (!Array.isArray(input.appliesWhen) || input.appliesWhen.length > MAX_CONDITIONS) return problem('Six conditions at most pick a variant.', undefined, 'appliesWhen');
    for (const c of input.appliesWhen) {
      const x = cleanCondition(c, undefined, 'appliesWhen', CONDITION_OPS, requestType);
      if (isProblem(x)) return x;
      appliesWhen.push(x);
    }
  }
  if (variantKey && !appliesWhen.length) return problem('Say when this variant applies (a branch, a department).', undefined, 'appliesWhen');
  if (!variantKey && appliesWhen.length) return problem('The main rule applies to everyone; save a variant for a branch or department.', undefined, 'appliesWhen');
  if (leave && variantKey) return problem('Leave has one rule until it moves onto the new steps.', undefined, 'variantKey');
  const priority = input.priority == null ? 0 : Number(input.priority);
  if (!Number.isInteger(priority) || priority < -100 || priority > 100) return problem('Priority is a whole number from -100 to 100.', undefined, 'priority');
  const autoApprove: AutoApprove[] = [];
  if (input.autoApprove != null) {
    if (!Array.isArray(input.autoApprove) || input.autoApprove.length > 5) return problem('Five auto-approve rules at most.', undefined, 'autoApprove');
    if (input.autoApprove.length && MONEY_TYPES.has(requestType)) return problem('Money is never approved on its own.', undefined, 'autoApprove');
    if (input.autoApprove.length && leave) return problem('Leave approves on its own from Leave policy until it moves onto the new steps.', undefined, 'autoApprove');
    for (const a of input.autoApprove as any[]) {
      const when: ConditionV2[] = [];
      if (!Array.isArray(a?.when) || !a.when.length || a.when.length > MAX_CONDITIONS) return problem('An auto-approve rule names one to six conditions.', undefined, 'autoApprove');
      for (const c of a.when) {
        const x = cleanCondition(c, undefined, 'autoApprove', CONDITION_OPS, requestType);
        if (isProblem(x)) return x;
        when.push(x);
      }
      autoApprove.push({ when });
    }
  }
  return { requestType, name: input.name, variantKey, appliesWhen, priority, autoApprove, steps };
}

export const isRuleProblem = isProblem;

/**
 * The old `cleanSteps` contract (an array, or the first problem as text), for
 * code that still calls it: version 2 steps, checked.
 */
export function cleanStepsV2(raw: unknown, requestType: string): StepV2[] | string {
  const r = cleanRule({ requestType, name: 'x', steps: raw });
  return isProblem(r) ? r.error : r.steps;
}
