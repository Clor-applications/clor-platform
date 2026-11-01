import type { Prisma } from '../../../generated/people/index.js';
import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { SPEC_VERSION, type StepV2 } from './spec.js';
import type { RuleRow } from './engine.js';

/**
 * Today's chains as preset rules (docs/people/workflow-engine/SPEC.md 5.4), so the engine decides who
 * approves leave exactly as the chain does (phase 2c-i; attendance requests follow in 2d).
 *
 * A preset is a rule row of its request type with the variant key `preset:<KEY>` and no conditions:
 * pickRule never picks it (a variant needs conditions), the main rule (variant "") stays whatever the
 * company wrote, and an older API, which reads only the main rule, never sees it. The module picks the
 * preset itself from the setting it already stores (AttendanceSettings.leaveApproval, LeaveType.approval),
 * so that setting stays the one source of truth and a rollback reads the same choice. A variant key with
 * a colon cannot be written, retired or matched through the rules API (its keys are letters, digits and
 * dashes), so nobody edits a preset into something else.
 *
 * Leave's own words for the approver kinds (services/attendance/leaveEngine.ts):
 *  - HR: whoever approves leave for this person: a company-wide leave approver, or a team-scoped one
 *    whose team holds them. After the manager (MANAGER_THEN_HR) only company-wide ones, and never the
 *    person who took the manager's step.
 *  - MANAGER: the person's manager, or their stand-in that day, in CLOR or in the employee app.
 */

export const PRESET_PREFIX = 'preset:';
export type LeaveChainKey = 'HR' | 'MANAGER' | 'MANAGER_THEN_HR';
export type PresetKey = 'HR_OR_MANAGER' | 'MANAGER' | 'MANAGER_THEN_HR';

/** A stored chain's preset: the old "HR" is "HR or the manager, whoever is first" (SPEC 3.2). */
export const PRESET_OF_CHAIN: Record<LeaveChainKey, PresetKey> = { HR: 'HR_OR_MANAGER', MANAGER: 'MANAGER', MANAGER_THEN_HR: 'MANAGER_THEN_HR' };

/* Due in two working days with a reminder only: it never changes who decides (SPEC 5.4). Leave's own digest and hand-on still run. */
const step = (order: number, approvers: StepV2['approvers'], extra: Partial<StepV2> = {}): StepV2 => ({
  order, approvers, mode: 'ANY', when: [], due: { workingDays: 2 }, overdue: { action: 'REMIND' }, stepIn: null, ifRequester: 'SKIP', ...extra,
});

export const LEAVE_PRESETS: Record<PresetKey, { name: string; steps: StepV2[] }> = {
  HR_OR_MANAGER: { name: 'Standard: HR or the manager, whoever is first', steps: [step(1, [{ kind: 'HR' }, { kind: 'MANAGER' }])] },
  MANAGER: { name: 'Standard: the manager; HR can step in', steps: [step(1, [{ kind: 'MANAGER' }], { stepIn: 'HR' })] },
  MANAGER_THEN_HR: { name: 'Standard: the manager, then HR', steps: [step(1, [{ kind: 'MANAGER' }]), step(2, [{ kind: 'HR' }])] },
};

/* Stored JSON comes back with its keys in the database's order: compared key-sorted. */
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/**
 * Make (or bring back) every preset of a request type for this company, once: idempotent, and safe
 * when two requests seed at the same moment (one advisory lock per company and type, and the check
 * under it). A preset found with other steps (an older preset) gets a new version; requests already
 * waiting keep the version they opened with. Runs inside the caller's transaction when there is one.
 */
export async function seedPresets(who: { accountId: string; orgId: string }, requestType: 'LEAVE' = 'LEAVE'): Promise<Record<PresetKey, RuleRow>> {
  return peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval-presets:${who.orgId}:${requestType}`}))`;
    const out = {} as Record<PresetKey, RuleRow>;
    for (const [key, preset] of Object.entries(LEAVE_PRESETS) as Array<[PresetKey, (typeof LEAVE_PRESETS)[PresetKey]]>) {
      const variantKey = `${PRESET_PREFIX}${key}`;
      const active = await tx.approvalRule.findFirst({ where: { orgId: who.orgId, requestType, variantKey, active: true }, orderBy: { version: 'desc' } });
      if (active && active.presetKey === key && same(active.steps, preset.steps)) {
        out[key] = active;
        continue;
      }
      const latest = await tx.approvalRule.findFirst({ where: { orgId: who.orgId, requestType, variantKey }, orderBy: { version: 'desc' }, select: { version: true } });
      await tx.approvalRule.updateMany({ where: { orgId: who.orgId, requestType, variantKey, active: true }, data: { active: false } });
      out[key] = await tx.approvalRule.create({
        data: {
          accountId: who.accountId, orgId: who.orgId, requestType, name: preset.name, version: (latest?.version || 0) + 1, active: true,
          steps: preset.steps as unknown as Prisma.InputJsonValue, specVersion: SPEC_VERSION, variantKey, priority: 0, presetKey: key, createdByUserId: null,
        },
      });
    }
    return out;
  });
}

/** The preset rule for a stored chain, made when it is first needed. */
export async function presetRule(who: { accountId: string; orgId: string }, chain: LeaveChainKey): Promise<RuleRow> {
  const key = PRESET_OF_CHAIN[chain];
  const active = await peoplePrisma.approvalRule.findFirst({ where: { orgId: who.orgId, requestType: 'LEAVE', variantKey: `${PRESET_PREFIX}${key}`, active: true }, orderBy: { version: 'desc' } });
  if (active && active.presetKey === key && same(active.steps, LEAVE_PRESETS[key].steps)) return active;
  return (await seedPresets(who))[key];
}
