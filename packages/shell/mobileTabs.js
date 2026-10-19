/**
 * The bottom tab bar on a phone: four of an app's screens and a Menu that
 * opens the full navigation. An app names its own tabs (`mobileTabs` in its
 * manifest); otherwise the first four screens the person may open are used.
 */
export const MAX_TABS = 4;

export function mobileTabsFor(app, nav) {
  const screens = (nav || []).filter((i) => i && i.key && !i.section);
  const wanted = Array.isArray(app?.mobileTabs) ? app.mobileTabs : [];
  const picked = wanted.map((k) => screens.find((s) => s.key === k)).filter(Boolean);
  for (const s of screens) {
    if (picked.length >= MAX_TABS) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.slice(0, MAX_TABS);
}

/** True below the `md` breakpoint (767px), where the rail gives way to tabs. */
export const PHONE_QUERY = '(max-width: 767px)';
/** A tablet: the rail stays, the screens panel opens over the content instead of beside it. */
export const TABLET_QUERY = '(min-width: 768px) and (max-width: 1099px)';
