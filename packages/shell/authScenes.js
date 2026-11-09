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
 * Prompts for every picture: Clor R&D/brand/auth-panel-prompts.md.
 */

/** Pictures that are in public/auth/. */
export const READY = new Set(['team']);

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
  forgot: 'forgot-password',
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
