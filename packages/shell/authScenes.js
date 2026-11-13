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
  /* A free trial is the same first step as an account: the building-blocks picture, not the sign-in door. */
  start: 'signup',
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
 * (owner, 10 Nov 2026) and on clor.in (owner, 13 Nov 2026: "great quotes regarding
 * finance, teams, companies, people").
 *
 * Every line was checked against a source on 13 Nov 2026 and `from` says where it
 * is recorded. A line with no traceable source stays out, however often it is
 * repeated: that day removed eight (among them the Tagore "cross the sea" line and
 * both Kalam lines of the first list, which no book, speech or letter could be
 * found for). Add a line only with its source. `about` is the subject shown above
 * it; the order mixes the subjects so no two of one kind follow each other.
 */
export const QUOTES = [
  { about: 'Finance', text: 'Beware of little expenses; a small leak will sink a great ship.', by: 'Benjamin Franklin', from: 'The Way to Wealth, 1758' },
  { about: 'Teams', text: 'Alone we can do so little; together we can do so much.', by: 'Helen Keller', from: 'Quote Investigator, 2014: said by Keller on several occasions' },
  { about: 'Companies', text: 'Nothing worthwhile is ever achieved without deep thought and hard work.', by: 'J. R. D. Tata', from: 'Letter to K. C. Bhansali, 1965 (Tata Central Archives)' },
  { about: 'People', text: 'Arise, awake, and stop not till the goal is reached.', by: 'Swami Vivekananda', from: 'Lectures from Colombo to Almora, 1897, after Katha Upanishad 1.3.14' },
  { about: 'Work', text: 'Well done is better than well said.', by: 'Benjamin Franklin', from: 'Poor Richard’s Almanack, 1737' },
  { about: 'Teams', text: 'Great things in business are never done by one person. They’re done by a team of people.', by: 'Steve Jobs', from: '60 Minutes, CBS, 2003' },
  { about: 'Finance', text: 'Price is what you pay; value is what you get.', by: 'Warren Buffett', from: 'Berkshire Hathaway shareholder letter, 2008, crediting Benjamin Graham' },
  { about: 'People', text: 'Where the mind is without fear and the head is held high.', by: 'Rabindranath Tagore', from: 'Gitanjali, poem 35, 1912' },
  { about: 'Work', text: 'Efficiency is concerned with doing things right. Effectiveness is doing the right things.', by: 'Peter Drucker', from: 'Drucker Institute quote library' },
  { about: 'Teams', text: 'If I have seen further, it is by standing on the shoulders of giants.', by: 'Isaac Newton', from: 'Letter to Robert Hooke, 5 February 1675' },
  { about: 'Companies', text: 'Performance leads to recognition, recognition leads to respect, and respect leads to power.', by: 'N. R. Narayana Murthy', from: 'Convocation addresses, IIT Guwahati and IIM Ahmedabad (2023)' },
  { about: 'Work', text: 'You have a right to your work, but never to the fruits of your work.', by: 'Bhagavad Gita', from: 'Chapter 2, verse 47' },
  { about: 'Teams', text: 'Talent wins games, but teamwork and intelligence wins championships.', by: 'Michael Jordan', from: 'I Can’t Accept Not Trying, 1994' },
  { about: 'Work', text: 'The journey of a thousand miles begins with a single step.', by: 'Lao Tzu', from: 'Tao Te Ching, chapter 64' },
];
