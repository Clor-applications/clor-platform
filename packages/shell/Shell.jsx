import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, LayoutGrid, LogOut, Menu, Moon, Plus, Sun, UserRound, X } from 'lucide-react';

import { useTheme } from '@ui/components/ui/useTheme';
import { useDismissable } from '@ui/components/ui/useDismissable';
import { formatDateIn } from '@ui/utils/dates';
import { ProfileScreen } from '@ui/profile/ProfileScreen';
import Toaster from '@ui/components/ui/Toaster';
import { getMyPermissions } from '@ui/api/permissions';

import { APPS, appById, availableApps, landingApp, subscribedApps } from './registry';
import { appFromHost, hostForApp, isFrontDoor } from './appHosts';
import { PHONE_QUERY, mobileTabsFor } from './mobileTabs';
import { moduleForScreen, resolveModules } from './splitNav';
import { useSession } from './session';
import ClorMark from './ClorMark';
import CompanySetup from './CompanySetup';
import Home from './Home';
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
 * The Clor shell.
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

export default function Shell() {
  /* A phone: no rail, a menu sheet and a tab bar instead (mobileTabs.js). */
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = (e) => setPhone(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const { user, tenant, tenants, restoring, setTenantId, signOut, addApp } = useSession();

  /* The shared hook, not a second copy: the public page has a toggle too, and
     a private key here would mean the choice did not follow you inside. */
  const { theme, toggle: toggleTheme } = useTheme();

  /* Null while the company's apps are still being read, which is not the same
     as none: treating it as none would flash an empty rail. */
  const subscriptions = tenant?.subscriptions;
  const mine = useMemo(() => subscribedApps(subscriptions || []), [subscriptions]);

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
      .then((d) => !off && setGrants({ key: tenantKey, set: new Set(Array.isArray(d?.permissions) ? d.permissions : []) }))
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
  const [chosenAppId, setChosenAppId] = useState(() => appFromHost());
  const activeAppId = mine.some((a) => a.id === chosenAppId)
    ? chosenAppId
    : landingApp(subscriptions || [])?.id || null;
  const [screenKey, setScreenKey] = useState(null);
  const [browseModule, setBrowseModule] = useState(null);
  /* A page the platform owns rather than the app (My profile), shown in an
     app's main area. Only for apps that use the shell's menu: an app that
     draws its own (Accounting) has its own profile entry. */
  const [platformScreen, setPlatformScreen] = useState(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  /* Closes on a click anywhere else, and on Escape. It did neither: the only
     way out of the app switcher was to click the app switcher again. */
  const switcherRef = useDismissable(switcherOpen, () => setSwitcherOpen(false));
  const [showMoreApps, setShowMoreApps] = useState(false);

  /*
   * What an unauthenticated visitor is looking at: the public page, or one of
   * the two doors off it. Three states rather than a router, because they are
   * the only three there are — everything past sign-in is an app's business.
   */
  const [publicPage, setPublicPage] = useState('home');

  /* A policy page is open to everyone, signed in or not, at #/legal/<doc>. */
  const legalDoc = useLegalRoute();
  /* An app's page for people without a CLOR user (the employee portal, #/portal). */
  const appPublicPage = usePublicPage();

  /*
   * Links in Clor's emails: `/?reset=<token>` and `/?verify=<token>`. Read once
   * on load; leaving either screen strips the token from the address bar so a
   * reload or a shared screenshot does not carry it.
   */
  const [emailLink, setEmailLink] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      /* Emails sent before 12 Oct 2026 used /verify-email?token= and /?token=. */
      const legacy = String(q.get('token') || '').trim();
      const onVerifyPath = /\/verify-email\/?$/.test(window.location.pathname);
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
    document.documentElement.style.setProperty('--platform-bar', '3.5rem');
    return () => document.documentElement.style.removeProperty('--platform-bar');
  }, []);

  /* The open app on <html> too, for the same reason: a drawer for a People
     record is drawn outside the shell's element and should wear People's
     palette (index.css, [data-app]). */
  useEffect(() => {
    if (activeAppId) document.documentElement.setAttribute('data-app', activeAppId);
    else document.documentElement.removeAttribute('data-app');
    return () => document.documentElement.removeAttribute('data-app');
  }, [activeAppId]);

  /* Signed in at the front door (app.clor.in): go on to the app's own address,
     keeping any #/screen so a link into an app still lands on that screen. */
  const frontDoorTarget =
    user && tenant && !emailLink && isFrontDoor() && activeAppId ? hostForApp(activeAppId) : null;
  useEffect(() => {
    if (!frontDoorTarget) return;
    window.location.replace(`${window.location.protocol}//${frontDoorTarget}/${window.location.hash}`);
  }, [frontDoorTarget]);

  /*
   * A token in this browser is checked before anything is drawn.
   *
   * Without this the public page appears for a moment on every reload — an
   * advertisement shown to somebody who is already a customer, four times a
   * day.
   */
  if (legalDoc) return <LegalPage doc={legalDoc} />;
  if (appPublicPage) {
    return (
      <>
        {renderPublicPage(appPublicPage)}
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

  if (!user) {
    if (publicPage === 'signin') {
      return (
        <SignIn
          onHome={() => setPublicPage('home')}
          onSignUp={() => setPublicPage('signup')}
          onForgot={() => setPublicPage('forgot')}
        />
      );
    }
    if (publicPage === 'forgot') {
      return <ForgotPassword onHome={() => setPublicPage('home')} onSignIn={() => setPublicPage('signin')} />;
    }
    if (publicPage === 'signup') {
      return <SignUp onHome={() => setPublicPage('home')} onSignIn={() => setPublicPage('signin')} />;
    }
    return <Home onSignIn={() => setPublicPage('signin')} onGetStarted={() => setPublicPage('signup')} />;
  }

  /*
   * Signed in, with nothing to be signed in to.
   *
   * This used to fall through to the marketing page, which is why sign-up had
   * to create a company: without one the account it made vanished behind the
   * front door. It is a real state — a new account before its first company,
   * and an account whose last company was removed — so it gets a real screen.
   */
  if (!tenant) return <CompanySetup />;

  const app = appById(activeAppId);
  /* Items whose `permission` this person lacks go, then any section heading left with nothing under it. */
  const allowed = (app?.nav || []).filter((item) => item.section || !item.permission || !granted || granted.has(item.permission));
  const nav = allowed.filter((item, i) => !item.section || (allowed[i + 1] && !allowed[i + 1].section));
  /* A screen the open app does not have is not a screen: the same company
     switch that changes the app leaves last app's screen key behind, and
     honouring it shows "Nothing selected" instead of the new app's home. */
  const screen = (screenKey && app?.screens?.[screenKey] ? screenKey : app?.home) || null;
  const Screen = app?.screens?.[screen] || null;
  /* An app may draw its own navigation instead of handing the shell a list. */
  const Root = app?.Root || null;
  /* Or ask for the split sidebar: modules on a rail, the open module's screens beside it (splitNav.js). */
  const modules = resolveModules(app, nav);
  const split = modules.length > 0;
  const currentModule = moduleForScreen(modules, screen) || modules[0] || null;
  /* The module whose panel is open; follows the screen unless the person is browsing another on the rail. */
  const openModule =
    (browseModule && modules.find((m) => m.key === browseModule)) ||
    /* In the phone sheet a single-screen module has nothing to list, so the sheet opens on the first module that has. */
    (phone && currentModule?.single ? modules.find((m) => !m.single) || currentModule : currentModule);

  const openApp = (id) => {
    const next = appById(id);
    /* An app with its own address opens there, so the address bar says which
       app this is. The session follows through the API's refresh cookie. */
    const host = hostForApp(id);
    if (host && host !== window.location.hostname) {
      window.location.assign(`${window.location.protocol}//${host}/`);
      return;
    }
    setChosenAppId(id);
    setScreenKey(next?.home || null);
    setPlatformScreen(null);
    setSwitcherOpen(false);
    setShowMoreApps(false);
  };

  const goTo = (key) => {
    setScreenKey(key);
    setPlatformScreen(null);
    setShowMoreApps(false);
    setNavOpen(false);
    setBrowseModule(null);
    /* A new screen starts at its top, not at the last one's scroll position. */
    window.scrollTo(0, 0);
  };
  const isCurrent = (key) => screen === key && !platformScreen && !showMoreApps;

  /* The rail of modules. On a desktop a tap opens the module's first screen; in the phone sheet it only
     switches the panel, so the person can pick a screen before the sheet closes (ClorTime's drawer). */
  const moduleRail = (
    <nav className="ui-split-rail" aria-label={`${app?.name || ''} modules`}>
      {modules.map((m) => {
        const Icon = m.icon;
        const active = openModule?.key === m.key;
        return (
          <button
            key={m.key}
            type="button"
            className="ui-split-mod"
            aria-pressed={active}
            title={m.label}
            onClick={() => {
              if (m.single || !phone) goTo(m.home);
              else setBrowseModule(m.key);
            }}
          >
            {Icon ? <Icon size={20} aria-hidden="true" /> : null}
            <span>{m.label}</span>
          </button>
        );
      })}
    </nav>
  );
  /* The open module's screens under plain headings; a single-screen module has no panel. */
  const modulePanel = openModule && !openModule.single ? (
    <nav className="ui-split-panel" aria-label={`${openModule.label} screens`}>
      <div className="ui-split-panel-head">
        <span className="ui-t-sec">{openModule.label}</span>
        {phone ? (
          <button type="button" className="ui-icon-btn" aria-label="Close menu" onClick={() => setNavOpen(false)}>
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {openModule.groups.map((g, gi) => (
        <div key={g.label || gi} className={gi ? 'mt-4' : ''}>
          {g.label ? <p className="ui-caption px-2 pb-1 uppercase tracking-wide">{g.label}</p> : null}
          {g.items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="ui-split-item"
              aria-current={isCurrent(item.key) ? 'page' : undefined}
              onClick={() => goTo(item.key)}
            >
              {item.icon ? <item.icon size={15} aria-hidden="true" /> : null}
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ))}
      <div style={{ borderTop: '1px solid rgb(var(--border))' }} className="mt-4 pt-3">
        <button type="button" className="ui-split-item" onClick={() => { setShowMoreApps(true); setNavOpen(false); }}>
          <LayoutGrid size={15} aria-hidden="true" />
          More apps
        </button>
      </div>
    </nav>
  ) : null;

  const navItems = (
    <>
          {nav.map((item) =>
            /* `{ section: 'Settings' }` starts a group: setup apart from daily work. */
            item.section ? (
              <p key={`section:${item.section}`} className="ui-caption px-2 pt-4 pb-1 uppercase tracking-wide">
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

  return (
    <div
      className="min-h-screen"
      /* Which app is open, for styling: People, Attendance and Payroll wear the
         HR palette (index.css, [data-app]); Accounting keeps its own. */
      data-app={activeAppId || undefined}
      style={{ backgroundColor: 'rgb(var(--app-bg))', '--platform-bar': '3.5rem' }}
    >
      <header
        className="sticky top-0 flex h-14 items-center gap-3 px-4"
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
        <button type="button" className="flex items-center gap-2" onClick={() => openApp(mine[0]?.id)}>
          <ClorMark size={24} />
          <span className={phone ? 'sr-only' : 'ui-display text-base'}>Clor</span>
        </button>

        {/* The app switcher. Named for the app you are in, because that is the
            question it answers before it is the control it offers. */}
        {app ? (
          <div className="relative" ref={switcherRef}>
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-sm"
              onClick={() => setSwitcherOpen((v) => !v)}
              aria-expanded={switcherOpen}
              aria-haspopup="menu"
            >
              <app.icon size={15} aria-hidden="true" />
              {app.name}
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
                {mine.map((a) => (
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
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex-1" />

        {/* On a phone the bar holds menu, mark, app, profile and sign-out; one company needs no picker and the theme follows the phone. */}
        {!phone || tenants.length > 1 ? (
          <select
            className="ui-select ui-select-sm min-w-0"
            style={{ width: 'auto', minWidth: phone ? '7rem' : '12rem', maxWidth: phone ? '38vw' : undefined }}
            value={tenant.id}
            disabled={tenants.length < 2}
            onChange={(e) => setTenantId(e.target.value)}
            aria-label="Company"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        ) : null}

        {!phone ? (
          <button
            type="button"
            className="ui-icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        ) : null}

        {!Root ? (
          <button
            type="button"
            className="ui-icon-btn"
            onClick={() => {
              setPlatformScreen('profile');
              setShowMoreApps(false);
            }}
            aria-label="My profile"
            title="My profile"
          >
            <UserRound size={16} />
          </button>
        ) : null}

        <button
          type="button"
          className="ui-icon-btn"
          onClick={() => {
            setPublicPage('home');
            signOut();
          }}
          aria-label="Sign out"
        >
          <LogOut size={16} />
        </button>
      </header>

      <SubscriptionBanner billing={tenant.billing} />

      {Root ? (
        /* The app owns the area under the platform bar. Reached from here by
           the switcher and by More apps, both of which are in the bar above —
           so an app that draws its own rail never has to know they exist. */
        <ScreenBoundary appName={app?.name} resetKey={`${app?.id}:${tenant.id}`}>
          {showMoreApps ? (
            <main className="p-6">
              <MoreApps tenant={tenant} onAdd={addApp} onOpen={openApp} />
            </main>
          ) : (
            /* Keyed on the company: changing it has to remount the app, or the
               screens keep showing what they fetched for the last one. */
            <Root key={tenant.id} />
          )}
        </ScreenBoundary>
      ) : (
      <div className="flex">
        {/* One app's navigation. Never four apps' worth. */}
        {/* Pinned under the 56px header and scrolled on its own: a long menu (Attendance has 35 items)
            scrolled the whole page, so a screen opened from its lower half was out of view. */}
        {/* One app's navigation. Never four apps' worth. On a phone it is a sheet from the menu button and a tab bar below. */}
        {!phone && split ? (
          <div className="ui-split" aria-label={app ? `${app.name} navigation` : 'Navigation'}>
            {moduleRail}
            {modulePanel}
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

        <main className={`flex-1 min-w-0 ${phone ? 'p-4 pb-24' : 'p-6'}`}>
          {showMoreApps ? (
            <MoreApps tenant={tenant} onAdd={addApp} onOpen={openApp} />
          ) : platformScreen === 'profile' ? (
            <ScreenBoundary appName="My profile" resetKey={`profile:${tenant.id}`}>
              <ProfileScreen key={tenant.id} />
            </ScreenBoundary>
          ) : Screen ? (
            <ScreenBoundary appName={app?.name} resetKey={`${app?.id}:${screen}:${tenant.id}`}>
              {/* Same rule as an app that draws itself: a company change is a
                  remount, not a re-render with stale figures on screen. */}
              {/* `openScreen(key)` lets a screen link to another of its app's screens (a "3 waiting" note opening the list). */}
              <Screen
                key={tenant.id}
                openScreen={(key) => {
                  if (!app?.screens?.[key]) return;
                  setScreenKey(key);
                  setPlatformScreen(null);
                  window.scrollTo(0, 0);
                }}
              />
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
                  <span>{t.label}</span>
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
    </div>
  );
}

/**
 * Everything Clor is, and what this company has of it.
 *
 * Reachable from inside every app, and owned by the shell rather than by
 * Accounting — which is what lets a Payroll-only company add Accounting
 * without first entering a product it has not bought.
 */
function MoreApps({ tenant, onAdd, onOpen }) {
  const has = (id) => (tenant.subscriptions || []).includes(id);
  /* Unrestricted (no subscription assigned) owns everything sellable. */
  const owned = (id) => !tenant.billing?.restricted || (tenant.billing.ownedApps || []).includes(id);

  return (
    <div className="space-y-6" style={{ maxWidth: '56rem' }}>
      <div>
        <h1 className="ui-display text-2xl">More apps</h1>
        <p className="ui-caption mt-1">
          Everything Clor runs. {tenant.name} has {(tenant.subscriptions || []).length} of them.
        </p>
      </div>

      <PlanCard billing={tenant.billing} />

      <div className="grid gap-3 sm:grid-cols-2">
        {APPS.map((a) => (
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
                <span className="ui-caption">Not built yet.</span>
              ) : has(a.id) ? (
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onOpen(a.id)}>
                  Open {a.name}
                </button>
              ) : !owned(a.id) ? (
                <span className="ui-caption">Not on your plan. Contact Clor to add it.</span>
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
 * Where the company stands with Clor. Says nothing when no subscription has
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
      Your Clor subscription is {(STATUS_LABEL[billing.status] || billing.status).toLowerCase()}. Your data is safe
      and still visible; renew to keep working. Contact suresh@clor.in.
    </div>
  );
}

export { availableApps };
