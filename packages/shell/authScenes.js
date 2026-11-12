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
 * Width over height of each picture, so the picture side is cut to the picture's own
 * shape and the whole picture shows, top to bottom (owner, 10 Nov 2026: nothing cropped).
 */
const RATIO = { team: 1.5, 'signin-people': 1.113, 'signin-payroll': 1.113, 'signin-attendance': 1.113 };
export const sceneRatio = (file) => RATIO[file] || 1;

/**
 * Lines worth reading on the way in, one after another on every sign-in page
 * (owner, 10 Nov 2026). Well-known lines with the name they are known by.
 */
export const QUOTES = [
  { text: 'Arise, awake, and stop not till the goal is reached.', by: 'Swami Vivekananda' },
  { text: 'You have a right to your work, but never to the fruits of your work.', by: 'Bhagavad Gita' },
  { text: 'You can’t cross the sea merely by standing and staring at the water.', by: 'Rabindranath Tagore' },
  { text: 'If you want to shine like a sun, first burn like a sun.', by: 'A. P. J. Abdul Kalam' },
  { text: 'The journey of a thousand miles begins with a single step.', by: 'Lao Tzu' },
  { text: 'Well done is better than well said.', by: 'Benjamin Franklin' },
  { text: 'Excellence is a continuous process and not an accident.', by: 'A. P. J. Abdul Kalam' },
];
