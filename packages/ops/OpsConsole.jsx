import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogOut, Menu, X } from '@ui/components/ui/lineIcons';
import QRCode from 'qrcode';

import { ClorLogo } from '@ui/components/brand';
import { IconSetContext, LineSetContext } from '@ui/components/ui/iconSet';
import Toaster from '@ui/components/ui/Toaster';
import { ICON } from '../../apps/admin/src/screens/wsKit';
import '../../apps/admin/src/screens/workspace.css';
import { useSession } from '../shell/session';
import SignIn from '../shell/SignIn';
import OperatorBrand from './OperatorBrand';
import { DemoRequestDetail, DemoRequests } from './DemoRequests';
import { Payments } from './Payments';
import { InvoicePage, Invoices } from './Invoices';
import { InvoiceSettings } from './InvoiceSettings';
import { Trials } from './Trials';
import { Pricing } from './Pricing';
import { Settings as TaxSettings } from './Settings';
import { ExploreLinks, SampleCompany } from './Explore';
import { CustomerPage, Customers } from './Customers';
import { Home } from './Home';
import { Staff } from './Staff';
import { EmailAddresses, EmailLog, EmailTemplates } from './Email';
import { AppCatalogue } from './AppCatalogue';
import { AuditLog } from './AuditLog';
import { Health } from './Health';
import { TicketPage, Tickets } from './Tickets';
import { OpsSearch } from './OpsSearch';
import { ROLE } from './kit';
import { opsEnableTwoFactor, opsMe, opsStartTwoFactor } from './api';

/**
 * The CLOR operator console (W-8.2; roadmap items 13 and 14), at ops.clor.in
 * (or /ops on any CLOR host). CLOR staff only: the server refuses anybody
 * else and any operator without an authenticator, asks for a fresh code
 * before every change, and enforces each staff member's role.
 *
 * What it shows is account metadata — owners, companies, apps, plan, sign-in
 * dates — never a customer's books, people or payroll.
 *
 * Every staff job is a screen here, in plain words: no commands, scripts or
 * settings files. Deploys and database changes stay with engineering.
 */

/* ------------------------------------------------------------- navigation */
/*
 * The menu, in groups. A screen is listed only when this console has it
 * (SCREENS below), so a group fills in as its screens arrive: Trials, Pricing,
 * Payments, Gateways and Tax come with their own changes and take the places
 * kept for them here.
 */
export const NAV = [
  { items: [['home', 'Home', ICON.home]] },
  {
    label: 'Customers',
    items: [
      ['customers', 'Customers', ICON.companies],
      ['tickets', 'Tickets', ICON.chat],
      ['trials', 'Trials', ICON.plan],
      ['demos', 'Demo requests', ICON.mail],
      ['links', 'Explore links', ICON.invite],
    ],
  },
  {
    label: 'Money',
    items: [
      ['pricing', 'Pricing', ICON.plan],
      ['invoices', 'Invoices', ICON.guide],
      ['payments', 'Payments', ICON.payroll],
      ['gateways', 'Gateways', ICON.secure],
      ['tax', 'Tax', ICON.guide],
      ['invoicing', 'Invoice settings', ICON.settings],
    ],
  },
  {
    label: 'Product',
    items: [
      ['catalogue', 'App catalogue', ICON.apps],
      ['sample', 'Sample company', ICON.company],
    ],
  },
  {
    label: 'Email',
    items: [
      ['emailAddresses', 'Addresses', ICON.mail],
      ['emailTemplates', 'Templates', ICON.guide],
      ['emailLog', 'Log', ICON.history],
    ],
  },
  { label: 'System', items: [['health', 'System health', ICON.alert]] },
  { label: 'Team', items: [['staff', 'Staff and roles', ICON.team, 'SUPER_ADMIN']] },
  { items: [['audit', 'Audit log', ICON.security]] },
];

/**
 * Every screen the console has, by its menu key. `route` is the address
 * (#/page/id/tab?filters); `go(page, params, id, tab)` moves to another.
 */
