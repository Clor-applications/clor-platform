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

/** The module whose screens include this one, else null. */
export function moduleForScreen(modules, screen) {
  return modules.find((m) => m.items.some((i) => i.key === screen)) || null;
}
