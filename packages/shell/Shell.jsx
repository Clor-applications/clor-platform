import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Building2, CalendarDays, Check, ChevronDown, CircleHelp, LayoutGrid, LogOut, Menu, Plus, Search, Settings, UserRound, X } from '@ui/components/ui/lineIcons';

import { useTheme } from '@ui/components/ui/useTheme';
import { useDismissable } from '@ui/components/ui/useDismissable';
import { formatDateIn } from '@ui/utils/dates';
import { ProfileScreen } from '@ui/profile/ProfileScreen';
import Toaster from '@ui/components/ui/Toaster';
import { getMyPermissions } from '@ui/api/permissions';
import { PermissionProvider } from '@ui/permissions/PermissionContext';
import { WriteGuard } from '@ui/permissions/WriteGuard';
import { paramsForOpen } from './openParams';
import { SkeletonCard } from '@ui/components/ui/Primitives';
import { IconSetContext, LineSetContext } from '@ui/components/ui/iconSet';

import { useAppCatalogue, listingFor } from './appCatalogue';
import { APPS, appById, availableApps, catalogueFor, landingApp, landingFor, subscribedApps } from './registry';
import { ADMIN_APP_ID, appFromHost, hostForApp, isFrontDoor } from './appHosts';
import { includedForward } from './includedForward';
import { PHONE_QUERY, TABLET_QUERY, mobileTabsFor } from './mobileTabs';
import { landingScreen, mergeParams, moduleForScreen, railAction, readScreenSearch, resolveModules, screenSearch, withoutEmptyHubs } from './splitNav';
import { useSession } from './session';
import { OPEN_APP_EVENT, OPEN_HELP_EVENT, OPEN_SCREEN_EVENT } from '@platform/context';
import { AnnouncementBar } from './Announcements';
import { clearUnsaved, confirmLeave, hasUnsaved } from '@platform/unsaved';
import { EXPLORE_READ_ONLY_TEXT, confirmDialog, notify } from '@ui/components/ui/notify';
import { ExploreEnded, ExploreLanding, ExploreNotice } from './Explore';
import { isExplorePath } from './exploreLink';
import Start from './Start';
import { isStartPath } from './startLink';

/* Asked before any navigation that would drop edits a screen has not saved (spec v1 §5.1, WF-11). */
const askLeave = () => confirmDialog({ title: 'Leave without saving?', message: 'Your changes on this page have not been saved.', confirmLabel: 'Leave', tone: 'danger' });
import HelpCenter from './HelpCenter';
import { ClorLogo, ClorMark } from '@ui/components/brand';
import NotificationBell from './NotificationBell';
import { watchWideTables } from './wideTables';
import HelpMenu from './HelpMenu';
import TwoFactorGate from './TwoFactorGate';
import CommandPalette from '@ui/components/ui/CommandPalette';
import CompanySetup from './CompanySetup';
import { appIntent, captureAppIntent } from './appIntent';
import NoCompanyAccess from './NoCompanyAccess';
import InviteAccept from './InviteAccept';
import { appAddress, frontDoorForward } from './orgUrl';
import ScreenBoundary from './ScreenBoundary';
import SignIn from './SignIn';
import SignUp from './SignUp';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';
import VerifyEmail from './VerifyEmail';
import LegalPage from './legal/LegalPage';
import { useLegalRoute } from './legal/useLegalRoute';
import { renderPublicPage, usePublicPage } from './usePublicPage';

/**
 * The CLOR shell.
 *
 * It owns the things that are true regardless of which application you are
 * looking at: who is signed in, which company, which apps that company has,
 * the switcher between them, and the theme. Everything else on screen belongs
 * to an app.
 *
 * The rule that makes this a platform rather than a large program: the shell
 * imports app manifests and nothing else. It does not know what a payslip is,
 * and Payroll does not know there is a theme toggle. Each app hands over a
 * nav, a set of screens and a home, and the shell arranges them.
 *
 * Which is why the sidebar shows one app's navigation at a time. A company
 * with four apps should not face a rail with every submenu of all four — it
 * should see the app it is in, and a way to the others.
 */

/* What shows while an app's file arrives, the first time it opens (WX-03). */
function AppLoading() {
  return (
    <div className="p-4" role="status" aria-label="Loading">
      <SkeletonCard lines={6} />
    </div>
  );
}

/** The marketing site, which is the product's front page; the app itself opens on sign-in. */
const MARKETING_URL = import.meta.env.VITE_MARKETING_URL || 'https://clor.in';
/* Before any page rewrites the address: remember the app a visitor came for. */
captureAppIntent();

/* Explore's way back to a person: the demo form on clor.in. */
const DEMO_URL = `${MARKETING_URL.replace(/\/$/, '')}/demo`;

const PUBLIC_PATHS = { signin: '/signin', signup: '/signup', forgot: '/forgot-password' };

/** Which door a signed-out visitor sees, from the address: clor.in's Get started links to /signup. */
export const publicPageFromPath = (pathname = typeof window === 'undefined' ? '/' : window.location.pathname) => {
  const p = String(pathname || '/').replace(/\/+$/, '') || '/';
  if (p === '/signup' || p === '/get-started') return 'signup';
  if (p === '/forgot-password') return 'forgot';
  return 'signin';
};

const ACCOUNT_ROLE_LABEL = { OWNER: 'owner', ADMIN: 'administrator', BILLING_ADMIN: 'billing admin', MEMBER: 'member' };

/**
 * W-2.1: the company picker is also the account switcher. With one account it
 * is a plain list; with more, each account's companies sit under its name,
 * with the person's role there or "outside access" when it is somebody else's
 * account they were let into. Choosing a company in another account switches
 * account: the screen is keyed by company, so nothing from the old one stays.
 */
export const companyGroups = (allTenants = [], accounts = []) => {
  /* Archived companies (read-only, kept for their records) go last, under their own heading. */
  const archived = allTenants.filter((t) => t.archivedAt);
  const tail = archived.length ? [{ id: 'archived', label: 'Archived (read-only)', items: archived }] : [];
  const tenants = allTenants.filter((t) => !t.archivedAt);
  const ids = [...new Set(tenants.map((t) => t.accountId || ''))];
  if (ids.length < 2) return [{ id: 'all', label: '', items: tenants }, ...tail];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const order = (id) => (byId.get(id)?.home ? 0 : 1);
  return ids
    .sort((a, b) => order(a) - order(b) || String(byId.get(a)?.name || '').localeCompare(String(byId.get(b)?.name || '')))
    .map((id) => {
      const a = byId.get(id);
      const how = a?.home ? (a.role ? ACCOUNT_ROLE_LABEL[a.role] || '' : '') : 'outside access';
      return { id, label: `${a?.name || 'Another account'}${how ? ` (${how})` : ''}`, items: tenants.filter((t) => (t.accountId || '') === id) };
    })
    .concat(tail);
};

/**
 * A phone's company choice, as menu items (#80 QA: the bar has no room for the picker). Each account's companies
 * sit under its name, as the desktop picker's groups do, so same-named companies in two accounts can be told apart.
 */
export function CompanyMenuItems({ groups, currentId, onPick }) {
  return (
    <div role="group" aria-label="Company">
      <div className="ui-caption px-2 pt-1">Company</div>
      {groups.map((g) => {
        const items = g.items.map((t) => (
          <button
            key={t.id}
            type="button"
            role="menuitemradio"
            aria-checked={t.id === currentId}
            className="w-full flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ui-hover-sunken"
            onClick={() => onPick(t)}
          >
            <Building2 size={16} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
            {t.id === currentId ? <Check size={16} aria-hidden="true" /> : null}
          </button>
        ));
        return g.label ? (
          <div key={g.id} role="group" aria-label={g.label}>
            <div className="ui-caption px-2 pt-2 font-medium" aria-hidden="true">{g.label}</div>
            {items}
          </div>
        ) : <React.Fragment key={g.id}>{items}</React.Fragment>;
      })}
    </div>
  );
}

/**
 * Whether a nav item's `permission` is held: one key, or a list of which any one
 * will do (what the screen's route accepts). `extra` holds the app's own access
 * keys (`access()` in its manifest). Unknown grants hide nothing.
 */
export const holdsPermission = (permission, granted, extra) => !permission || !granted || [].concat(permission).some((k) => granted.has(k) || Boolean(extra?.has(k)));

/**
 * The permission the screen-wide WriteGuard reads for a nav item: none when
 * the item lists several (any one opens it) or says `writeGuard: false` (the
 * Talent screens, where the server decides per person).
 */
export const writeGuardPermission = (item) => (item?.writeGuard === false || typeof item?.permission !== 'string' ? undefined : item.permission);

/** "SETTINGS::Users::VIEW" as a person reads it: "view Users (Settings)". */
export const permissionWords = (key = '') => {
  const [module = '', sub = '', action = ''] = String(key).split('::');
  const cap = (w) => w.charAt(0) + w.slice(1).toLowerCase();
  return `${action.toLowerCase() || 'use'} ${sub || cap(module)}${sub && module ? ` (${cap(module)})` : ''}`;
};

/** W-2.2: an explained empty state in place of a screen — not found, or not allowed — with one way on. */
function ScreenState({ title, text, action }) {
  return (
    <section className="ui-card p-6 max-w-xl" role="status" aria-labelledby="screen-state-title">
      <h1 id="screen-state-title" className="ui-display text-xl">{title}</h1>
      <p className="ui-muted mt-2">{text}</p>
      {action ? (
        <button type="button" className="ui-btn ui-btn-secondary mt-4" onClick={action.run}>
          {action.label}
        </button>
      ) : null}
    </section>
  );
}

/*
 * The platform's own pages (sign-in, company setup, an app's public page) draw in the icon family every app but
 * Accounting uses (owner, 9 Nov 2026): Phosphor two-tone marks and Fluent line icons. Inside, the open app's
 * manifest decides, so Accounting keeps its Lucide line icons exactly as before.
 */
export default function Shell() {
  return (
    <IconSetContext.Provider value="duo">
      <LineSetContext.Provider value="fluent">
        <ShellScreens />
      </LineSetContext.Provider>
    </IconSetContext.Provider>
  );
}