export const SCREENS = {
  home: ({ go, has }) => <Home go={go} has={has} />,
  customers: ({ route, go, me }) =>
    route.id ? (
      <CustomerPage
        id={route.id}
        tab={route.tab || 'overview'}
        role={me.role}
        back={() => go('customers')}
        setTab={(tab) => go('customers', {}, route.id, tab, true)}
        openDemo={(id) => go('demos', {}, id)}
      />
    ) : (
      <Customers key={route.params.status || 'all'} initialStatus={route.params.status || 'all'} openCustomer={(id) => go('customers', {}, id)} />
    ),
  demos: ({ route, go, me }) =>
    route.id ? (
      <DemoRequestDetail id={route.id} role={me.role} back={() => go('demos')} openAccount={(id) => go('customers', {}, id)} />
    ) : (
      <DemoRequests openRequest={(id) => go('demos', {}, id)} />
    ),
  trials: ({ go, me }) => <Trials role={me.role} openAccount={(id) => go('customers', {}, id)} />,
  links: ({ go, me }) => <ExploreLinks role={me.role} openRequest={(id) => go('demos', {}, id)} />,
  pricing: ({ me }) => <Pricing role={me.role} />,
  /* Payments holds the gateways too (keys, test and live), so the Gateways place stays empty. */
  payments: ({ me }) => <Payments role={me.role} />,
  tax: ({ me }) => <TaxSettings role={me.role} />,
  invoices: ({ route, go, me }) =>
    route.id ? (
      <InvoicePage key={route.id} id={route.id} role={me.role} back={() => go('invoices')} openCustomer={(id) => go('customers', {}, id)} />
    ) : (
      <Invoices key={route.params.status || 'all'} role={me.role} initialStatus={route.params.status || 'all'} openInvoice={(id) => go('invoices', {}, id)} />
    ),
  invoicing: ({ go, me }) => <InvoiceSettings role={me.role} openTax={() => go('tax')} openPayments={() => go('payments')} />,
  catalogue: ({ me }) => <AppCatalogue role={me.role} />,
  sample: ({ go, me }) => <SampleCompany role={me.role} openLinks={() => go('links')} />,
  emailAddresses: ({ me }) => <EmailAddresses role={me.role} />,
  emailTemplates: ({ me }) => <EmailTemplates role={me.role} />,
  emailLog: ({ route, go, me }) => <EmailLog key={route.params.status || 'all'} role={me.role} initialStatus={route.params.status || 'all'} openCustomer={(id) => go('customers', {}, id)} />,
  staff: ({ me }) => <Staff me={me} />,
  tickets: ({ route, go, me }) =>
    route.id ? (
      <TicketPage key={route.id} id={route.id} me={me} back={() => go('tickets')} openCustomer={(id) => go('customers', {}, id)} lookUp={(request) => go('health', { request })} />
    ) : (
      <Tickets key={route.params.status || 'active'} me={me} initialStatus={route.params.status || 'active'} openTicket={(id) => go('tickets', {}, id)} />
    ),
  health: ({ route, go }) => <Health key={route.params.request || ''} go={go} request={route.params.request || ''} />,
  audit: ({ go }) => <AuditLog openCustomer={(id) => go('customers', {}, id)} />,
};

/* The address is the place: #/customers/<id>/users. Back and reload keep it. */
export function parseRoute(hash) {
  const [path, query = ''] = String(hash || '').replace(/^#\/?/, '').split('?');
  const [page, id, tab] = path.split('/').map((s) => decodeURIComponent(s || ''));
  return { page: page || 'home', id: id || '', tab: tab || '', params: Object.fromEntries(new URLSearchParams(query)) };
}
export function routeHash({ page, id, tab, params }) {
  const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v)).toString();
  return `#/${[page, id, tab].filter(Boolean).map(encodeURIComponent).join('/')}${qs ? `?${qs}` : ''}`;
}

/* ----------------------------------------------------------------- frame */
/* On ops.clor.in the customer workspace is another host; on /ops (local) it is this one. */
const OPS_HOST = typeof window !== 'undefined' && window.location.hostname.split('.')[0] === 'ops';
const WORKSPACE_URL = OPS_HOST ? 'https://app.clor.in' : '/';

/**
 * An operator without an authenticator sets one up here, rather than being
 * sent to a company's profile page they may not have. Scan, type a code back,
 * keep the recovery codes; then the console opens.
 */
function EnrolAuthenticator({ onDone }) {
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e?.message || 'Not done.'));
    } finally {
      setBusy(false);
    }
  };
  /* The password first, so a stolen session cannot put someone else's authenticator on the console. */
  const begin = (e) => {
    e.preventDefault();
    act(async () => {
      const r = await opsStartTwoFactor(password);
      setPassword('');
      setSetup(r);
      setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 192 }));
    });
  };
  const confirm = (e) => {
    e.preventDefault();
    act(async () => {
      const r = await opsEnableTwoFactor(code.trim());
      setCodes(r.recoveryCodes);
      setSetup(null);
    });
  };

  if (codes) {
    return (
      <div className="ops-enrol">
        <p className="ws-card-blurb">Your authenticator is on. These recovery codes each work once if you lose your phone. Keep them somewhere safe; they are not shown again.</p>
        <div className="ops-enrol-codes">
          {codes.map((c) => <span key={c} className="ui-mono">{c}</span>)}
        </div>
        <button type="button" className="ws-btn ws-btn--primary" onClick={onDone}>I have saved them — open the console</button>
      </div>
    );
  }
  return (
    <div className="ops-enrol">
      <p className="ws-card-blurb">Clor operators sign in with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password). Set one up now; it takes a minute.</p>
      {setup ? (
        <form onSubmit={confirm} className="ops-enrol-scan">
          {qr ? <img src={qr} alt="QR code to scan with your authenticator app" width={192} height={192} /> : null}
          <div className="ops-enrol-steps">
            <p>Scan this with your authenticator app, then type the six-digit code it shows.</p>
            <p className="ws-card-blurb">Can’t scan? Enter this key: <span className="ui-mono" style={{ wordBreak: 'break-all' }}>{setup.secret}</span></p>
            <div className="flex gap-2">
              <input className="ui-input ui-num w-36 text-center tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" aria-label="Code from the app" value={code} onChange={(e) => { setCode(e.target.value); setError(''); }} autoFocus />
              <button type="submit" className="ws-btn ws-btn--primary" disabled={busy || code.trim().length !== 6}>Turn on</button>
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={begin} className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Your password</span>
            <input type="password" className="ui-input" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} required />
          </label>
          <button type="submit" className="ws-btn ws-btn--primary" disabled={busy || !password}>
            <KeyRound size={16} aria-hidden="true" /> Set up an authenticator app
          </button>
        </form>
      )}
      {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
    </div>
  );
}

