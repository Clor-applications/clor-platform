/**
 * Who runs this Clor deployment — the facts the legal pages need.
 *
 * None of these can be known from the code, and none may be guessed: a
 * privacy notice naming the wrong company, or a grievance address nobody
 * reads, is worse than an honest blank. Each comes from a build-time
 * variable (set it in the environment the web app is built in, e.g. `.env`):
 *
 *   VITE_OPERATOR_NAME            legal name of the business running the service
 *   VITE_OPERATOR_ADDRESS         registered address
 *   VITE_OPERATOR_REGISTRATION    company registration (e.g. CIN), optional
 *   VITE_CONTACT_EMAIL            general and support contact
 *   VITE_GRIEVANCE_OFFICER        name of the grievance / data protection contact
 *   VITE_GRIEVANCE_EMAIL          their email
 *   VITE_HOSTING_PROVIDER         where the servers run (e.g. "Oracle Cloud, Mumbai region")
 *   VITE_GOVERNING_LAW            courts / jurisdiction for the terms (e.g. "Bengaluru, Karnataka")
 *   VITE_POLICY_EFFECTIVE_DATE    the date these documents take effect (YYYY-MM-DD)
 *
 * Anything unset is shown as a marked placeholder and the page says it is a
 * draft — see OWNER_INPUT_REQUIRED.md.
 */
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const read = (key) => String(env[key] || '').trim();

export const FIELDS = {
  name: { key: 'VITE_OPERATOR_NAME', label: 'Operator legal name' },
  address: { key: 'VITE_OPERATOR_ADDRESS', label: 'Registered address' },
  registration: { key: 'VITE_OPERATOR_REGISTRATION', label: 'Company registration number', optional: true },
  contactEmail: { key: 'VITE_CONTACT_EMAIL', label: 'Contact email' },
  grievanceOfficer: { key: 'VITE_GRIEVANCE_OFFICER', label: 'Grievance officer' },
  grievanceEmail: { key: 'VITE_GRIEVANCE_EMAIL', label: 'Grievance email' },
  hosting: { key: 'VITE_HOSTING_PROVIDER', label: 'Hosting provider and region' },
  governingLaw: { key: 'VITE_GOVERNING_LAW', label: 'Governing law and courts' },
  effectiveDate: { key: 'VITE_POLICY_EFFECTIVE_DATE', label: 'Effective date' },
};

export const operator = Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, read(f.key)]));

/** Required details nobody has filled in yet. */
export const missingDetails = () =>
  Object.entries(FIELDS)
    .filter(([k, f]) => !f.optional && !operator[k])
    .map(([, f]) => f.label);
