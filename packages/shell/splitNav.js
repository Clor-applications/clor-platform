/**
 * The split sidebar: an app's `modules` resolved against its permission-
 * filtered `nav`, so the rail and the panel only ever show screens this
 * person may open.
 *
 *   modules: [{ key, label, short?, icon?, items?: [navKey], groups?: [{ label, items: [navKey] }] }]
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
      const shortcuts = m.shortcuts?.filter((link) => items.some((item) => item.key === link.key));
      return { ...(shortcuts ? { shortcuts } : {}), opensHome: m.opensHome, key: m.key, label: m.label, short: m.short, icon: m.icon || items[0].icon, groups, items, single, home: items[0].key };
    })
    .filter(Boolean);
}

/** The top bar searches the same permitted destinations and issue shortcuts as the navigation. */
export function searchPages(app, nav, modules) {
  const pages = new Map();
  for (const item of nav) {
    if (item.section || !app?.screens?.[item.key]) continue;
    const aliases = (app.searchActions || []).filter((action) => !action.appId && action.screen === item.key);
    pages.set(item.key, { key: `screen:${item.key}`, screen: item.key, label: item.label, group: app.name,
      icon: item.icon, keywords: [...(item.keywords || []), ...aliases.flatMap((action) => [action.label, ...(action.keywords || [])])] });
  }
  if (app?.id !== 'people') return [...pages.values()];
  const issues = [];
  for (const module of modules) {
    for (const group of module.groups) {
      for (const item of group.items) {
        const page = pages.get(item.key);
        if (page) {
          page.matchWords = true;
          page.keywords.push(...[module.label, module.short, group.label].filter(Boolean));
        }
      }
    }
    for (const link of module.shortcuts || []) {
      const page = pages.get(link.key);
      if (page) issues.push({ key: `issue:${module.key}:${link.key}`, screen: link.key, label: link.label,
        group: module.short || module.label, keywords: link.keywords, matchWords: true, icon: page.icon, params: link.params });
    }
  }
  return [...pages.values(), ...issues];
}

/**
 * Where an app opens for this person: its home when they may open it, else
 * the first screen on their rail (People audit, 30 Oct 2026: an employee, an
 * outside auditor or a committee member opened People onto "You can't open
 * Home"). `nav` is the nav already filtered to what this person may open; while
 * their permissions are unknown it holds everything, so home wins.
 */
export function landingScreen(app, nav) {
  const home = app?.home || null;
  const kept = new Set((nav || []).filter((i) => i.key).map((i) => i.key));
  const homeGated = (app?.nav || []).some((i) => i.key === home);
  if (!home || kept.has(home) || !homeGated) return home;
  return resolveModules(app, nav)[0]?.home || (nav || []).find((i) => i.key && !i.hub && !i.section && app.screens?.[i.key])?.key || home;
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
export function withoutEmptyHubs(nav, modules = []) {
  const parents = new Set(nav.filter((i) => i.parent).map((i) => i.parent));
  const keys = new Set(nav.map((item) => item.key));
  return nav.filter((item) => {
    if (!item.overviewOf) return !item.hub || parents.has(item.key);
    const owner = modules.find((module) => module.key === item.overviewOf);
    return owner?.groups.some((group) => group.items.some((key) => key !== item.key && keys.has(key)));
  });
}

export function moduleForScreen(modules, screen, nav = []) {
  const direct = modules.find((m) => m.items.some((i) => i.key === screen));
  if (direct) return direct;
  const parent = (nav || []).find((i) => i.key === screen)?.parent;
  return parent ? modules.find((m) => m.items.some((i) => i.key === parent)) || null : null;
}

/** Compact path above the People page title. Only link to destinations in the user's navigation. */
export function peopleBreadcrumbs({ landing, screen, item, module, nav }) {
  const trail = [{ label: 'People', key: landing }];
  const report = item?.breadcrumbSection;
  if (report && nav.some(n => n.key === report.key)) {
    return [...trail, report];
  }
  const parent = item?.parent && nav.find(n => n.key === item.parent);
  if (module) {
    trail.push({ label: module.short || module.label, key: module.home });
  }
  if (parent && parent.key !== module?.home && parent.key !== screen) {
    // Employees overview and the directory both use "Employees" in a short path.
    if (trail.at(-1).label === parent.label) trail.pop();
    trail.push({ label: parent.label, key: parent.key });
  }
  if (trail.length === 1 && item?.label) trail.push({ label: item.label, key: screen });
  return trail;
}

/**
 * What a tap on a rail module does. Opening a panel never changes the screen:
 * only a module with one screen (Today) navigates, because it has no panel.
 *
 *   go     open the module's only screen
 *   browse show this module's panel (phone sheet, or a closed/other panel)
 *   close  hide the panel this module already shows (desktop)
 */
export function railAction({ single, phone, panelShown, opensHome = false, current = false }) {
  if (single) return 'go';
  if (phone) return 'browse';
  /*
   * An app may ask that a rail tap open the module's own landing page (the
   * Workspace: Company opens Companies, Access opens the access overview), so
   * the content always follows the module chosen. Tapping the module you are
   * already in still folds its panel.
   */
  if (opensHome) return current && panelShown ? 'close' : 'goOpen';
  return panelShown ? 'close' : 'browse';
}

/**
 * The address for a screen: `?open=<screen>` (the name notification links
 * already use) and, where the hostname does not say which app this is,
 * `?app=<app>`. Other query parameters are kept as they are.
 */
export function screenSearch(search, { app, open, appInHost, params }) {
  const q = new URLSearchParams(search || '');
  if (!appInHost && app) q.set('app', app);
  if (open) q.set('open', open);
  else q.delete('open');
  /*
   * A screen's own state (the record open, its tab, the directory's filters)
   * rides along as `s.<key>`, so Back, refresh and a shared link land on the
   * same record and tab (People design spec v1, D-V7). Passing `params`
   * replaces them; a new screen with none clears them.
   */
  if (params !== undefined) {
    for (const k of [...q.keys()]) if (k.startsWith(PARAM_PREFIX)) q.delete(k);
    for (const [k, v] of Object.entries(params || {})) {
      if (v == null || v === '' || typeof v === 'object') continue;
      q.set(`${PARAM_PREFIX}${k}`, String(v));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const PARAM_PREFIX = 's.';

/** The app, screen and screen state an address names, for a reload or the back button. */
export function readScreenSearch(search) {
  const q = new URLSearchParams(search || '');
  const params = {};
  for (const [k, v] of q.entries()) if (k.startsWith(PARAM_PREFIX) && k.length > PARAM_PREFIX.length) params[k.slice(PARAM_PREFIX.length)] = v;
  return { app: q.get('app') || null, open: q.get('open') || null, params: Object.keys(params).length ? params : null };
}

/** Params after a patch: a null or empty value removes the key. Null when nothing is left. */
export function mergeParams(current, patch) {
  const out = { ...(current || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v == null || v === '') delete out[k];
    else out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
