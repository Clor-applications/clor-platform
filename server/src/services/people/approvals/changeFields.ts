import { SCHEDULABLE_FIELDS } from '../effectiveDating.js';
import { SELF_FIELDS, PHOTO, PHOTO_MAX } from '../selfService.js';

/**
 * What a job or profile change may write when it is approved (security audit,
 * 3 Nov 2026). The approved request's payload used to be spread into the
 * employee update as it came, so a request could carry any column (the
 * sign-in link, the app password, the status) past a reviewer who saw only
 * its title. Now each type has its fields:
 *   JOB_CHANGE      the job fields history tracks (department, designation,
 *                   manager, work site, grade, type...), never status.
 *   PROFILE_CHANGE  the fields a person may change about themselves in the
 *                   employee app, and a new photo.
 * Anything else in the payload is refused when asked and dropped when applied.
 */
export const JOB_CHANGE_FIELDS: ReadonlySet<string> = new Set([...[...SCHEDULABLE_FIELDS].filter((f) => f !== 'status'), 'department', 'designation']);
export const PROFILE_CHANGE_FIELDS: ReadonlySet<string> = new Set<string>([...SELF_FIELDS, 'photoUrl']);

export const changeFieldsFor = (requestType: string): ReadonlySet<string> | null =>
  requestType === 'JOB_CHANGE' ? JOB_CHANGE_FIELDS : requestType === 'PROFILE_CHANGE' ? PROFILE_CHANGE_FIELDS : null;

/** Why a submitted change payload is refused, or null. `data` is set only by the employee app's own path, never by a caller. */
export function changePayloadProblem(requestType: string, payload: Record<string, unknown>): string | null {
  const allowed = changeFieldsFor(requestType);
  if (!allowed) return null;
  if (payload.data !== undefined) return 'A change carries its fields only.';
  const fields = payload.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 'Say which fields change.';
  const bad = Object.keys(fields).filter((k) => !allowed.has(k));
  return bad.length ? `${bad.join(', ')} cannot be changed by a ${requestType === 'JOB_CHANGE' ? 'job' : 'profile'} change.` : null;
}

/** The new photo a profile change carries, if it is a real one; nothing else in `data` is ever applied. */
export const photoFrom = (data: unknown): string | null => {
  const photo = data && typeof data === 'object' ? (data as Record<string, unknown>).photoUrl : null;
  return typeof photo === 'string' && photo.length <= PHOTO_MAX && PHOTO.test(photo) ? photo : null;
};