function Console() {
  const { user, signOut } = useSession();
  const [me, setMe] = useState(null);
  const [refused, setRefused] = useState(null);
  const [route, setRoute] = useState(() => parseRoute(typeof window !== 'undefined' ? window.location.hash : ''));
  const [menuOpen, setMenuOpen] = useState(false);
  const [reload, setReload] = useState(0);

  /* Signing in can leave a company's address behind (/o/CLOR-…); the console has no such pages. */
  useEffect(() => {
    if (/^\/o\//.test(window.location.pathname)) window.history.replaceState({}, '', `${OPS_HOST ? '/' : '/ops'}${window.location.hash}`);
  }, []);
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!user) return;
    opsMe()
      .then(setMe)
      .catch((e) => setRefused({ code: e?.code || e?.data?.code, message: String(e?.message || e) }));
  }, [user, reload]);

  const go = useCallback((page, params = {}, id = '', tab = '', replace = false) => {
    const next = { page, id, tab, params };
    const hash = routeHash(next);
    if (replace) window.history.replaceState(null, '', hash);
    else window.history.pushState(null, '', hash);
    setRoute(parseRoute(hash));
    setMenuOpen(false);
    if (!replace) window.scrollTo(0, 0);
  }, []);

  if (refused) {
    const needsCode = refused.code === 'TWO_FACTOR_SETUP_REQUIRED';
    return (
      <div className="ops-refused">
        <ClorLogo size={28} />
        <h1 className="ws-title">{needsCode ? 'Set up your authenticator' : 'This page is for CLOR staff'}</h1>
        {needsCode ? (
          <EnrolAuthenticator onDone={() => { setRefused(null); setReload((n) => n + 1); }} />
        ) : (
          <p className="ws-card-blurb">{refused.message}</p>
        )}
        <div className="flex gap-2">
          <a className="ws-btn ws-btn--quiet" href={WORKSPACE_URL}>Go to your workspace</a>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }

  if (!me) return <p className="ws-card-blurb" style={{ padding: 24 }}>Loading…</p>;

  const allowed = ([key, , , only]) => Boolean(SCREENS[key]) && (!only || me.role === only);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length);
  const has = (key) => groups.some((g) => g.items.some(([k]) => k === key));
  const page = has(route.page) ? route.page : 'home';
  const Screen = SCREENS[page];
  return (
    <div className="ops">
      <header className="ops-bar-top">
        <button type="button" className="ui-icon-btn ops-menu-btn" aria-label={menuOpen ? 'Close menu' : 'Menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
          {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
        </button>
        <ClorLogo size={22} />
        <span className="ops-badge">Operator</span>
        <OpsSearch go={go} />
        <span className="ops-who">{me.user.fullName} · {ROLE[me.role] || me.role}</span>
        <button type="button" className="ui-icon-btn" aria-label="Sign out" title={`Sign out ${me.user.fullName} · ${ROLE[me.role] || me.role}`} onClick={signOut}>
          <LogOut size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="ops-shell">
        <nav className="ops-side" data-open={menuOpen || undefined} aria-label="Operator console">
          {groups.map((g, i) => (
            <div key={g.label || i} className="ops-group">
              {g.label ? <span className="ops-group-label">{g.label}</span> : null}
              {g.items.map(([k, label, Icon]) => (
                <button key={k} type="button" className="ops-nav-item" aria-current={page === k ? 'page' : undefined} onClick={() => go(k)}>
                  <Icon size={18} /> {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        {menuOpen ? <button type="button" className="ops-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} /> : null}
        <main className="ws">
          <div className="ws-inner">
            <Screen key={`${page}/${route.id}`} route={page === route.page ? route : { page, id: '', tab: '', params: {} }} go={go} has={has} me={me} />
          </div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}

/* The console draws in the icon family of every app but Accounting (owner, 9 Nov 2026): two-tone marks, Fluent line icons. */
export default function OpsConsole() {
  return (
    <IconSetContext.Provider value="duo">
      <LineSetContext.Provider value="fluent">
        <OpsScreens />
      </LineSetContext.Provider>
    </IconSetContext.Provider>
  );
}

function OpsScreens() {
  const { user, restoring } = useSession();
  if (restoring) return null;
  if (!user) {
    return (
      <SignIn
        brand={<OperatorBrand />}
        subtitle="Clor staff sign in here with an authenticator."
        onHome={() => (window.location.href = 'https://clor.in')}
        onForgot={() => (window.location.href = 'https://app.clor.in/forgot-password')}
      />
    );
  }
  return <Console />;
}
