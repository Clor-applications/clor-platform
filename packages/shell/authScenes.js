/**
 * The picture beside every sign-in, sign-up and password form (owner, 10 Nov 2026:
 * the picture takes 60% of the screen, the form 40%).
 *
 * Each page has its own scene, and the sign-in page has one per app, so People's
 * door looks like People and Payroll's like Payroll. A scene whose picture has not
 * been made yet falls back to the workspace one, then to the shared team picture.
 * Adding a picture is: put `<file>-960.webp` and `<file>-1536.webp` in
 * `public/auth/`, then list the file name in READY.
 *
 * Each picture carries its own title in its top-left corner (owner's artwork), so
 * the CLOR chip sits at the bottom, on the navy fade.
 *
 * Prompts for every picture: Clor R&D/brand/auth-panel-prompts.md.
 */

/** Pictures that are in public/auth/. */
export const READY = new Set([
  'team',
  'signin-workspace',
  'signin-books',
  'signin-people',
  'signin-payroll',
  'signin-attendance',
  'signup',
  'set-password',
  'accept-invite',
]);

/** The sign-in picture for each app's own address. */
const SIGNIN_BY_APP = {
  accounting: 'signin-books',
  people: 'signin-people',
  payroll: 'signin-payroll',
  attendance: 'signin-attendance',
};

/** Every other page's picture. */
const SCENES = {
  signup: 'signup',
  forgot: 'set-password',
  reset: 'set-password',
  verify: 'check-email',
  twoStep: 'two-step',
  invite: 'accept-invite',
  explore: 'explore',
};

/** The file to show for a page (`scene`) on an app's address (`app`, or null on app.clor.in). */
export function sceneFile(scene, app) {
  const wanted = scene === 'signin' ? SIGNIN_BY_APP[app] || 'signin-workspace' : SCENES[scene];
  for (const f of [wanted, 'signin-workspace', 'team']) {
    if (f && READY.has(f)) return f;
  }
  return null;
}

export const sceneSrc = (file) => ({
  src: `/auth/${file}-1536.webp`,
  srcSet: `/auth/${file}-960.webp 960w, /auth/${file}-1536.webp 1536w`,
});

/**
 * Short facts that turn over on the picture, one app's worth on its own address.
 * Plain statements of what the product does, no claims or numbers we cannot stand behind.
 */
const FACTS = {
  workspace: [
    'One login opens Books, People, Payroll and Attendance.',
    'Your accountant gets their own login, with only what you allow.',
    'Every change is written to an audit trail with a name on it.',
  ],
  accounting: [
    'GSTR-1 fills itself from the invoices you raise.',
    'E-invoices and e-way bills come from the same invoice.',
    'Masters and opening balances import straight from Tally.',
  ],
  people: [
    'One record per employee, from offer letter to final settlement.',
    'Documents remind you before they expire.',
    'Leave requests reach the manager on their phone.',
  ],
  payroll: [
    'PF, ESI, PT and TDS worked out on every payslip.',
    'Payslips reach each phone the moment the run is locked.',
    'Locking a pay run posts its journal to Books.',
  ],
  attendance: [
    'ZKTeco, eSSL, Hikvision and Matrix readers send punches as they happen.',
    'Field staff punch from a phone inside the site’s geofence.',
    'Closing the month hands paid days to Payroll.',
  ],
};

/** The facts for an app's address (`app`, or null on app.clor.in). */
export const factsFor = (app) => FACTS[app] || FACTS.workspace;
