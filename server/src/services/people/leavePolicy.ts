/**
 * Whether a leave type's policy lets this person ask for these days
 * (People → Settings → Leave Policy). Null when it does; otherwise the reason,
 * in the words the person sees. The balance is checked separately.
 *
 * Who it is for (gender, employee type, time since joining) and the shape of
 * the request (half day, longest request) apply to everyone. Notice and how
 * far back apply to people asking for themselves; HR entering leave on
 * someone's behalf — usually after the fact — is not held to them.
 */

export type LeavePolicy = {
  name: string;
  allowHalfDay: boolean;
  minNoticeDays: number | null;
  maxDaysPerRequest: number | null;
  backdatedDays: number | null;
  gender: string | null;
  employeeTypeIds: string[];
  availableAfterDays: number | null;
  /** JOINING (calendar days after joining, the default) or DAYS_WORKED (days worked in the 12 months before the leave). */
  availableAfterBasis?: string | null;
};

export type LeavePerson = { gender: string | null; employeeTypeId: string | null; dateOfJoining: string | null } | null;

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function policyProblem(
  type: LeavePolicy,
  person: LeavePerson,
  /** workedBefore: days worked in the 12 months before fromDate, when the type counts days worked; undefined = not known. */
  ask: { fromDate: string; halfDay: string | null; days: number; workedBefore?: number | null },
  today: string,
  onBehalf: boolean
): string | null {
  if (person?.dateOfJoining && ask.fromDate < person.dateOfJoining) return `Leave cannot start before joining on ${person.dateOfJoining}.`;
  if (type.gender && person?.gender !== type.gender) {
    return `${type.name} is for ${type.gender === 'FEMALE' ? 'women' : 'men'}. Check the gender on this person’s file if that is wrong.`;
  }
  if (type.employeeTypeIds?.length && !(person?.employeeTypeId && type.employeeTypeIds.includes(person.employeeTypeId))) {
    return `${type.name} is not open to this person’s employee type.`;
  }
  if (type.availableAfterDays && type.availableAfterBasis === 'DAYS_WORKED') {
    /* Code on Social Security (maternity): 80 days worked in the 12 months before. Paid leave counts as worked. */
    if (ask.workedBefore != null && ask.workedBefore < type.availableAfterDays) {
      return `${type.name} needs ${plural(type.availableAfterDays, 'day')} worked in the 12 months before it starts; this person has ${ask.workedBefore} to ${addDays(ask.fromDate, -1)}.`;
    }
  } else if (type.availableAfterDays && person?.dateOfJoining) {
    const from = addDays(person.dateOfJoining, type.availableAfterDays);
    if (ask.fromDate < from) return `${type.name} can be taken from ${from}, ${plural(type.availableAfterDays, 'day')} after joining.`;
  }
  if (ask.halfDay && !type.allowHalfDay) return `${type.name} is taken in whole days.`;
  if (type.maxDaysPerRequest != null && ask.days > type.maxDaysPerRequest) {
    return `One request for ${type.name} is at most ${plural(type.maxDaysPerRequest, 'day')}; this is ${ask.days}.`;
  }
  if (onBehalf) return null;
  if (type.minNoticeDays && ask.fromDate >= today && ask.fromDate < addDays(today, type.minNoticeDays)) {
    return `${type.name} is asked for ${plural(type.minNoticeDays, 'day')} ahead: the earliest is ${addDays(today, type.minNoticeDays)}.`;
  }
  if (type.backdatedDays != null && ask.fromDate < today && ask.fromDate < addDays(today, -type.backdatedDays)) {
    return type.backdatedDays === 0
      ? `${type.name} cannot be asked for after the day. Ask HR to enter it.`
      : `${type.name} can be asked for up to ${plural(type.backdatedDays, 'day')} after the day. Ask HR to enter it.`;
  }
  return null;
}
