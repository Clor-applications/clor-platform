/**
 * Record extras on the employee file (server picks, theme A, 18 Nov 2026; style rounds 34, 39 and 43).
 *
 * Two kinds:
 * - HR only (RECORD_EXTRAS_PERSONAL): blood group, disability, a health note, food preference, shoe and uniform
 *   size, a second emergency contact and the permanent address. They join the personal details
 *   (routes/people.ts PERSONAL_FIELDS): whoever keeps the records sees them, and the person themself; a
 *   read-only role, a manager without that grant, colleagues and API keys do not.
 * - Work profile: initials, the office extension, languages spoken (searchable in the directory) and how the
 *   person was hired. These read like the job details.
 */
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const FOOD_PREFERENCES = ['VEG', 'NON_VEG', 'EGG', 'JAIN'] as const;
export const HIRE_SOURCES = ['REFERRAL', 'JOB_SITE', 'AGENCY', 'CAMPUS', 'WALK_IN', 'CAREERS_PAGE', 'INTERNAL', 'OTHER'] as const;

export const RECORD_EXTRAS_PERSONAL = [
  'emergencyContact2Name', 'emergencyContact2Phone', 'emergencyContact2Relation',
  'permSameAsPresent', 'permAddressLine', 'permCity', 'permState', 'permCountry', 'permPincode',
  'bloodGroup', 'disability', 'healthNote', 'foodPreference', 'shoeSize', 'uniformSize',
] as const;

/**
 * Kept by HR alone: health and the second emergency contact. A role that only reads (Viewer, which may see
 * statutory details and so the personal tier) does not get these; whoever may edit employee records does, and the
 * person themself. There is no first-aid role in CLOR: HR reads it out when it is needed.
 */
export const HR_ONLY_FIELDS = ['bloodGroup', 'disability', 'healthNote', 'emergencyContact2Name', 'emergencyContact2Phone', 'emergencyContact2Relation'] as const;

/** Every text column of the extras, written as typed (blank becomes null). */
export const RECORD_EXTRAS_TEXT = [
  'emergencyContact2Name', 'emergencyContact2Phone', 'emergencyContact2Relation',
  'permAddressLine', 'permCity', 'permState', 'permCountry', 'permPincode',
  'bloodGroup', 'disability', 'healthNote', 'foodPreference', 'shoeSize', 'uniformSize',
  'initials', 'officeExtension', 'hireSource',
] as const;

/** Every extras column, for the change log. */
export const RECORD_EXTRAS_ALL = [...RECORD_EXTRAS_TEXT, 'permSameAsPresent', 'languages'] as const;

export const RECORD_EXTRAS_WORDS: Record<string, string> = {
  emergencyContact2Name: 'Second emergency contact', emergencyContact2Phone: 'Second emergency contact phone', emergencyContact2Relation: 'Second emergency contact relation',
  permSameAsPresent: 'Permanent address same as present', permAddressLine: 'Permanent address', permCity: 'Permanent city', permState: 'Permanent state', permCountry: 'Permanent country', permPincode: 'Permanent PIN code',
  bloodGroup: 'Blood group', disability: 'Disability', healthNote: 'Health note', foodPreference: 'Food preference', shoeSize: 'Shoe size', uniformSize: 'Uniform size',
  initials: 'Initials', officeExtension: 'Extension', languages: 'Languages', hireSource: 'How they were hired',
};

/** "tamil " -> "Tamil": one spelling per language, so the directory search finds it. */
export const languageWord = (v: string) => {
  const t = String(v || '').trim().replace(/\s+/g, ' ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
};

/** Trimmed, one spelling each, no repeats, at most 20. */
export function normaliseLanguages(list: readonly string[]) {
  const out: string[] = [];
  for (const raw of list || []) {
    const w = languageWord(raw);
    if (w && !out.includes(w)) out.push(w);
  }
  return out.slice(0, 20);
}

/** How hiring's candidate source maps onto the record's "how they were hired" (carried on joining). */
export function hireSourceFromCandidate(source: string | null | undefined): (typeof HIRE_SOURCES)[number] | null {
  const s = String(source || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!s) return null;
  if ((HIRE_SOURCES as readonly string[]).includes(s)) return s as any;
  if (/REFER/.test(s)) return 'REFERRAL';
  if (/AGENC|CONSULT|VENDOR/.test(s)) return 'AGENCY';
  if (/CAMPUS|COLLEGE|UNIVERSITY/.test(s)) return 'CAMPUS';
  if (/WALK/.test(s)) return 'WALK_IN';
  if (/CAREER|WEBSITE/.test(s)) return 'CAREERS_PAGE';
  if (/INTERNAL|INSIDE/.test(s)) return 'INTERNAL';
  if (/NAUKRI|LINKEDIN|INDEED|PORTAL|JOB/.test(s)) return 'JOB_SITE';
  return 'OTHER';
}
