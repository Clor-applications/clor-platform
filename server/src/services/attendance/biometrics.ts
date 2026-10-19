import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { decryptSecret, encryptSecret } from '../mailer.js';

/**
 * Fingerprints and faces under the DPDP Act, strictly.
 *
 * Readers keep their own templates; that is how a reader recognises a finger.
 * CLOR keeping a COPY — to put a person enrolled at one gate onto every other
 * gate — is a separate processing of biometric data, so it is:
 *  - off unless the company switches it on, and the admin who does records
 *    that employees were told and agreed (AttendanceSettings.biometricCopy);
 *  - never for someone who withdrew (Employee.biometricOptOutAt);
 *  - never for anyone under 18 (DPDP s.9: no processing that could harm a
 *    child without verifiable parental consent, which CLOR does not collect);
 *  - encrypted at rest (AES-256-GCM), and deleted when the person leaves,
 *    withdraws, or the company switches copying off.
 * Companies that had copies before this rule: they are not used, and are
 * deleted after BIOMETRIC_GRACE_UNTIL unless the company switches copying on.
 */
export const BIOMETRIC_GRACE_UNTIL = '2026-11-18';

const SEALED = 'enc:';
export const sealTemplate = (data: string) => (data.startsWith(SEALED) ? data : `${SEALED}${encryptSecret(data)}`);
export const openTemplate = (data: string) => (data.startsWith(SEALED) ? decryptSecret(data.slice(SEALED.length)) : data);

/** Under 18 on the given day, from a YYYY-MM-DD date of birth. Unknown is not a child. */
export function isMinor(dateOfBirth: string | null | undefined, today = new Date().toISOString().slice(0, 10)) {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return false;
  const eighteenth = `${Number(dateOfBirth.slice(0, 4)) + 18}${dateOfBirth.slice(4)}`;
  return eighteenth > today;
}

export type BiometricPolicy = { copy: boolean; excluded: Set<string>; allows: (employeeId: string | null | undefined) => boolean };

/* A reader's batch of templates asks once for the company switch, not per line; changing it through CLOR clears it. */
const copyCache = new Map<string, { at: number; copy: Promise<boolean> }>();
export const clearBiometricPolicy = (orgId: string) => copyCache.delete(orgId);
const copyingOn = (orgId: string) => {
  const hit = copyCache.get(orgId);
  if (hit && Date.now() - hit.at < 5_000) return hit.copy;
  const copy = peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { biometricCopy: true } }).then((x) => Boolean(x?.biometricCopy));
  copyCache.set(orgId, { at: Date.now(), copy });
  return copy;
};

/** Who is excluded is read fresh every time: someone added a moment ago, or who just withdrew, must never slip through. */
export async function biometricPolicy(orgId: string): Promise<BiometricPolicy> {
  const [copy, people] = await Promise.all([
    copyingOn(orgId),
    peoplePrisma.employee.findMany({ where: { orgId, OR: [{ biometricOptOutAt: { not: null } }, { dateOfBirth: { not: null } }] }, select: { id: true, biometricOptOutAt: true, dateOfBirth: true } }),
  ]);
  const excluded = new Set(people.filter((p) => p.biometricOptOutAt || isMinor(p.dateOfBirth)).map((p) => p.id));
  return { copy, excluded, allows: (id) => copy && !(id && excluded.has(id)) };
}

/** A Prisma where-fragment for templates CLOR may send on: none when copying is off, and never the excluded. */
export const sendableWhere = (p: BiometricPolicy) => (p.copy ? { OR: [{ employeeId: null }, { employeeId: { notIn: [...p.excluded] } }] } : { id: '__copying_off__' });

/** Delete every copy CLOR holds for these people (they withdrew, or left). */
export const forgetTemplates = (orgId: string, employeeIds: string[]) =>
  employeeIds.length ? peoplePrisma.biometricTemplate.deleteMany({ where: { orgId, employeeId: { in: employeeIds } } }) : Promise.resolve({ count: 0 });