function ShellScreens() {
  /* A phone: no rail, a menu sheet and a tab bar instead (mobileTabs.js). */
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = (e) => setPhone(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  /* A tablet keeps the rail; the panel is an overlay, open only while choosing. */
  const [tablet, setTablet] = useState(() => typeof window !== 'undefined' && window.matchMedia(TABLET_QUERY).matches);
  const [tabletPanel, setTabletPanel] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(TABLET_QUERY);
    const onChange = (e) => { setTablet(e.matches); setTabletPanel(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (!tabletPanel) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setTabletPanel(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabletPanel]);
  const { user, tenant, tenants, accounts, createCompany, deniedCode, restoring, setTenantId, signOut, addApp, twoFactorSetupRequired, explore, exploreEnded } = useSession();

  /* The shared hook, not a second copy: the public page has a toggle too, and
     a private key here would mean the choice did not follow you inside. */
  useTheme();

  /* Null while the company's apps are still being read, which is not the same
     as none: treating it as none would flash an empty rail. */
  const subscriptions = tenant?.subscriptions;
  /* The sample company somebody is exploring keeps every app apart; a real one on People has Attendance inside People. */
  const listAll = Boolean(explore);
  const mine = useMemo(() => subscribedApps(subscriptions || [], { all: listAll }), [subscriptions, listAll]);
  const catalog = useMemo(() => catalogueFor(subscriptions || [], { all: listAll }), [subscriptions, listAll]);

  /*
   * What this person may open in this company, so an app's menu offers only
   * that. Null until known, or if it could not be read: then nothing is hidden
   * — the server checks every request anyway, and a menu emptied by a failed
   * lookup would be worse than one with an item that answers "no access".
   */
  const tenantKey = user && tenant ? `${tenant.id}|${tenant.branchId || ''}` : '';
  const [grants, setGrants] = useState({ key: '', set: null });
  /* Read for the company on screen only: another company's answer is no answer. */
  const granted = grants.key === tenantKey ? grants.set : null;
  useEffect(() => {
    if (!tenantKey) return undefined;
    let off = false;
    Promise.resolve()
      .then(getMyPermissions)
      .then((d) => !off && setGrants({ key: tenantKey, set: new Set(Array.isArray(d?.permissions) ? d.permissions : []), teamOnly: Boolean(d?.ownDocumentsOnly) && !d?.isAdmin }))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [tenantKey]);
  /*
   * Which app is open, derived rather than stored.
   *
   * What is stored is the app somebody chose; which one is *open* is that
   * choice where this company has it, and the landing app where it does not.
   * Written as an effect that corrected the stored value, a company switch
   * drew one frame of a rail belonging to an app the new company has not
   * bought — and an app with no landing app corrected itself forever.
   */
  /* On an app's own address, that app; elsewhere nothing chosen yet. */
  /* Where the address does not name the app (localhost, a preview), ?app= does, so a reload stays in it. */
  const [chosenAppId, setChosenAppId] = useState(() => {
    const fromHost = appFromHost();
    if (fromHost) return fromHost;
    try {
      const asked = new URLSearchParams(window.location.search).get('app');
      if (asked) return asked;
    } catch { /* no query */ }
    /* The app a new visitor came for (clor.in › Start with …), kept across sign-up. */
    const intended = appIntent();
    if (intended) return intended;
    /* The front door is the company's own workspace, not a doorway into the last app (ADR-010). */
    return isFrontDoor() ? ADMIN_APP_ID : null;
  });
  /* Asked for an app this company has inside another (Attendance, on People): the app it is inside. */
  const chosenLanding = chosenAppId ? landingFor({ app: chosenAppId }, subscriptions || [], { all: listAll }) : null;
  const wantedAppId = chosenLanding?.moved ? chosenLanding.app : chosenAppId;
  const activeAppId = mine.some((a) => a.id === wantedAppId)
    ? wantedAppId
    : landingApp(subscriptions || [], { all: listAll })?.id || null;
  /*
   * Access no role gives: an app may name keys its own server grants this
   * person (`access()`, e.g. People's live auditor grant or a seat on a case
   * committee), which its nav items list like permissions. Null until read.
   */
  const accessKey = tenantKey && activeAppId ? `${tenantKey}|${activeAppId}` : '';
  const [appAccess, setAppAccess] = useState({ key: '', set: null });
  const extraAccess = appAccess.key === accessKey ? appAccess.set : null;
  useEffect(() => {
    const load = accessKey ? appById(activeAppId)?.access : null;
    if (!load) return undefined;
    let off = false;
    Promise.resolve()
      .then(load)
      .then((keys) => !off && setAppAccess({ key: accessKey, set: new Set(Array.isArray(keys) ? keys : []) }))
      .catch(() => !off && setAppAccess({ key: accessKey, set: new Set() }));
    return () => {
      off = true;
    };
  }, [accessKey, activeAppId]);
  /* Arriving on an app's own host with ?open=<screen> (a notification followed across apps): land there. */
  const [screenKey, setScreenKey] = useState(() => {
    try {
      const open = String(new URLSearchParams(window.location.search).get('open') || '').trim();
      return open || null;
    } catch {
      return null;
    }
  });
  /* W-2.2: the screen the address asked for when the page opened — a key no app has is a "not found", not a silent home. */
  const [openedWith] = useState(() => {
    try {
      return String(new URLSearchParams(window.location.search).get('open') || '').trim();
    } catch {
      return '';
    }
  });
  const [browseModule, setBrowseModule] = useState(null);
  /* Filters a screen was opened with (a report row or an exception opening Records for one person and day). */
  const [screenParams, setScreenParamsState] = useState(() => {
    try { return readScreenSearch(window.location.search).params; } catch { return null; }
  });
  /*
   * What the screen shows now (D-V7): the params it was opened with, as it
   * changes them through `updateParams` (a tab, a filter) without remounting.
   * Opening a screen sets both; Back sets both from the address.
   */
  const [liveParams, setLiveParams] = useState(() => screenParams);
  const liveParamsRef = useRef(liveParams);
  useEffect(() => { liveParamsRef.current = liveParams; });
  const setScreenParams = (next) => {
    setScreenParamsState(next);
    setLiveParams(next);
  };
  /* Switching company (spec v1 §5.1): the record, tab and filters were the last company's; drop them. */
  const [paramsTenant, setParamsTenant] = useState(tenant?.id || null);
  if ((tenant?.id || null) !== paramsTenant) {
    if (paramsTenant && tenant?.id) {
      setScreenParamsState(null);
      setLiveParams(null);
    }
    setParamsTenant(tenant?.id || null);
  }
  /* The screens panel beside the rail can be closed on a desktop; the choice
     is a per-browser convenience, so it survives a reload but nothing else. */
  const [panelClosed, setPanelClosed] = useState(() => {
    try { return window.localStorage.getItem('clor.splitPanel') === 'closed'; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem('clor.splitPanel', panelClosed ? 'closed' : 'open'); } catch { /* storage blocked */ }
  }, [panelClosed]);
  /* Counts beside rail entries (manifest `railCounts`: { moduleKey: n }), fetched again on each screen change so an
     answered request leaves the count. A failed load shows none. */
  const [railLoad, setRailLoad] = useState({ key: '', counts: {} });
  const railKey = `${activeAppId || ''}|${tenant?.id || ''}`;
  useEffect(() => {
    const load = tenant?.id ? appById(activeAppId)?.railCounts : null;
    if (!load) return undefined;
    let live = true;
    load().then((c) => { if (live) setRailLoad({ key: railKey, counts: c || {} }); }).catch(() => { if (live) setRailLoad({ key: railKey, counts: {} }); });
    return () => { live = false; };
  }, [activeAppId, tenant?.id, screenKey, railKey]);
  /* Counts from another app or company are never shown while the new ones load. */
  const railCounts = railLoad.key === railKey ? railLoad.counts : {};
  /* Counts beside second-panel items (manifest `panelCounts`: { screenKey: n }), e.g. "Members 14" (R&D shell). Same rules as the rail's. */
  const [panelLoad, setPanelLoad] = useState({ key: '', counts: {} });
  useEffect(() => {
    const load = tenant?.id ? appById(activeAppId)?.panelCounts : null;
    if (!load) return undefined;
    let live = true;
    load({ tenant }).then((c) => { if (live) setPanelLoad({ key: railKey, counts: c || {} }); }).catch(() => { if (live) setPanelLoad({ key: railKey, counts: {} }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tenant is read through railKey
  }, [activeAppId, tenant?.id, screenKey, railKey]);
  const panelCounts = panelLoad.key === railKey ? panelLoad.counts : {};
  /* A page the platform owns rather than the app (My profile), shown in an
     app's main area. Only for apps that use the shell's menu: an app that
     draws its own (Accounting) has its own profile entry. */
  const [platformScreen, setPlatformScreen] = useState(null);
  /*
   * ⌘K / Ctrl+K: jump to any screen of the open app, another app, or My
   * profile (UX-03). Accounting draws itself and has its own palette, so the
   * shell's stays out of its way.
   */
  const [paletteOpen, setPaletteOpen] = useState(false);
  /* The bar's search starts where the page's own content starts, just past the
     module panel's edge (owner, 28 Oct 2026), and follows it as the panel opens
     and closes or the window changes. */
  const searchRef = useRef(null);
  useEffect(() => watchWideTables(document.body), []);
  useLayoutEffect(() => {
    const search = searchRef.current;
    const main = document.getElementById('main-content');
    if (!search || !main || typeof ResizeObserver === 'undefined') return undefined;
    const place = () => {
      search.style.marginLeft = '';
      const pad = parseFloat(getComputedStyle(main).paddingLeft) || 0;
      const target = main.getBoundingClientRect().left + pad;
      const gap = target - search.getBoundingClientRect().left;
      if (gap > 12) search.style.marginLeft = `${12 + gap}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(main);
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('resize', place); };
  });
  const paletteAppRef = useRef('');
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      if (appById(paletteAppRef.current)?.Root) return;
      e.preventDefault();
      setPaletteOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  /* Closes on a click anywhere else, and on Escape. It did neither: the only
     way out of the app switcher was to click the app switcher again. */
  const switcherRef = useDismissable(switcherOpen, () => setSwitcherOpen(false));
  const [showMoreApps, setShowMoreApps] = useState(false);
  /* A phone with no app menu in the bar (the Workspace, a screen outside any app) chooses its company here. */
  const [companyOpen, setCompanyOpen] = useState(false);
  const companyRef = useDismissable(companyOpen, () => setCompanyOpen(false));

  /* `open` names a screen inside the app (Accounting's settings): carried in the address so it survives the hop to the app's own host. */
  /* `params` travel with it in the address too (Workspace's permissions opened for one app: ?for=payroll). */
  const openApp = (...args) => { confirmLeave(askLeave).then((ok) => ok && openAppNow(...args)); };
  const pickCompany = (id) => { if (id !== tenant.id) confirmLeave(askLeave).then((ok) => ok && setTenantId(id)); };
  const openAppNow = (askedId, askedOpen = '', params = {}) => {
    /* A link into Attendance (a notice, another app's button) opens the same screen in People for a company on People. */
    const { app: id, screen: open } = landingFor({ app: askedId, screen: askedOpen }, subscriptions || [], { all: listAll });
    const next = appById(id);
    const query = new URLSearchParams();
    if (open) query.set('open', open);
    for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') query.set(k, String(v));
    const search = query.toString() ? `?${query}` : '';
    /* An app with its own address opens there, so the address bar says which
       app this is. The session follows through the API's refresh cookie. */
    const host = hostForApp(id);
    if (host && host !== window.location.hostname) {
      /* With the company in the path (A-25): browser storage is per address,
         so without it the other host opened whichever company it saw last. */
      window.location.assign(appAddress({ protocol: window.location.protocol, host, code: tenant?.code || '', search }));
      return;
    }
    /* Always: the last app's ?open= and #/screen are not this app's screen. A
       hash left behind (Accounting's #/settingsUsers) would send whoever comes
       back to Accounting straight to where they had just been redirected from. */
    window.history.replaceState(null, '', `${window.location.pathname}${search}`);
    setChosenAppId(id);
    /* A shell app's screen named outright (a notification's link); Accounting reads the address itself. */
    setScreenKey(open && next?.screens?.[open] ? open : next?.home || null);
    /* The link's params open that screen on its one thing (a notice about one candidate); otherwise none, never the last screen's. */
    setScreenParams(paramsForOpen(next, open, params));
    setPlatformScreen(null);
    setSwitcherOpen(false);
    setShowMoreApps(false);
  };


  /* An app asking to open another (requestOpenApp in @platform/context): it does not own the shell, so it asks. */
  const openAppRef = useRef(openApp);
  useEffect(() => {
    openAppRef.current = openApp;
  });
  useEffect(() => {
    const onOpen = (e) => openAppRef.current(e.detail?.appId, e.detail?.screen || '', e.detail?.params || {});
    window.addEventListener(OPEN_APP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_APP_EVENT, onOpen);
  }, []);
  /* Where each screen was opened from (owner, 29 Oct 2026): a Settings page opened from Leave balances or an
     employee's record goes back there, not to the Settings hub. Kept per screen, for the visit in hand. */
  const [cameFrom, setCameFrom] = useState({});
  /* `link`: opened by a link on the page being read (a figure on Home, a name in a list), not from the menu. Back
     then returns to that page, whichever module it is in (owner, 11 Nov 2026); a menu click starts afresh. */
  const noteOrigin = (next, link = false) => {
    if (!next || next === screenKeyRef.current) return;
    const from = screenKeyRef.current;
    setCameFrom((m) => ({ ...m, [next]: from ? { key: from, params: liveParamsRef.current || null, link } : null }));
  };
  const goTo = (key, params, link = false) => { confirmLeave(askLeave).then((ok) => ok && goToNow(key, params, link)); };
  /* `params` open the screen on one thing (a notice about one candidate); a rail click passes none. */
  const goToNow = (key, params = null, link = false) => {
    noteOrigin(key, link);
    setScreenKey(key);
    setScreenParams(params && typeof params === 'object' ? params : null);
    setPlatformScreen(null);
    setShowMoreApps(false);
    setNavOpen(false);
    setBrowseModule(null);
    setTabletPanel(false);
    /* A new screen starts at its top, not at the last one's scroll position. */
    window.scrollTo(0, 0);
  };
  /* Help (requestOpenHelp): the Help centre as a platform page, on the topic asked for. */
  const [helpTopic, setHelpTopic] = useState('welcome');
  useEffect(() => {
    const onHelp = (e) => {
      setHelpTopic(e.detail?.topic || 'welcome');
      setPlatformScreen('help');
      setShowMoreApps(false);
      setNavOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener(OPEN_HELP_EVENT, onHelp);
    return () => window.removeEventListener(OPEN_HELP_EVENT, onHelp);
  }, []);
  /* Signed in, the sign-in and sign-up addresses have done their job: drop them, keeping the company and the query. */
  useEffect(() => {
    if (!user) return;
    try {
      const { pathname, search, hash } = window.location;
      const trimmed = pathname.replace(/\/(signin|signup|get-started|forgot-password)\/?$/, '/');
      if (trimmed !== pathname) window.history.replaceState(null, '', trimmed + search + hash);
    } catch {
      /* best effort */
    }
  }, [user]);

  /* W-8.2: the account is suspended by CLOR — one plain page instead of a half-loaded app. */
  const [suspended, setSuspended] = useState('');
  useEffect(() => {
    const on = (e) => setSuspended(e.detail?.message || 'This account has been suspended by CLOR.');
    window.addEventListener('clor:account-suspended', on);
    return () => window.removeEventListener('clor:account-suspended', on);
  }, []);

  /* A screen asking for another of its own app's screens (requestOpenScreen): the same as a rail click. */
  const goToRef = useRef(null);
  useEffect(() => {
    goToRef.current = goTo;
  });
  useEffect(() => {
    const onScreen = (e) => {
      if (e.detail?.screen) goToRef.current?.(e.detail.screen, e.detail.params || null, true);
    };
    window.addEventListener(OPEN_SCREEN_EVENT, onScreen);
    return () => window.removeEventListener(OPEN_SCREEN_EVENT, onScreen);
  }, []);
  /* Explore: the sample company refused a change. The same sentence as the bar, as a toast, whichever screen tried. */
  useEffect(() => {
    const on = () => notify.info(EXPLORE_READ_ONLY_TEXT);
    window.addEventListener('clor:explore-read-only', on);
    return () => window.removeEventListener('clor:explore-read-only', on);
  }, []);
  /* The API refused an app this account has not bought (402): say so once, with the way to add it. */
  const [unbought, setUnbought] = useState(null);
  useEffect(() => {
    const on = (e) => setUnbought({ app: e.detail?.app || null, message: e.detail?.message || '' });
    window.addEventListener('clor:app-not-subscribed', on);
    return () => window.removeEventListener('clor:app-not-subscribed', on);
  }, []);

  /*
   * What an unauthenticated visitor is looking at: the public page, or one of
   * the two doors off it. Three states rather than a router, because they are
   * the only three there are — everything past sign-in is an app's business.
   */
  const [publicPage, setPublicPageState] = useState(publicPageFromPath);
  /* Explore's link, latched on the way in: a signed-in session's company code may join the address a moment later. */
  const [exploreLink] = useState(() => isExplorePath());
  /* Start a free trial (/start, from clor.in's pricing page), latched the same way. */
  const [startLink] = useState(() => isStartPath());
  /* W-3: app.clor.in/invite?token=... — read once; the page itself never puts the token anywhere else. */
  const [inviteToken, setInviteToken] = useState(() => {
    try {
      return window.location.pathname.replace(/\/+$/, '') === '/invite' ? String(new URLSearchParams(window.location.search).get('token') || '') : '';
    } catch {
      return '';
    }
  });
  /* The page is in the address (/signin, /signup), so clor.in's buttons can open the right one and a refresh keeps it. */
  const setPublicPage = (page) => {
    setPublicPageState(page);
    try {
      const path = PUBLIC_PATHS[page];
      if (path && window.location.pathname !== path) window.history.replaceState(null, '', path + window.location.hash);
    } catch {
      /* best effort */
    }
  };

  /* A policy page is open to everyone, signed in or not, at #/legal/<doc>. */
  const legalDoc = useLegalRoute();
  /* An app's page for people without a CLOR user (the employee portal, #/portal). */
  const appPublicPage = usePublicPage();

  /*
   * Links in CLOR's emails: `/?reset=<token>` and `/?verify=<token>`. Read once
   * on load; leaving either screen strips the token from the address bar so a
   * reload or a shared screenshot does not carry it.
   */
  const [emailLink, setEmailLink] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      /* Emails sent before 12 Oct 2026 used /verify-email?token= and /?token=. */
      const legacy = String(q.get('token') || '').trim();
      const onVerifyPath = /\/verify-email\/?$/.test(window.location.pathname);
      /* W-3: an invitation carries ?token= too; it is not an old reset link. */
      if (/\/invite\/?$/.test(window.location.pathname)) return null;
      const reset = String(q.get('reset') || '').trim() || (!onVerifyPath ? legacy : '');
      const verify = String(q.get('verify') || '').trim() || (onVerifyPath ? legacy : '');
      if (reset) return { kind: 'reset', token: reset };
      if (verify) return { kind: 'verify', token: verify };
    } catch {
      /* no usable address: nothing to handle */
    }
    return null;
  });
  const leaveEmailLink = (nextPage) => {
    try {
      window.history.replaceState(null, '', '/' + window.location.hash);
    } catch {
      /* best effort */
    }
    setEmailLink(null);
    if (nextPage) setPublicPage(nextPage);
  };

  /* The bar's height, published page-wide: drawers and dialogs render at the
     top of the document (portals), outside the element that sets it, and
     start below the bar rather than under it. */
  useEffect(() => {
    document.documentElement.style.setProperty('--platform-bar', phone ? '3.5rem' : '4rem');
    return () => document.documentElement.style.removeProperty('--platform-bar');
  }, [phone]);

  /* The open app on <html> too, for the same reason: a drawer for a People
     record is drawn outside the shell's element and should wear People's
     palette (index.css, [data-app]). */
  useEffect(() => {
    paletteAppRef.current = activeAppId || '';
    if (activeAppId) document.documentElement.setAttribute('data-app', activeAppId);
    else document.documentElement.removeAttribute('data-app');
    return () => document.documentElement.removeAttribute('data-app');
  }, [activeAppId]);

  /* The browser tab shows the open app: People wears the new mark (brand kit,
     28 Oct 2026); every other app the CLOR icon index.html starts with. */
  useEffect(() => {
    const icon = document.querySelector('link[rel="icon"]');
    if (!icon) return undefined;
    const was = { href: icon.getAttribute('href'), type: icon.getAttribute('type') };
    if (activeAppId === 'people') { icon.setAttribute('type', 'image/svg+xml'); icon.setAttribute('href', '/icons/people.svg'); }
    return () => { icon.setAttribute('href', was.href); icon.setAttribute('type', was.type); };
  }, [activeAppId]);

  /* The shared palette the open app has chosen (`palette` in its manifest,
     e.g. 'blaze'), on <html> for the same reason. An app without one keeps
     the platform's colours. */
  const activePalette = appById(activeAppId)?.palette || '';
  useEffect(() => {
    if (activePalette) document.documentElement.setAttribute('data-palette', activePalette);
    else document.documentElement.removeAttribute('data-palette');
    return () => document.documentElement.removeAttribute('data-palette');
  }, [activePalette]);

  /*
   * The screen in the address bar, so a reload, a shared link and the
   * browser's back and forward buttons all land on the same screen. Shell
   * apps only: an app that draws itself (Accounting) owns its own address.
   * `?open=` is the name notifications already use to link into a screen.
   */
  const fromHistory = useRef(false);
  /* The address this screen last stood at, to return to when Back would drop unsaved edits. */
  const lastUrlRef = useRef(typeof window !== 'undefined' ? window.location.href : '');
  const screenKeyRef = useRef(screenKey);
  const activeAppIdRef = useRef(activeAppId);
  useEffect(() => { screenKeyRef.current = screenKey; activeAppIdRef.current = activeAppId; }, [screenKey, activeAppId]);
  const urlReady = useRef(false);
  const ownsAddress = Boolean(user && tenant && activeAppId && !appById(activeAppId)?.Root);
  useEffect(() => {
    if (!ownsAddress) return;
    const appInHost = Boolean(appFromHost());
    const was = readScreenSearch(window.location.search);
    const current = was.open;
    const appChanged = !appInHost && was.app !== activeAppId;
    const search = screenSearch(window.location.search, { app: activeAppId, open: screenKey, appInHost, params: liveParams });
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    const sameParams = JSON.stringify(was.params || null) === JSON.stringify(liveParams || null);
    if (fromHistory.current || (!appChanged && current === (screenKey || null) && sameParams)) {
      fromHistory.current = false;
      urlReady.current = true;
      lastUrlRef.current = window.location.href;
      return;
    }
    if (urlReady.current) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    urlReady.current = true;
    lastUrlRef.current = window.location.href;
  }, [screenKey, ownsAddress, activeAppId, liveParams]);
  useEffect(() => {
    if (!ownsAddress) return undefined;
    const onPop = () => {
      const { open, app: appInUrl, params } = readScreenSearch(window.location.search);
      fromHistory.current = true;
      if (appInUrl && !appFromHost()) setChosenAppId(appInUrl);
      /* Back within the same screen (a wizard step, a record tab) changes its state in place; what was typed stays. */
      if (open && open === screenKeyRef.current && (!appInUrl || appInUrl === activeAppIdRef.current)) {
        setLiveParams(params);
        return;
      }
      /* Back would leave a screen with unsaved edits: stay, ask, and only then go back for real. */
      if (hasUnsaved() && lastUrlRef.current) {
        fromHistory.current = false;
        window.history.pushState(null, '', lastUrlRef.current);
        askLeave().then((ok) => { if (ok) { clearUnsaved(); window.history.back(); } });
        return;
      }
      setScreenParams(params);
      setScreenKey(open);
      setPlatformScreen(null);
      setShowMoreApps(false);
      setBrowseModule(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [ownsAddress]);

  /* Signed in at the front door (app.clor.in): go on to the app's own address,
     keeping the company, any ?open= and #/screen so a link into an app still
     lands on that company's screen (A-25: it kept only the #/screen). */
  const frontDoorHost = user && tenant && !emailLink && isFrontDoor() && activeAppId ? hostForApp(activeAppId) : null;
  /* Workspace lives here: its host is this one, and forwarding to it would loop. */
  const frontDoorTarget = frontDoorHost && frontDoorHost !== window.location.hostname ? frontDoorHost : null;
  /*
   * An address for an app this company has inside another (attendance.clor.in,
   * for a company on People): on to the same screen in that app, never a dead
   * end. Not the employee portal (#/portal), which is a public page of its own.
   * Known only once the company's apps are read.
   */
  const includedTarget =
    user && tenant && subscriptions && !emailLink && !legalDoc && !exploreLink && !appPublicPage
      ? includedForward(window.location, subscriptions, { code: tenant.code || '', all: listAll })
      : null;
  useEffect(() => {
    if (includedTarget) window.location.replace(includedTarget);
  }, [includedTarget]);
  /* Where apps have no addresses of their own (localhost, the phone app), the same move in place. */
  useEffect(() => {
    if (!user || !tenant || !subscriptions || includedTarget || !chosenAppId) return undefined;
    const to = landingFor({ app: chosenAppId, screen: screenKey || '' }, subscriptions, { all: listAll });
    if (!to.moved) return undefined;
    let off = false;
    Promise.resolve().then(() => {
      if (off) return;
      setChosenAppId(to.app);
      setScreenKey(to.screen || null);
    });
    return () => {
      off = true;
    };
  }, [user, tenant, subscriptions, includedTarget, chosenAppId, screenKey, listAll]);
  useEffect(() => {
    if (!frontDoorTarget || includedTarget) return;
    const { protocol, pathname, search, hash } = window.location;
    window.location.replace(frontDoorForward({ protocol, host: frontDoorTarget, pathname, search, hash, code: tenant?.code || '' }));
  }, [frontDoorTarget, includedTarget, tenant?.code]);

  /*
   * A token in this browser is checked before anything is drawn.
   *
   * Without this the public page appears for a moment on every reload — an
   * advertisement shown to somebody who is already a customer, four times a
   * day.
   */
  if (legalDoc) return <LegalPage doc={legalDoc} />;
  /* Explore: the link from a demo request opens the sample company (Explore.jsx). */
  if (exploreLink) {
    return (
      <ExploreLanding
        demoUrl={DEMO_URL}
        restoring={restoring}
        signedIn={user && !explore ? { company: tenant?.name || '', name: user.fullName || user.email || '' } : null}
        signOut={signOut}
      />
    );
  }
  if (appPublicPage) {
    return (
      <>
        <Suspense fallback={<AppLoading />}>{renderPublicPage(appPublicPage)}</Suspense>
        <Toaster />
      </>
    );
  }

  if (restoring) {
    return (
      <div className="min-h-dvh grid place-items-center" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
        <ClorMark size={40} />
      </div>
    );
  }

  /* A free trial from clor.in: the email step, or the setup step the mailed link opens (Start.jsx), signed in or not. */
  if (startLink) {
    return (
      <Start
        onHome={() => window.location.assign(MARKETING_URL)}
        onSignIn={() => window.location.assign('/signin')}
        signedIn={user && !explore ? { name: user.fullName || user.email || '' } : null}
        signOut={signOut}
      />
    );
  }

  /* W-3: an invitation link opens its own page, signed in or not. */
  if (inviteToken) {
    return (
      <InviteAccept
        token={inviteToken}
        onHome={() => window.location.assign(MARKETING_URL)}
        onSignIn={() => {
          setInviteToken('');
          setPublicPage('signin');
        }}
      />
    );
  }

  if (emailLink?.kind === 'verify') {
    return <VerifyEmail token={emailLink.token} onDone={() => leaveEmailLink(user ? null : 'signin')} />;
  }
  if (emailLink?.kind === 'reset') {
    /* A successful reset ends every session, this browser's included. */
    return (
      <ResetPassword
        token={emailLink.token}
        onDone={() => {
          leaveEmailLink('signin');
          if (user) window.location.replace('/');
        }}
      />
    );
  }

  if (!user && exploreEnded) return <ExploreEnded demoUrl={DEMO_URL} />;
  if (!user) {
    /* The product's front page is clor.in now; the app opens on its doors. */
    const toSite = () => window.location.assign(MARKETING_URL);
    if (publicPage === 'signup') {
      return <SignUp onHome={toSite} onSignIn={() => setPublicPage('signin')} />;
    }
    if (publicPage === 'forgot') {
      return <ForgotPassword onHome={toSite} onSignIn={() => setPublicPage('signin')} />;
    }
    return <SignIn onHome={toSite} onSignUp={() => setPublicPage('signup')} onForgot={() => setPublicPage('forgot')} />;
  }

  /*
   * Signed in, with nothing to be signed in to.
   *
   * This used to fall through to the marketing page, which is why sign-up had
   * to create a company: without one the account it made vanished behind the
   * front door. It is a real state — a new account before its first company,
   * and an account whose last company was removed — so it gets a real screen.
   */
  /* The address names a company this person cannot open (A-26): say so; open nothing else. */
  if (suspended && user) {
    return (
      <div className="min-h-dvh grid place-items-center p-6" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
        <section className="ui-card p-8 max-w-lg grid gap-4" role="alert" aria-labelledby="suspended-title">
          <ClorLogo size={24} />
          <h1 id="suspended-title" className="ui-display text-2xl">This account is suspended</h1>
          <p className="ui-muted">{suspended}</p>
          <p className="ui-muted text-sm">Your data is kept as it was. Once CLOR reinstates the account, everything opens again.</p>
          <div className="flex flex-wrap gap-2">
            <a className="ui-btn ui-btn-primary" href="mailto:support@clor.in">Contact support</a>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={signOut}>Sign out</button>
          </div>
        </section>
      </div>
    );
  }
  if (deniedCode) return <NoCompanyAccess />;
  /* The new company opens in the app picked on its setup, not the workspace or the first in the list. */
  if (!tenant) return <CompanySetup onLanding={setChosenAppId} />;

  const app = appById(activeAppId);
  /* Items whose `permission` this person lacks go, and those of a module the company switched off (`feature`), then a settings page left with nothing on it, then any section heading left with nothing under it. */
  const switchedOn = (item) => !item.feature || !tenant?.features || tenant.features[item.feature] !== false;
  const holds = (p) => holdsPermission(p, granted, extraAccess);
  /* `wholeCompany`: a screen of company-wide figures, which a team-only role (a Team Manager) is refused by the server; not offered to it. */
  const teamOnly = grants.key === tenantKey && Boolean(grants.teamOnly);
  const allowed = withoutEmptyHubs((app?.nav || []).filter((item) => item.section || (holds(item.permission) && switchedOn(item) && !(item.wholeCompany && teamOnly))));
  const nav = allowed.filter((item, i) => !item.section || (allowed[i + 1] && !allowed[i + 1].section));
  /* A screen the open app does not have is not a screen: the same company
     switch that changes the app leaves last app's screen key behind, and
     honouring it shows "Nothing selected" instead of the new app's home. */
  /* Home, or the first screen this person may open when Home is not theirs (an employee, an outside auditor). */
  const landing = landingScreen(app, nav);
  const screen = (screenKey && app?.screens?.[screenKey] && screenKey !== app?.home ? screenKey : landing) || null;
  const Screen = app?.screens?.[screen] || null;
  /*
   * W-2.2: say why a screen is not shown instead of a blank or a wall of
   * refused requests. Denied: the screen's permission is not this person's
   * (the server refuses it too; this is the explanation). Not found: the
   * address the page opened with names a screen this app does not have.
   */
  const screenItem = (app?.nav || []).find((n) => n.key === screen);
  /* An app whose own access is still being read is not refused yet. */
  const screenDenied = Boolean(screenItem?.permission && !holds(screenItem.permission) && (extraAccess || !app?.access));
  /* An app may draw its own navigation instead of handing the shell a list. */
  const Root = app?.Root || null;
  const screenMissing = Boolean(!Root && app && openedWith && screenKey === openedWith && !app.screens?.[openedWith] && !chosenLanding?.moved);
  /* Or ask for the split sidebar: modules on a rail, the open module's screens beside it (splitNav.js). */
  const modules = resolveModules(app, nav);
  /* What the rail counts as waiting, in all, and the screen the first counted module opens: the bell says the same number. */
  const waitingOnRail = (() => {
    const count = modules.reduce((n, m) => n + (Number(railCounts[m.key]) || 0), 0);
    /* The module that carries the count, or the one that would if anything waited: with nought the bell still says so. */
    const first = modules.find((m) => railCounts[m.key] > 0) || modules.find((m) => m.key in railCounts);
    return { count, screen: first?.items?.[0] || first?.key || null };
  })();
  const split = modules.length > 0;
  const currentModule = moduleForScreen(modules, screen, nav) || modules[0] || null;
  /* The module whose panel is open; follows the screen unless the person is browsing another on the rail. */
  const openModule =
    (browseModule && modules.find((m) => m.key === browseModule)) ||
    /* In the phone sheet a single-screen module has nothing to list, so the sheet opens on the first module that has. */
    (phone && currentModule?.single ? modules.find((m) => !m.single) || currentModule : currentModule);

  const isCurrent = (key) => screen === key && !platformScreen && !showMoreApps;

  /* The rail of modules. On a desktop a tap opens the module's first screen; in the phone sheet it only
     switches the panel, so the person can pick a screen before the sheet closes (ClorTime's drawer). */
  const moduleRail = (
    <nav className="ui-split-rail" data-app={app?.id || undefined} aria-label={`${app?.name || ''} modules`}>
      {/* The CLOR symbol tile heads the rail on a desktop (R&D shell, 14 Nov 2026); the bar's logo steps aside. */}
      {!phone ? (
        <button type="button" className="ui-split-brand" aria-label="CLOR home" title="CLOR" onClick={() => openApp(mine[0]?.id)}>
          <ClorMark size={32} />
        </button>
      ) : null}
      {modules.map((m) => {
        const Icon = m.icon;
        /* Two different facts: which module holds the screen you are on, and
           which module's panel is open. A rail tap only opens a panel; it
           does not change the screen under you. */
        /* A platform page (My profile) or More apps belongs to no module. */
        const current = !platformScreen && !showMoreApps && currentModule?.key === m.key;
        const panelShown = !m.single && openModule?.key === m.key && (phone || (tablet ? tabletPanel : !panelClosed));
        return (
          <button
            key={m.key}
            type="button"
            className="ui-split-mod"
            aria-pressed={m.single ? current : panelShown}
            aria-current={current ? 'true' : undefined}
            aria-expanded={m.single ? undefined : panelShown}
            data-current={current || undefined}
            title={m.label}
            onClick={() => {
              const action = railAction({ single: m.single, phone, panelShown, opensHome: Boolean(app?.railOpensHome), current });
              if (action === 'go') goTo(m.home);
              else if (action === 'goOpen') {
                /* W-R3: the module's landing page and its panel together; the screen follows the rail. */
                goTo(m.home);
                if (tablet) setTabletPanel(true);
                else setPanelClosed(false);
              }
              else if (action === 'close') { if (tablet) setTabletPanel(false); else setPanelClosed(true); }
              else {
                setBrowseModule(phone || m.key !== currentModule?.key ? m.key : null);
                if (tablet) setTabletPanel(true); else setPanelClosed(false);
              }
            }}
          >
            {Icon ? <Icon size={20} aria-hidden="true" /> : null}
            {/* The rail is narrow: a module may give it a shorter name; the panel and the tooltip keep the full one. */}
            <span>{m.short || m.label}</span>
            {railCounts[m.key] > 0 ? <span className="ui-split-mod-count tabular-nums" aria-label={`${railCounts[m.key]} waiting`}>{railCounts[m.key] > 99 ? '99+' : railCounts[m.key]}</span> : null}
          </button>
        );
      })}
      {/* More apps sits on the rail, under the modules, where every app's last stop is (owner, 28 Oct 2026). The phone sheet keeps its own. */}
      {!phone && app?.id !== ADMIN_APP_ID ? (
        <button
          type="button"
          className="ui-split-mod"
          data-more=""
          data-current={showMoreApps || undefined}
          aria-current={showMoreApps ? 'true' : undefined}
          title="More apps"
          onClick={() => { setShowMoreApps(true); setNavOpen(false); }}
        >
          <LayoutGrid size={20} aria-hidden="true" />
          <span>More apps</span>
        </button>
      ) : null}
      {/* An app may use the rail's foot (manifest `railFoot`): its own item, then Help, which then leaves the bar. */}
      {app?.railFoot && !phone ? (
        <div className="ui-split-rail-foot">
          {app.railFoot.Component ? <app.railFoot.Component tenant={tenant} goTo={goTo} screen={screen} /> : null}
          <HelpMenu variant="rail" icon={app.railFoot.helpIcon} />
        </div>
      ) : null}
    </nav>
  );
  /* The open module's screens under plain headings; a single-screen module has no panel. */
  const modulePanel = openModule && !openModule.single && (phone || (tablet ? tabletPanel : !panelClosed)) ? (
    <nav className="ui-split-panel" aria-label={`${openModule.label} screens`}>
      <div className="ui-split-panel-head">
        <span className="ui-t-sec">{openModule.label}</span>
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={phone ? 'Close menu' : `Close ${openModule.label} menu`}
          title="Close"
          onClick={() => {
            if (phone) setNavOpen(false);
            else if (tablet) { setTabletPanel(false); setBrowseModule(null); }
            else { setPanelClosed(true); setBrowseModule(null); }
          }}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {openModule.groups.map((g, gi) => (
        <div key={g.label || gi} className={gi ? 'mt-4' : ''}>
          {g.label ? <p className="ui-caption px-2 pb-1">{g.label}</p> : null}
          {g.items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="ui-split-item"
              aria-current={isCurrent(item.key) ? 'page' : undefined}
              onClick={() => goTo(item.key)}
            >
              {item.icon ? <item.icon size={20} aria-hidden="true" /> : null}
              <span className="min-w-0 truncate">{item.label}</span>
              {Number(panelCounts[item.key]) >= 0 && panelCounts[item.key] != null ? <span className="ui-split-item-count">{panelCounts[item.key]}</span> : null}
            </button>
          ))}
        </div>
      ))}
      {/* The Workspace lists the apps on its Overview and the switcher has More apps; its own panel is administration only. */}
      {app?.id === ADMIN_APP_ID || !phone ? null : (
        <div style={{ borderTop: '1px solid rgb(var(--border))' }} className="mt-4 pt-3">
          <button type="button" className="ui-split-item" onClick={() => { setShowMoreApps(true); setNavOpen(false); }}>
            <LayoutGrid size={20} aria-hidden="true" />
            More apps
          </button>
        </div>
      )}
    </nav>
  ) : null;

  const navItems = (
    <>
          {nav.map((item) =>
            /* `{ section: 'Settings' }` starts a group: setup apart from daily work. */
            item.section ? (
              <p key={`section:${item.section}`} className="ui-caption px-2 pt-4 pb-1">
                {item.section}
              </p>
            ) : (
            <button
              key={item.key}
              type="button"
              className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ui-hover-sunken"
              style={
                screen === item.key && !platformScreen
                  ? { backgroundColor: 'rgb(var(--surface-sunken))', fontWeight: 500 }
                  : undefined
              }
              aria-current={screen === item.key && !platformScreen ? 'page' : undefined}
              onClick={() => {
                setScreenKey(item.key);
                setPlatformScreen(null);
                setShowMoreApps(false);
                setNavOpen(false);
                /* A new screen starts at its top, not at the last one's scroll position. */
                window.scrollTo(0, 0);
              }}
            >
              {item.icon ? <item.icon size={16} aria-hidden="true" /> : null}
              {item.label}
            </button>
            )
          )}

          <div style={{ borderTop: '1px solid rgb(var(--border))' }} className="!mt-3 pt-3">
            <button
              type="button"
              className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ui-hover-sunken"
              onClick={() => {
                setShowMoreApps(true);
                setNavOpen(false);
              }}
            >
              <LayoutGrid size={16} aria-hidden="true" />
              More apps
            </button>
          </div>
    </>
  );
  const tabs = phone && app ? mobileTabsFor(app, nav) : [];
  const inWorkspace = app?.id === ADMIN_APP_ID;

  return (
    /* The open app's icon set (`iconSet` in its manifest): shared marks such as
       the page-header icon draw in it. No icon set, the line icons as before. */
    <IconSetContext.Provider value={app ? app.iconSet || 'line' : 'duo'}>
    <LineSetContext.Provider value={app ? app.lineIcons || 'lucide' : 'fluent'}>
      <div
        className="ui-min-h-viewport"
        /* Which app is open, for styling: People, Attendance and Payroll wear the
           HR palette (index.css, [data-app]); Accounting keeps its own. */
        data-app={activeAppId || undefined}
        data-palette={activePalette || undefined}
        style={{ backgroundColor: 'rgb(var(--app-bg))', '--platform-bar': phone ? '3.5rem' : '4rem' }}
      >
        {/* Keyboard users skip the bar and the rail. Accounting (a Root app) carries its own. */}
        {!Root ? (
          <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 ui-btn ui-btn-primary">
            Skip to main content
          </a>
        ) : null}
        <header
          /* Tighter on a phone: the bar carries menu, logo, switcher, alerts, help, profile and sign-out in 360 px. */
          /* Narrower than 390 px (owner’s coordinator, 30 Oct 2026, said under 375; 375 itself still ran 9 px over): the CLOR mark alone, the app as its mark alone, tighter gaps; search stays. */
          className={`ui-topbar sticky top-0 flex h-14 items-center ${phone ? 'gap-1 px-1.5 max-[389px]:gap-0.5' : 'gap-3 px-4'}`}
          /* A phone bar without an app menu (the Workspace) has room for 44px buttons, DESIGN.md's touch size (#80 QA). */
          data-touch={phone && !(app && !inWorkspace) ? '' : undefined}
          style={{
            backgroundColor: 'rgb(var(--surface))',
            borderBottom: '1px solid rgb(var(--border))',
            /* Above every layer an app can draw — see --z-platform-bar. An app's
               own header is z-40 and its popovers z-60, so a bar at z-30 was
               covered by the application it contains. */
            zIndex: 'var(--z-platform-bar)',
          }}
        >
          {phone && app && !Root ? (
            <button type="button" className="ui-icon-btn" aria-label="Menu" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
              <Menu size={20} aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="ui-topbar-logo flex items-center gap-2" onClick={() => openApp(mine[0]?.id)}>
            {phone ? <ClorMark size={24} /> : <ClorLogo size={22} />}
          </button>

          {/* The app switcher. Named for the app you are in, because that is the
              question it answers before it is the control it offers. The
              Workspace leaves it out: its Overview opens the apps. */}
          {app && !inWorkspace ? (
            <div className="relative" ref={switcherRef}>
              <button
                type="button"
                className="ui-app-switch"
                /* On a phone the bar's own gap spaces it; the desktop's 1.5rem lead pushed sign-out past a 390 px screen. */
                style={phone ? { marginLeft: 0, gap: '0.25rem', paddingRight: '0.25rem' } : undefined}
                onClick={() => setSwitcherOpen((v) => !v)}
                aria-expanded={switcherOpen}
                aria-haspopup="menu"
                aria-label={`${app.name}: switch app`}
              >
                {/* The app you are in, as a mark in its own colour and its name in full weight: the first thing the bar answers. */}
                <span className="ui-app-switch-mark"><app.icon size={16} aria-hidden="true" /></span>
                {/* On a phone the name is cut short rather than pushing the bar past the screen; the full name is the button's label. */}
                <span className={`ui-app-switch-name${phone ? ' truncate max-[389px]:hidden' : ''}`} style={phone ? { maxWidth: '3.75rem' } : undefined}>{app.name}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>

              {switcherOpen ? (
                <div
                  role="menu"
                  className="absolute left-0 mt-1 w-64 rounded-xl p-1"
                  style={{
                    backgroundColor: 'rgb(var(--surface))',
                    border: '1px solid rgb(var(--border))',
                    boxShadow: 'var(--shadow-lift)',
                    zIndex: 'var(--z-platform-menu)',
                  }}
                >
                  {phone && tenants.length > 1 ? (
                    <>
                      <CompanyMenuItems groups={companyGroups(tenants, accounts)} currentId={tenant.id} onPick={(t) => { setSwitcherOpen(false); pickCompany(t.id); }} />
                      <div style={{ borderTop: '1px solid rgb(var(--border))' }} className="my-1" />
                    </>
                  ) : null}
                  {mine.filter((a) => !a.platform).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="menuitem"
                      className="w-full flex items-start gap-2 rounded-lg px-2 py-2 text-left ui-hover-sunken"
                      onClick={() => openApp(a.id)}
                    >
                      <a.icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm">{a.name}</span>
                        <span className="block ui-caption">{a.blurb}</span>
                      </span>
                    </button>
                  ))}
                  <div style={{ borderTop: '1px solid rgb(var(--border))' }} className="my-1" />
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left ui-hover-sunken"
                    onClick={() => {
                      setShowMoreApps(true);
                      setSwitcherOpen(false);
                    }}
                  >
                    <LayoutGrid size={16} aria-hidden="true" />
                    <span className="text-sm">More apps</span>
                  </button>
                  {/* Users, roles, sign-in, billing and the audit trail are the company's, not one app's: one workspace, reachable from every app (ADR-010). */}
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left ui-hover-sunken"
                    onClick={() => openApp(ADMIN_APP_ID)}
                  >
                    <Settings size={16} aria-hidden="true" />
                    <span className="text-sm">Workspace</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Global search: the command palette (⌘K), as a field anyone can see and click. */}
          {app && !Root ? (
            phone ? (
              <button type="button" className="ui-icon-btn ml-auto" aria-label="Search" onClick={() => setPaletteOpen(true)}>
                <Search size={18} aria-hidden="true" />
              </button>
            ) : (
              <button type="button" ref={searchRef} className="ui-global-search" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Meta+K Control+K">
                <Search size={16} aria-hidden="true" />
                {/* Named by its visible words; the shortcut is announced through aria-keyshortcuts, so the keycap is hidden from it. */}
                <span>{app?.searchRecords ? "Search people and screens" : "Search screens and apps"}</span>
                <kbd aria-hidden="true">{/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K'}</kbd>
              </button>
            )
          ) : null}

          {/* A phone's search button already takes the free space (ml-auto); a second spacer only adds a gap. */}
          {!phone ? <div className="flex-1" /> : null}

          {/* On a phone the bar holds menu, mark, app, profile and sign-out; one company needs no picker and the theme follows the phone. */}
          {/* The company in use. The Workspace shows it too: half its pages change only this company. */}
          {/* On a phone the company is chosen in the app menu ("People ⌄"), or, where the bar has no app menu (the Workspace),
              from a building button: two companies ran the picker under the bell and the profile button at 390px (#80 QA). */}
          {!phone ? (
            <label className="ui-company-pick">
              <Building2 size={16} aria-hidden="true" className="ui-company-pick-icon" />
            <select
              className="ui-select ui-select-sm min-w-0"
              style={{ width: 'auto', minWidth: '10rem' }}
              value={tenant.id}
              disabled={tenants.length < 2}
              onChange={(e) => { const next = e.target.value; confirmLeave(askLeave).then((ok) => ok && setTenantId(next)); }}
              aria-label="Company"
            >
              {companyGroups(tenants, accounts).map((g) =>
                g.label ? (
                  <optgroup key={g.id} label={g.label}>
                    {g.items.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                ) : (
                  g.items.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))
                )
              )}
            </select>
            </label>
          ) : tenants.length > 1 && !(app && !inWorkspace) ? (
            <div className="relative" ref={companyRef}>
              <button type="button" className="ui-icon-btn" aria-label={`Company: ${tenant.name}`} aria-haspopup="menu" aria-expanded={companyOpen} onClick={() => setCompanyOpen((v) => !v)}>
                <Building2 size={18} aria-hidden="true" />
              </button>
              {/* Pinned to the screen with the 16px gutter, not to the button: hung off a 44px button it ran 16px off the left (#80 retest). */}
              {companyOpen ? (
                <div
                  role="menu"
                  className="fixed inset-x-4 top-14 mt-1 rounded-xl p-1"
                  style={{ backgroundColor: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', boxShadow: 'var(--shadow-lift)', zIndex: 'var(--z-platform-menu)' }}
                >
                  <CompanyMenuItems groups={companyGroups(tenants, accounts)} currentId={tenant.id} onPick={(t) => { setCompanyOpen(false); pickCompany(t.id); }} />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* The Workspace's date, once, in the bar: the browser's own locale and timezone. */}
          {inWorkspace && !phone ? (
            <time className="inline-flex items-center gap-1.5 text-sm ui-muted whitespace-nowrap" dateTime={new Date().toISOString().slice(0, 10)}>
              <CalendarDays size={15} aria-hidden="true" />
              {new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </time>
          ) : null}
          {/* A trial says when it ends, quietly, where the Workspace says the date (roadmap item 7). */}
          {inWorkspace && !phone && tenant?.billing?.status === 'trialing' && tenant.billing.trialEndsAt ? (
            <span className="text-sm ui-muted whitespace-nowrap" data-testid="trial-ends">
              Trial ends {new Date(tenant.billing.trialEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          ) : null}
          {/* One inbox for every app: an approval, a quiet reader, a bank change, a person the directory added. */}
          <NotificationBell
            tenantKey={tenantKey}
            /* The one waiting number the rail shows (manifest railCounts), so the bell never disagrees with Home or the Inbox. */
            waiting={waitingOnRail.count}
            onOpenWaiting={waitingOnRail.screen ? () => goTo(waitingOnRail.screen) : undefined}
            onOpen={(link) => {
              if (!link?.app) return;
              /* A notice raised for Attendance opens People's screen for a company on People. */
              const to = landingFor(link, subscriptions || [], { all: listAll });
              if (to.moved && to.app === activeAppId && !Root) {
                if (to.screen && app?.screens?.[to.screen]) goTo(to.screen, link.params);
                return;
              }
              if (link.app === activeAppId && !Root) {
                if (link.screen && app?.screens?.[link.screen]) goTo(link.screen, link.params);
                return;
              }
              /* Another app: openApp lands the link the same way (openAppNow). */
              openApp(link.app, link.screen || '', link.params || {});
            }}
          />
          {/* A phone's bar has no room for it (it pushed the bar past the screen); help is in the phone's Menu. */}
          {!phone && !app?.railFoot ? <HelpMenu /> : null}

          {!Root ? (
            <button
              type="button"
              className="ui-icon-btn"
              onClick={() => {
                setPlatformScreen('profile');
                setShowMoreApps(false);
              }}
              title="My profile"
              style={user?.avatarUrl || user?.fullName ? { width: 38, height: 38, padding: 2, borderRadius: 999 } : undefined}
            >
              {/* A person's own photo, larger and round, when they have one; otherwise the app's profile icon. */}
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" width="34" height="34" className="rounded-full object-cover" style={{ width: 34, height: 34, boxShadow: '0 0 0 2px rgb(var(--surface)), 0 0 0 3px rgb(var(--border))' }} />
              ) : user?.fullName ? (
                /* No photo yet: the person's initials, so the button is theirs at a glance (in the colour set too: a stock figure is nobody's). */
                <span className="ui-topbar-initials" aria-hidden="true">{String(user.fullName).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
              ) : (
                <UserRound size={18} aria-hidden="true" />
              )}
              <span className="sr-only">My profile</span>
            </button>
          ) : null}

          <button
            type="button"
            className="ui-icon-btn"
            onClick={() => {
              setPublicPage('signin');
              signOut();
            }}
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </header>

        <ExploreNotice explore={explore} demoUrl={DEMO_URL} />
        <SubscriptionBanner billing={tenant.billing} />
        <AnnouncementBar app={activeAppId} />
        {tenant.supportGrant ? (
          <div role="status" className="flex flex-wrap items-center gap-3 px-6 py-2 text-sm" style={{ backgroundColor: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))', borderBottom: '1px solid rgb(var(--border))' }}>
            <span className="min-w-0 flex-1">
              You are in {tenant.name} as CLOR support, {tenant.supportGrant.scope === 'READ_WRITE' ? 'able to make changes' : 'to read only'}, until{' '}
              {new Date(tenant.supportGrant.expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}. Salary, employee documents and bank details stay closed. The customer sees everything you open.
            </span>
          </div>
        ) : null}
        {tenant.archivedAt ? (
          <div role="status" className="flex flex-wrap items-center gap-3 px-6 py-2 text-sm" style={{ backgroundColor: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))', borderBottom: '1px solid rgb(var(--border))' }}>
            <span className="min-w-0 flex-1">This company is archived. You can read and export its records; nothing new can be saved. An account owner or admin can reactivate it in Workspace → Companies.</span>
          </div>
        ) : null}
        {unbought ? (
          <div role="status" className="flex flex-wrap items-center gap-3 px-6 py-2 text-sm" style={{ backgroundColor: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))', borderBottom: '1px solid rgb(var(--border))' }}>
            <span className="min-w-0 flex-1">{appById(unbought.app)?.name || 'This app'} is not on your plan, so it cannot be used here yet. {unbought.message ? `(${unbought.message})` : ''}</span>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { setShowMoreApps(true); setUnbought(null); }}>See apps and plans</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setUnbought(null)}>Dismiss</button>
          </div>
        ) : null}

        {twoFactorSetupRequired ? (
          <TwoFactorGate />
        ) : Root ? (
          /* The app owns the area under the platform bar. Reached from here by
             the switcher and by More apps, both of which are in the bar above —
             so an app that draws its own rail never has to know they exist. */
          <ScreenBoundary appName={app?.name} resetKey={`${app?.id}:${tenant.id}`}>
            {showMoreApps ? (
              <main className="p-6">
                <MoreApps tenant={tenant} catalog={catalog} onAdd={addApp} onOpen={openApp} />
              </main>
            ) : (
              /* Keyed on the company: changing it has to remount the app, or the
                 screens keep showing what they fetched for the last one. */
              <Suspense fallback={<AppLoading />}>
                <Root key={tenant.id} />
              </Suspense>
            )}
          </ScreenBoundary>
        ) : (
        <div className="flex">
          {/* One app's navigation. Never four apps' worth. */}
          {/* Pinned under the 56px header and scrolled on its own: a long menu (Attendance has 35 items)
              scrolled the whole page, so a screen opened from its lower half was out of view. */}
          {/* One app's navigation. Never four apps' worth. On a phone it is a sheet from the menu button and a tab bar below. */}
          {!phone && split ? (
            <div className="ui-split" data-overlay={tablet || undefined} aria-label={app ? `${app.name} navigation` : 'Navigation'}>
              {moduleRail}
              {modulePanel}
              {tablet && modulePanel ? <div className="ui-split-scrim" aria-hidden="true" onClick={() => { setTabletPanel(false); setBrowseModule(null); }} /> : null}
            </div>
          ) : null}
          {!phone && !split ? (
            <nav
              className="sticky top-14 w-56 shrink-0 self-start overflow-y-auto p-3 space-y-0.5"
              style={{ borderRight: '1px solid rgb(var(--border))', height: 'calc(100vh - 3.5rem)' }}
              aria-label={app ? `${app.name} navigation` : 'Navigation'}
            >
              {navItems}
            </nav>
          ) : null}
          {phone && navOpen ? (
            <div className="ui-nav-sheet" role="dialog" aria-modal="true" aria-label={app ? `${app.name} navigation` : 'Navigation'}>
              <div className="ui-nav-sheet-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
              {split ? (
                <div className="ui-nav-sheet-panel ui-nav-sheet-split">
                  {moduleRail}
                  {modulePanel || (
                    <div className="ui-split-panel">
                      <div className="ui-split-panel-head">
                        <span className="ui-t-sec">{openModule?.label || app?.name}</span>
                        <button type="button" className="ui-icon-btn" aria-label="Close menu" onClick={() => setNavOpen(false)}>
                          <X size={18} aria-hidden="true" />
                        </button>
                      </div>
                      <p className="ui-caption px-2">Pick a module on the left.</p>
                    </div>
                  )}
                </div>
              ) : (
              <nav className="ui-nav-sheet-panel">
                <div className="flex items-center justify-between px-2 pb-2">
                  <span className="ui-t-sec">{app?.name || 'Menu'}</span>
                  <button type="button" className="ui-icon-btn" aria-label="Close menu" onClick={() => setNavOpen(false)}>
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
                {navItems}
              </nav>
              )}
            </div>
          ) : null}

          {/* `flush`: the app's pages sit edge to edge on the white content column, as Accounting's do. */}
          <main id="main-content" tabIndex={-1} className={`flex-1 min-w-0 outline-none ${app?.flush ? `ui-content ${phone ? 'pb-24' : ''}` : phone ? 'p-4 pb-24' : 'p-6'}`}>
            {/* W-2.1: working in somebody else's account (outside access) is said on every screen, not only in the picker. */}
            {user && tenant?.accountId && user.accountId && tenant.accountId !== user.accountId ? (
              <p className="ui-delegated" role="status">
                You are in {accounts.find((x) => x.id === tenant.accountId)?.name || 'another account'}&rsquo;s company through outside access. Its administrators decide what you can open here.
              </p>
            ) : null}
            {showMoreApps ? (
              <MoreApps tenant={tenant} catalog={catalog} onAdd={addApp} onOpen={openApp} />
            ) : platformScreen === 'help' ? (
              <ScreenBoundary appName="Help centre" resetKey={`help:${helpTopic}`}>
                <div className={app?.id === ADMIN_APP_ID ? 'ws ws-legacy' : undefined}>
                  <div className={app?.id === ADMIN_APP_ID ? 'ws-inner' : undefined} style={app?.id === ADMIN_APP_ID ? { gap: 12 } : undefined}>
                    <div className={app?.id === ADMIN_APP_ID ? '' : app?.flush ? 'pt-3' : 'mb-3'}>
                      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setPlatformScreen(null)}>
                        <ArrowLeft size={16} aria-hidden="true" /> Back{app ? ` to ${app.name}` : ''}
                      </button>
                    </div>
                    <HelpCenter key={helpTopic} initialTopic={helpTopic} apps={mine.map((a) => a.id)} onOpen={(appId, screenKey2) => { setPlatformScreen(null); openApp(appId, screenKey2 || ''); }} />
                  </div>
                </div>
              </ScreenBoundary>
            ) : platformScreen === 'profile' ? (
              <ScreenBoundary appName="My profile" resetKey={`profile:${tenant.id}`}>
                {/* The profile opens from the header, not the sidebar, so it needs
                    its own way back to the screen it was opened from. */}
                {/* In the Workspace the profile sits on the Workspace surface (workspace.css, loaded with its screens). */}
                <div className={app?.id === ADMIN_APP_ID ? 'ws ws-legacy' : undefined}>
                  <div className={app?.id === ADMIN_APP_ID ? 'ws-inner' : undefined} style={app?.id === ADMIN_APP_ID ? { gap: 12 } : undefined}>
                    <div className={app?.id === ADMIN_APP_ID ? '' : app?.flush ? 'pt-3' : 'mb-3'}>
                      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setPlatformScreen(null)}>
                        <ArrowLeft size={16} aria-hidden="true" /> Back{app ? ` to ${app.name}` : ''}
                      </button>
                    </div>
                    <ProfileScreen
                      key={tenant.id}
                      links={(app?.profileLinks || []).map((k) => nav.find((i) => i.key === k)).filter(Boolean).map((i) => ({ key: i.key, label: i.label, icon: i.icon, onOpen: () => goTo(i.key) }))}
                    />
                  </div>
                </div>
              </ScreenBoundary>
            ) : screenMissing ? (
              <ScreenState
                title="This page isn’t here"
                text={`${app?.name || 'This app'} has no page at this address. It may have moved, or the link may be mistyped.`}
                action={landing ? { label: `Go to ${app.name}`, run: () => goTo(landing) } : null}
              />
            ) : screenDenied ? (
              <ScreenState
                title={`You can’t open ${screenItem?.label || 'this page'}`}
                text={`It needs the “${permissionWords([].concat(screenItem.permission)[0])}” permission in ${tenant.name}, and none of your roles here gives it. An administrator of the company can give you a role that does.`}
                action={landing && landing !== screen ? { label: `Go to ${app.name}`, run: () => goTo(landing) } : null}
              />
            ) : Screen ? (
              <ScreenBoundary appName={app?.name} resetKey={`${app?.id}:${screen}:${tenant.id}`}>
                {/* Same rule as an app that draws itself: a company change is a
                    remount, not a re-render with stale figures on screen. */}
                {/* `openScreen(key)` lets a screen link to another of its app's screens (a "3 waiting" note opening the list). */}
                {/* One permission set for every app's screens; a screen whose resource this person may not change is shown read-only (WriteGuard). */}
                <PermissionProvider key={tenantKey} enabled>
                  {/* A list of permissions (any one opens the screen) or `writeGuard: false` (PR #67): the screen's server decides per person. */}
                  <WriteGuard permission={writeGuardPermission(screenItem)}>
                    {(() => {
                      /* A page under a hub (People → Settings → Departments) shows the way back to it. */
                      const parentKey = (app?.nav || []).find((n) => n.key === screen)?.parent;
                      /* Only under a hub (Settings); a page inside a list's module (an employee record) draws its own breadcrumb. */
                      const parent = parentKey && nav.find((n) => n.key === parentKey && n.hub);
                      /* Opened from elsewhere (a list, a record, a quick link): back goes there, with its tab and filters. */
                      const from = cameFrom[screen];
                      /* Any other page reached by a link on another page gets the same way back to where the link was
                         clicked (owner, 11 Nov 2026). Not when that page is its own list (Employees above a record):
                         the page's breadcrumb already goes there. */
                      const linked = !parent && from?.link && from.key !== screen && from.key !== parentKey;
                      if (!parent && !linked) return null;
                      const origin = from && from.key !== parent?.key ? nav.find((n) => n.key === from.key) : null;
                      if (!parent && !origin) return null;
                      const back = () => confirmLeave(askLeave).then((ok) => {
                        if (!ok) return;
                        if (!origin) { goToNow(parent.key); return; }
                        setScreenKey(origin.key);
                        setScreenParams(from.params);
                        setPlatformScreen(null);
                        window.scrollTo(0, 0);
                      });
                      return (
                        <button type="button" className="ui-link mb-2 inline-flex items-center gap-1 text-sm" onClick={back}>
                          ← {origin ? origin.label : parent.label}
                        </button>
                      );
                    })()}
                    <Suspense fallback={<AppLoading />}>
                      <Screen
                        key={screenParams ? `${tenant.id}:${screenKey}:${JSON.stringify(screenParams)}` : tenant.id}
                        params={liveParams || undefined}
                        /* Change this screen's own state (a tab, a filter) in place; the address follows. `push` adds a Back step. */
                        updateParams={(patch, opts = {}) => {
                          const next = mergeParams(liveParams, patch);
                          const appInHost = Boolean(appFromHost());
                          const url = `${window.location.pathname}${screenSearch(window.location.search, { app: activeAppId, open: screenKey, appInHost, params: next })}${window.location.hash}`;
                          /* Under Settings a change of tab or item is not a step of its own: the browser's Back leaves the
                             page for where it was opened from, not the last thing clicked on it (owner, 29 Oct 2026). */
                          const hubKey = (app?.nav || []).find((n) => n.key === screen)?.parent;
                          const underHub = Boolean(hubKey && (app?.nav || []).find((n) => n.key === hubKey)?.hub);
                          if (opts.push && !underHub) window.history.pushState(null, '', url);
                          else window.history.replaceState(null, '', url);
                          lastUrlRef.current = window.location.href;
                          setLiveParams(next);
                        }}
                        /* The screens this person may open, for a hub page (People's Settings) to list. */
                        navItems={nav}
                        /* The company being looked at, its apps, and a way into one (Workspace's home). */
                        tenant={tenant}
                        user={user}
                        apps={mine}
                        catalog={catalog}
                        companies={tenants.filter((t) => t.accountId && t.accountId === tenant.accountId)}
                        accountName={accounts.find((x) => x.id === tenant.accountId)?.name || ''}
                        openApp={openApp}
                        openMoreApps={() => setShowMoreApps(true)}
                        /* W-R5: the Workspace's Companies page adds a company and switches to one. */
                        addCompany={createCompany}
                        switchCompany={(id) => { confirmLeave(askLeave).then((ok) => ok && setTenantId(id)); }}
                        openScreen={(key, params) => {
                          if (!app?.screens?.[key]) return;
                          confirmLeave(askLeave).then((ok) => {
                            if (!ok) return;
                            noteOrigin(key, true);
                            setScreenKey(key);
                            setScreenParams(params && typeof params === 'object' ? params : null);
                            setPlatformScreen(null);
                            window.scrollTo(0, 0);
                          });
                        }}
                      />
                    </Suspense>
                  </WriteGuard>
                </PermissionProvider>
              </ScreenBoundary>
            ) : (
              <p className="ui-caption">Nothing selected.</p>
            )}
          </main>
          {phone && tabs.length ? (
            <nav className="ui-tabbar" aria-label={`${app.name} quick navigation`}>
              {tabs.map((t) => {
                const active = screen === t.key && !platformScreen && !showMoreApps;
                return (
                  <button
                    key={t.key}
                    type="button"
                    className="ui-tabbar-item"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      setScreenKey(t.key);
                      setPlatformScreen(null);
                      setShowMoreApps(false);
                      window.scrollTo(0, 0);
                    }}
                  >
                    {t.icon ? <t.icon size={20} aria-hidden="true" /> : null}
                    <span>{t.short || t.label}</span>
                  </button>
                );
              })}
              <button type="button" className="ui-tabbar-item" onClick={() => setNavOpen(true)} aria-expanded={navOpen}>
                <Menu size={20} aria-hidden="true" />
                <span>Menu</span>
              </button>
            </nav>
          ) : null}
          {/* Apps with a nav (People, Attendance, Payroll) have no root of their
              own to mount this, so toasts and "Are you sure?" dialogs live here.
              Accounting draws itself and mounts its own. */}
          <Toaster />
        </div>
        )}
        {paletteOpen && !Root ? (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            placeholder={app?.searchRecords ? `Search people, jobs and screens…` : `Search ${app?.name || 'CLOR'} screens and apps…`}
            /* People by name, code or email (manifest `searchRecords`), as the person types. */
            loadRecords={app?.searchRecords ? (q) => app.searchRecords(q, { apps: mine.map((a) => a.id) }) : undefined}
            items={[
              /* A screen can sit in two places in the menu; it is one destination here. */
              ...[...new Map(nav.filter((i) => !i.section && app?.screens?.[i.key]).map((i) => [i.key, i])).values()].map((i) => ({ key: `screen:${i.key}`, label: i.label, group: app.name, icon: i.icon, screen: i.key, keywords: i.keywords })),
              /* Jobs named the way people ask for them (manifest `searchActions`): "probation", "fix a punch", "month close".
                 One in another app shows only when this company has that app and this person can open it there. */
              ...(app?.searchActions || [])
                .filter((a) => (a.appId ? mine.some((m) => m.id === a.appId) : nav.some((i) => i.key === a.screen)))
                .map((a) => ({ key: `do:${a.appId || ''}:${a.screen}:${a.label}`, label: a.label, group: a.appId ? appById(a.appId)?.name || 'Apps' : 'Do', icon: a.icon, screen: a.screen, params: a.params, appId: a.appId, keywords: a.keywords })),
              ...mine.filter((a) => a.id !== activeAppId).map((a) => ({ key: `app:${a.id}`, label: `Open ${a.name}`, group: 'Apps', icon: a.icon, appId: a.id })),
              { key: 'profile', label: 'My profile', group: 'You', icon: UserRound },
              { key: 'help', label: 'Help centre', group: 'You', icon: CircleHelp },
            ]}
            onSelect={(item) => {
              setPaletteOpen(false);
              if (item.appId && item.appId !== activeAppId) openApp(item.appId, item.screen || '', item.params || {});
              else if (item.screen) goTo(item.screen, item.params || null);
              else if (item.appId) openApp(item.appId);
              else if (item.key === 'profile') {
                setPlatformScreen('profile');
                setShowMoreApps(false);
              }
              else if (item.key === 'help') {
                setHelpTopic('welcome');
                setPlatformScreen('help');
                setShowMoreApps(false);
              }
            }}
          />
        ) : null}
      </div>
    </LineSetContext.Provider>
    </IconSetContext.Provider>
  );
}

/**
 * Everything CLOR is, and what this company has of it.
 *
 * Reachable from inside every app, and owned by the shell rather than by
 * Accounting — which is what lets a Payroll-only company add Accounting
 * without first entering a product it has not bought.
 */
function MoreApps({ tenant, catalog = APPS, onAdd, onOpen }) {
  const has = (id) => (tenant.subscriptions || []).includes(id);
  /* `catalog` leaves out an app the company has inside another (Attendance, on People): neither opened nor offered apart. */
  const mineCount = catalog.filter((a) => !a.platform && has(a.id)).length;
  /* CLOR's app catalogue (operator console): a hidden app is not offered, one coming soon cannot be added yet. An app the company has stays. */
  const catalogue = useAppCatalogue();
  const listed = catalog.filter((a) => !a.platform)
    .map((a) => {
      const l = listingFor(catalogue, a.id);
      return { ...a, blurb: l?.blurb || a.blurb, available: a.available && (!l || l.status === 'AVAILABLE' || has(a.id)), hidden: l?.status === 'HIDDEN' && !has(a.id) };
    })
    .filter((a) => !a.hidden);
  /* Unrestricted (no subscription assigned) owns everything sellable. */
  const owned = (id) => !tenant.billing?.restricted || (tenant.billing.ownedApps || []).includes(id);

  return (
    <div className="space-y-6" style={{ maxWidth: '56rem' }}>
      <div>
        <h1 className="ui-display text-2xl">More apps</h1>
        <p className="ui-caption mt-1">
          Everything CLOR runs. {tenant.name} has {mineCount} of them.
        </p>
      </div>

      <PlanCard billing={tenant.billing} />

      <div className="grid gap-3 sm:grid-cols-2">
        {listed.map((a) => (
          <article key={a.id} className="ui-card p-4">
            <div className="flex items-start justify-between gap-3">
              <span
                className="grid place-items-center w-9 h-9 rounded-lg shrink-0"
                style={{ backgroundColor: 'rgb(var(--brand-soft))', color: 'rgb(var(--brand-ink))' }}
              >
                <a.icon size={18} aria-hidden="true" />
              </span>
              {a.available ? null : <span className="ui-pill ui-pill-neutral">Coming</span>}
            </div>

            <h2 className="mt-3 font-medium">{a.name}</h2>
            <p className="mt-1 text-sm ui-muted">{a.blurb}</p>

            <div className="mt-4">
              {!a.available ? (
                <span className="ui-caption">Coming soon.</span>
              ) : has(a.id) ? (
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onOpen(a.id)}>
                  Open {a.name}
                </button>
              ) : !owned(a.id) ? (
                <span className="ui-caption">Not on your plan. Contact CLOR to add it.</span>
              ) : (
                <AddAppButton app={a} tenant={tenant} onAdd={onAdd} />
              )}
            </div>
          </article>
        ))}
      </div>

      <p className="ui-caption">
        Adding an app switches it on for this company and gives it its own database — no other app&rsquo;s data is
        touched, and the apps it already uses carry on unchanged.
      </p>
    </div>
  );
}

/**
 * Adding an app is a request, not a checkbox.
 *
 * It provisions on the server, so the button has to say so and has to refuse
 * to be pressed twice — a second press while the first is in flight would ask
 * for the same company to be given the same app again.
 */
function AddAppButton({ app, tenant, onAdd }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <>
      <button
        type="button"
        className="ui-btn ui-btn-primary ui-btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await onAdd(app.id);
          } catch (e) {
            setError(String(e?.message || 'Could not add that app.'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Plus size={14} aria-hidden="true" />
        {busy ? 'Adding…' : `Add to ${tenant.name}`}
      </button>
      {error ? (
        <p className="mt-2 text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p>
      ) : null}
    </>
  );
}

const STATUS_LABEL = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  paused: 'Paused',
  cancelled: 'Cancelled',
};

/**
 * Where the company stands with CLOR. Says nothing when no subscription has
 * been assigned: an account that was never restricted has no plan to describe,
 * and inventing one would be a claim the server did not make.
 */
function PlanCard({ billing }) {
  if (!billing?.restricted) return null;
  const end = billing.status === 'trialing' ? billing.trialEndsAt : billing.currentPeriodEnd;
  return (
    <section className="ui-card p-4 flex flex-wrap items-center gap-3" aria-label="Your plan">
      <span className={`ui-pill ${billing.inGoodStanding ? 'ui-pill-pos' : 'ui-pill-warn'}`}>
        {STATUS_LABEL[billing.status] || billing.status}
      </span>
      <span className="text-sm">
        {(billing.ownedApps || []).length} app{(billing.ownedApps || []).length === 1 ? '' : 's'} on this plan
        {end ? (
          <>
            {' · '}
            {billing.status === 'trialing' ? 'trial ends' : 'renews'} {formatDateIn(end)}
          </>
        ) : null}
      </span>
    </section>
  );
}

/**
 * A lapsed subscription warns; it does not lock anybody out of their data.
 * Shown under the platform bar on every screen until it is resolved.
 */
function SubscriptionBanner({ billing }) {
  if (!billing?.restricted || billing.inGoodStanding) return null;
  return (
    <div
      role="status"
      className="px-6 py-2 text-sm"
      style={{ backgroundColor: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))', borderBottom: '1px solid rgb(var(--border))' }}
    >
      {/* The server's own sentence when it has one (a trial that ended, routes/billing.ts `reason`); the old line otherwise. */}
      {billing.reason || (
        <>
          Your CLOR subscription is {(STATUS_LABEL[billing.status] || billing.status).toLowerCase()}. Your data is safe
          and still visible; renew to keep working. Contact suresh@clor.in.
        </>
      )}
    </div>
  );
}

export { availableApps };
