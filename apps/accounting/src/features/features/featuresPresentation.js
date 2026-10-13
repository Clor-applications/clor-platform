/**
 * Which face Features shows to a CONTEXTUAL trigger (⌘K, an in-page link),
 * decided by where you are asking from.
 *
 * The rail does not ask. Clicking Features in the rail is "take me there" and
 * goes to the full page from anywhere, like every other rail entry. This
 * decision is for reaching Features without meaning to leave: from Home there
 * is nothing underneath worth keeping — nothing is half-typed on the
 * dashboard — so it navigates to the page. From inside a module there is: an
 * invoice with four lines on it, a customer half-filled, a report scrolled to
 * the right row. `<main>` is keyed on the route, so navigating away would
 * remount all of that empty. There, Features is a tool, opened over the screen
 * and put away again with the screen untouched.
 *
 * The decision reads the CURRENT route, never the destination.
 */

/** Routes that already show the Features page; asking for Features from one is asking to stay. */
export const FEATURES_PAGE_ROUTES = new Set([
  'features',
  // The retired Settings capability panes, which render the same page for saved links.
  'settingsFeatures',
  'settingsSales',
  'settingsPurchases',
  'settingsInventory',
  'settingsAccounting',
  'settingsPaymentsReceipts',
  'settingsDocuments',
]);

/** The landing screen: nothing underneath to preserve, so Features is a destination from here. */
export const LANDING_ROUTE = 'dashboard';

/**
 * 'page' — navigate to the full Features page.
 * 'panel' — open the contextual panel over the current screen.
 */
export const featuresPresentationFor = (activeRoute) => {
  const key = String(activeRoute || '');
  if (!key || key === LANDING_ROUTE || FEATURES_PAGE_ROUTES.has(key)) return 'page';
  return 'panel';
};
