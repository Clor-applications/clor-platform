import type { Prisma } from '../../generated/people/index.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';

/**
 * The change log (docs/people/02-PRD.md FND-04; platform review R-10).
 *
 * Every write to a person leaves one line per changed field: who, when,
 * before, after, why, where it came from, and the request it belonged to.
 * It is written inside the same transaction as the change, so a change
 * without its log, or a log without its change, cannot exist. The table is
 * append-only at the database (migration 20261024140000). "Why?" reads it.
 *
 * Sensitive fields are logged as changed, never with their values.
 */

export type ChangeSource = 'FORM' | 'IMPORT' | 'APPROVAL' | 'API' | 'SYSTEM' | 'SELF_SERVICE' | 'SCHEDULED' | 'HIRE' | 'BULK';

export type Actor = {
  accountId: string;
  orgId: string;
  userId: string | null;
  source: ChangeSource;
  /** One id for everything one request or job did; the request id where there is one. */
  correlationId: string;
  reason?: string | null;
  requestId?: string | null;
  decisionId?: string | null;
};

/** Columns of Employee that are somebody's own data or their job: a change to any is logged. */
export const LOGGED_EMPLOYEE_FIELDS = [
  'code', 'name', 'firstName', 'lastName', 'preferredName', 'email', 'phone', 'designation', 'department',
  'dateOfJoining', 'dateOfLeaving', 'firstJoiningDate', 'currentEpisodeSeq', 'confirmedOn', 'status', 'userId', 'notes', 'branchId',
  'gender', 'dateOfBirth', 'maritalStatus', 'personalEmail', 'photoUrl', 'addressLine', 'city', 'state', 'country', 'pincode',
  'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation',
  'departmentId', 'businessUnitId', 'gradeId', 'costCenterId', 'jobPositionId', 'jobRoleId', 'employeeTypeId', 'workTypeId', 'hours',
  'reportingManagerId', 'dottedManagerId', 'workEmail', 'workPhone', 'workLocation', 'devicePin', 'areaId', 'contractorId', 'cardNumber',
  'devicePassword', 'devicePrivilege', 'attendanceRequired', 'guardianName', 'leavingType', 'leavingReason', 'portalEnabled',
  'mobilePunch', 'geofenceId', 'probationEndDate', 'contractEndDate', 'phonePunchMode', 'selfieRequired', 'establishmentId', 'teamId', 'seatId',
] as const;

/** Logged as changed, without the value. */
export const REDACTED_FIELDS = new Set(['devicePassword', 'portalPasswordHash', 'portalSetupHash', 'photoUrl', 'cardNumber']);

type Tx = Prisma.TransactionClient | typeof peoplePrisma;

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export type Change = { field: string; before: string | null; after: string | null; redacted: boolean };

/** What differs between two versions, over the logged fields only. */
export function diffEmployee(before: Record<string, unknown>, after: Record<string, unknown>, fields: readonly string[] = LOGGED_EMPLOYEE_FIELDS): Change[] {
  const out: Change[] = [];
  for (const field of fields) {
    const was = asText(before[field]);
    const now = asText(after[field]);
    if (was === now) continue;
    const redacted = REDACTED_FIELDS.has(field);
    out.push({ field, before: redacted ? null : was, after: redacted ? null : now, redacted });
  }
  return out;
}

/** One line per change, inside the caller's transaction. */
export async function writeChangeLog(tx: Tx, actor: Actor, entity: { kind: string; id: string; employeeId?: string | null }, changes: Change[]) {
  if (!changes.length) return 0;
  const r = await tx.changeLog.createMany({
    data: changes.map((c) => ({
      accountId: actor.accountId,
      orgId: actor.orgId,
      entity: entity.kind,
      entityId: entity.id,
      employeeId: entity.employeeId ?? null,
      field: c.field,
      before: c.before,
      after: c.after,
      redacted: c.redacted,
      reason: actor.reason ? String(actor.reason).slice(0, 500) : null,
      source: actor.source,
      actorUserId: actor.userId,
      correlationId: actor.correlationId,
      requestId: actor.requestId ?? null,
      decisionId: actor.decisionId ?? null,
    })),
  });
  return r.count;
}

/** The log for one person, newest first. */
export async function changeLogOf(orgId: string, employeeId: string, limit = 200) {
  return peoplePrisma.changeLog.findMany({ where: { orgId, employeeId }, orderBy: { at: 'desc' }, take: limit });
}
