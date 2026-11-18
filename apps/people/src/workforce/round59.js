/*
 * Round 59 picks (18 Nov 2026), People side.
 *
 * quickadd A: a person can be added with the few details HR has today; their
 * record then lists what is still missing, so it is finished later, not lost.
 * probationend A: the probation end date worked out from the joining date and
 * the employment type's rule, saying so under the field.
 */

/* What a complete record has, in the order HR would fill it, and where each is edited. */
const DETAILS = [
  { key: 'phone', label: 'Phone', has: (p) => p.phone || p.workPhone, tab: 'personal', edit: 'contact' },
  { key: 'email', label: 'Email', has: (p) => p.workEmail || p.email || p.personalEmail, tab: 'personal', edit: 'contact' },
  { key: 'dateOfBirth', label: 'Date of birth', has: (p) => p.dateOfBirth, tab: 'personal', edit: 'personal', personal: true },
  { key: 'gender', label: 'Gender', has: (p) => p.gender, tab: 'personal', edit: 'personal' },
  { key: 'emergency', label: 'Emergency contact', has: (p) => p.emergencyContactPhone || p.emergencyContactName, tab: 'personal', edit: 'emergency', personal: true },
  { key: 'department', label: 'Department', has: (p) => p.department || p.departmentId, tab: 'organization', action: 'transfer' },
  { key: 'designation', label: 'Designation', has: (p) => p.designation || p.jobPositionId, tab: 'organization', action: 'transfer' },
  { key: 'manager', label: 'Manager', has: (p) => p.reportingManagerId || p.reportingManagerName, tab: 'organization', action: 'transfer' },
];

/** The details still missing on a record (none for someone who has left). */
export function detailsToFinish(person) {
  if (!person || person.status === 'LEFT') return [];
  return DETAILS.filter((d) => !(d.personal && person.personalHidden) && !d.has(person));
}

/** The line under "Probation ends" while it is still the date worked out from the rule. */
export function probationHint(form, suggested, months) {
  if (!suggested || !months || form.probationEndDate !== suggested) return '';
  return `${months} ${Number(months) === 1 ? 'month' : 'months'} from joining, from the employment type. Change it if needed.`;
}
