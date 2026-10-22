/**
 * The split sidebar: an app's `modules` resolved against its permission-
 * filtered `nav`, so the rail and the panel only ever show screens this
 * person may open.
 *
 *   modules: [{ key, label, icon?, items?: [navKey], groups?: [{ label, items: [navKey] }] }]
 *
 * A module keeps whatever of its screens survive the filter; one that keeps
 * nothing is not shown. A module with a single screen and no groups has no
 * panel — the rail entry is the screen (ClorTime's Dashboard).
 */
export function resolveModules(app, nav) {
  const byKey = new Map((nav || []).filter((i) => i.key).map((i) => [i.key, i]));
  return (app?.modules || [])
    .map((m) => {
      const groups = (m.groups || [{ label: null, items: m.items || [] }])
        .map((g) => ({ label: g.label, items: g.items.map((k) => byKey.get(k)).filter(Boolean) }))
        .filter((g) => g.items.length);
      const items = groups.flatMap((g) => g.items);
      if (!items.length) return null;
      const single = !m.groups && items.length === 1;
      return { key: m.key, label: m.label, icon: m.icon || items[0].icon, groups, items, single, home: items[0].key };
    })
    .filter(Boolean);
}

/**
 * The module whose screens include this one, else null. A screen kept off the
 * sidebar (a page under a Settings hub) names its `parent` in the nav, and
 * belongs to the parent's module.
 */
/**
 * A settings page (`hub: true`) is a page of links to the screens marked
 * `parent: <its key>`. It carries no permission of its own: it is there when
 * this person may open at least one of them, and gone when they may open none.
 */
export function withoutEmptyHubs(nav) {
  const parents = new Set(nav.filter((i) => i.parent).map((i) => i.parent));
  return nav.filter((i) => !i.hub || parents.has(i.key));
}

export function moduleForScreen(modules, screen, nav = []) {
  const direct = modules.find((m) => m.items.some((i) => i.key === screen));
  if (direct) return direct;
  const parent = (nav || []).find((i) => i.key === screen)?.parent;
  return parent ? modules.find((m) => m.items.some((i) => i.key === parent)) || null : null;
}

/**
 * What a tap on a rail module does. Opening a panel never changes the screen:
 * only a module with one screen (Today) navigates, because it has no panel.
 *
 *   go     open the module's only screen
 *   browse show this module's panel (phone sheet, or a closed/other panel)
 *   close  hide the panel this module already shows (desktop)
 */
export function railAction({ single, phone, panelShown }) {
  if (single) return 'go';
  if (phone) return 'browse';
  return panelShown ? 'close' : 'browse';
}

/**
 * The address for a screen: `?open=<screen>` (the name notification links
 * already use) and, where the hostname does not say which app this is,
 * `?app=<app>`. Other query parameters are kept as they are.
 */
export function screenSearch(search, { app, open, appInHost }) {
  const q = new URLSearchParams(search || '');
  if (!appInHost && app) q.set('app', app);
  if (open) q.set('open', open);
  else q.delete('open');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** The app and screen an address names, for a reload or the back button. */
export function readScreenSearch(search) {
  const q = new URLSearchParams(search || '');
  return { app: q.get('app') || null, open: q.get('open') || null };
}
