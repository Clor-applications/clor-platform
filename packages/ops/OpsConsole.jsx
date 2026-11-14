import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, KeyRound, LogOut, Menu, X } from '@ui/components/ui/lineIcons';
import QRCode from 'qrcode';
import {
  AlertUrgentColor,
  ApprovalsAppColor,
  AppsColor,
  ArrowSyncColor,
  BuildingGovernmentColor,
  BuildingPeopleColor,
  BuildingStoreColor,
  CalendarClockColor,
  CalendarPeopleColor,
  ChatMultipleColor,
  CommentMultipleColor,
  CoinMultipleColor,
  DataBarVerticalAscendingColor,
  DatabaseColor,
  DocumentEditColor,
  DocumentTextColor,
  DraftsColor,
  FormColor,
  GaugeColor,
  GiftColor,
  GlobeColor,
  HistoryColor,
  LinkColor,
  LockShieldColor,
  MailClockColor,
  MailColor,
  MegaphoneLoudColor,
  OptionsColor,
  PeopleCommunityColor,
  PeopleListColor,
  PeopleTeamColor,
  PersonKeyColor,
  ReceiptColor,
  SettingsColor,
  ShieldColor,
  VaultColor,
} from '@fluentui/react-icons';

import { ClorLogo, ClorMark } from '@ui/components/brand';
import { colorSet } from '@ui/components/ui/colorIcon';
import { IconSetContext, LineSetContext } from '@ui/components/ui/iconSet';
import Toaster from '@ui/components/ui/Toaster';
import '../../apps/admin/src/screens/workspace.css';
import './ops.css';
import { useSession } from '../shell/session';
import SignIn from '../shell/SignIn';
import { DemoRequestDetail, DemoRequests } from './DemoRequests';
import { Payments } from './Payments';
import { InvoicePage, Invoices } from './Invoices';
import { InvoiceSettings } from './InvoiceSettings';
import { Trials } from './Trials';
import { Pricing } from './Pricing';
import { Settings as TaxSettings } from './Settings';
import { Insights } from './Insights';
import { SavedReplies } from './SavedReplies';
import { StatusPage } from './StatusPage';
import { Switches } from './Switches';
import { ExploreLinks, SampleCompany } from './Explore';
import { CustomerPage, Customers } from './Customers';
import { Home } from './Home';
import { Staff } from './Staff';
import { EmailAddresses, EmailLog, EmailTemplates } from './Email';
import { AppCatalogue } from './AppCatalogue';
import { AuditLog } from './AuditLog';
import { Health } from './Health';
import { TicketPage, Tickets } from './Tickets';
import { Alerts } from './Alerts';
import { Announcements } from './Announcements';
import { CustomPlans } from './CustomPlans';
import { Offers } from './Offers';
import { Subscriptions } from './Deals';
import { Approvals } from './Approvals';
import { AccessRequests } from './AccessRequests';
import { OpsSearch } from './OpsSearch';
import { Denials, FeatureSwitches, Organisations, Users } from './Lists';
import { ROLE } from './kit';
import { opsEnableTwoFactor, opsMe, opsMySupportGrants, opsOverview, opsStartTwoFactor } from './api';

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
/* Fluent colour icons for the rail and the panel (R&D hand-off §4); controls stay on the line set. */
const NI = colorSet(
  {
    overview: GaugeColor,
    insights: DataBarVerticalAscendingColor,
    savedReplies: CommentMultipleColor,
    status: GlobeColor,
    forms: FormColor,
    accounts: BuildingPeopleColor,
    orgs: PeopleCommunityColor,
    users: PeopleListColor,
    denials: ShieldColor,
    switches: OptionsColor,
    subscriptions: ReceiptColor,
    tickets: ChatMultipleColor,
    trials: CalendarClockColor,
    demos: CalendarPeopleColor,
    links: LinkColor,
    jobs: ArrowSyncColor,
    alerts: AlertUrgentColor,
    pricing: CoinMultipleColor,
    customPlans: DocumentEditColor,
    offers: GiftColor,
    invoices: DocumentTextColor,
    payments: VaultColor,
    tax: BuildingGovernmentColor,
    invoicing: SettingsColor,
    catalogue: AppsColor,
    sample: BuildingStoreColor,
    announcements: MegaphoneLoudColor,
    emailAddresses: MailColor,
    emailTemplates: DraftsColor,
    emailLog: MailClockColor,
    audit: HistoryColor,
    access: PersonKeyColor,
    approvals: ApprovalsAppColor,
    staff: PeopleTeamColor,
    trust: HistoryColor,
    data: DatabaseColor,
    domain: LockShieldColor,
  },
  20,
);

/*
 * The rail: five sections (Overview · Customers · Platform · Trust · Billing
 * and setup). Each opens its first page and lights up while you are on any of
 * its pages; the panel beside it lists every page, in groups.
 */
export const RAIL = [
  ['overview', 'Overview', NI.overview],
  ['customers', 'Customers and sales', NI.accounts],
  ['platform', 'Platform', NI.jobs],
  ['trust', 'Trust', NI.trust],
  ['setup', 'Billing and setup', NI.data],
];

/*
 * The menu, in groups. A screen is listed only when this console has it
 * (SCREENS below). Keys are the addresses (#/customers), kept from before the
 * R&D names so old links still open: Accounts is #/customers, Jobs & workers
 * is #/health, Staff audit log is #/audit.
 */
export const NAV = [
  { rail: 'overview', items: [['home', 'Overview', NI.overview], ['insights', 'Insights', NI.insights]] },
  {
    label: 'Customers',
    rail: 'customers',
    items: [
      ['customers', 'Accounts', NI.accounts],
      ['orgs', 'Organizations', NI.orgs],
      ['users', 'Users', NI.users],
      ['subscriptions', 'Subscriptions', NI.subscriptions],
      ['tickets', 'Tickets', NI.tickets],
      ['savedReplies', 'Saved replies', NI.savedReplies],
    ],
  },
  {
    label: 'Sales',
    rail: 'customers',
    items: [
      ['trials', 'Trials', NI.trials],
      ['demos', 'Demo requests', NI.demos],
      ['links', 'Explore links', NI.links],
    ],
  },
  {
    label: 'Platform',
    rail: 'platform',
    items: [
      ['health', 'Jobs & workers', NI.jobs],
      ['denials', 'Entitlement denials', NI.denials],
      ['switches', 'Feature switches', NI.switches],
      ['alerts', 'Alerts', NI.alerts],
      ['status', 'Status page', NI.status],
    ],
  },
  {
    label: 'Comms',
    rail: 'platform',
    items: [
      ['announcements', 'Announcements', NI.announcements],
      ['emailAddresses', 'Email addresses', NI.emailAddresses],
      ['emailTemplates', 'Email templates', NI.emailTemplates],
      ['emailLog', 'Email log', NI.emailLog],
    ],
  },
  {
    label: 'Trust',
    rail: 'trust',
    items: [
      ['audit', 'Staff audit log', NI.audit],
      ['access', 'Access requests', NI.access],
      ['approvals', 'Approvals', NI.approvals],
      ['staff', 'Staff and roles', NI.staff, 'SUPER_ADMIN'],
    ],
  },
  {
    label: 'Billing',
    rail: 'setup',
    items: [
      ['pricing', 'Pricing', NI.pricing],
      ['customPlans', 'Custom plans', NI.customPlans],
      ['offers', 'Offers', NI.offers],
      ['invoices', 'Invoices', NI.invoices],
      ['payments', 'Payments', NI.payments],
      ['gateways', 'Gateways', NI.payments],
      ['tax', 'Tax', NI.tax],
      ['invoicing', 'Invoice settings', NI.invoicing],
    ],
  },
  {
    label: 'Product',
    rail: 'setup',
    items: [
      ['catalogue', 'App catalogue', NI.catalogue],
      ['sample', 'Sample company', NI.sample],
      ['forms', 'Forms on clor.in', NI.forms],
    ],
  },
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
        openLink={(l) => go(l.page, {}, l.id || '')}
        openDenials={(account) => go('denials', { account })}
        openOrgs={(account) => go('orgs', { account })}
      />
    ) : (
      <Customers key={`${route.params.status || 'all'}|${route.params.tag || ''}`} initialStatus={route.params.status || 'all'} initialTag={route.params.tag || ''} openCustomer={(id) => go('customers', {}, id)} />
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
  customPlans: ({ go, me }) => <CustomPlans role={me.role} openCustomer={(id) => go('customers', {}, id)} />,
  offers: ({ me }) => <Offers role={me.role} />,
  subscriptions: ({ go }) => <Subscriptions openCustomer={(id) => go('customers', {}, id, 'subscription')} />,
  /* Lists across every account (R&D OPS-05, 06, 08, 09): read-only; changes stay on the account's own page. */
  orgs: ({ route, go }) => <Organisations account={route.params.account || ''} openAccount={(id) => go('customers', {}, id)} clearAccount={() => go('orgs', {}, '', '', true)} />,
  users: ({ go }) => <Users openAccount={(id) => go('customers', {}, id, 'users')} />,
  denials: ({ route, go }) => <Denials account={route.params.account || ''} openAccount={(id) => go('customers', {}, id)} clearAccount={() => go('denials', {}, '', '', true)} />,
  switches: ({ go }) => <FeatureSwitches openAccount={(id) => go('customers', {}, id, 'limits')} />,
  approvals: ({ go }) => <Approvals openCustomer={(id) => go('customers', {}, id, 'subscription')} />,
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
  alerts: ({ go, me }) => <Alerts go={go} me={me} />,
  announcements: ({ me }) => <Announcements me={me} />,
  insights: () => <Insights />,
  savedReplies: ({ me }) => <SavedReplies me={me} />,
  status: ({ me }) => <StatusPage me={me} />,
  forms: ({ me }) => <Switches me={me} />,
  health: ({ route, go }) => <Health key={route.params.request || ''} go={go} request={route.params.request || ''} />,
  audit: ({ go }) => <AuditLog openCustomer={(id) => go('customers', {}, id)} />,
  access: ({ go }) => <AccessRequests openCustomer={(id) => go('customers', {}, id, 'access')} />,
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
      <p className="ws-card-blurb">CLOR operators sign in with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password). Set one up now; it takes a minute.</p>
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
  const [counts, setCounts] = useState({});

  /* The Ops portal theme (forest, R&D 14 Nov 2026): rnd.css keys it off <html data-portal="ops">. */
  useEffect(() => {
    document.documentElement.setAttribute('data-portal', 'ops');
    return () => document.documentElement.removeAttribute('data-portal');
  }, []);

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

  /* The counts beside Accounts, Organizations, Users and Access requests. Either may fail (a role that cannot see it); the menu simply shows none. */
  useEffect(() => {
    if (!me) return;
    let live = true;
    opsOverview()
      .then((o) => live && setCounts((c) => ({ ...c, customers: o?.accounts || 0, orgs: o?.companies || 0, users: o?.users || 0 })))
      .catch(() => {});
    opsMySupportGrants()
      .then((r) => live && setCounts((c) => ({ ...c, access: (r?.grants || []).filter((g) => g.state === 'PENDING').length })))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [me]);

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
  const section = groups.find((g) => g.items.some(([k]) => k === page))?.rail || 'overview';
  const firstOf = (rail) => groups.find((g) => g.rail === rail)?.items[0]?.[0];
  const roleName = ROLE[me.role] || me.role;
  const name = me.user?.fullName || me.user?.email || 'You';
  return (
    <div className="ops">
      {/* Always drawn, never closable: whoever is looking knows this is the staff console and that every change is on the record. */}
      <div className="ops-staffbar" role="note" aria-label="Staff console">
        <span className="ops-staffbar-pill">Staff</span>
        <span>CLOR Ops · internal · every action is logged with your name and a reason</span>
      </div>
      <div className="ops-frame">
        <nav className="ops-rail" aria-label="Sections">
          <span className="ops-rail-mark" aria-hidden="true">
            <ClorMark size={24} title="" />
          </span>
          {RAIL.filter(([k]) => firstOf(k)).map(([k, label, Icon]) => (
            <button key={k} type="button" className="ops-rail-btn" aria-label={label} title={label} data-current={section === k || undefined} onClick={() => go(firstOf(k))}>
              <Icon size={24} />
            </button>
          ))}
        </nav>
        <nav className="ops-side" data-open={menuOpen || undefined} aria-label="Operator console">
          <div className="ops-side-scroll">
            <div className="ops-side-head">
              <span className="ops-side-title">Ops</span>
              <span className="ops-side-tag">Internal</span>
            </div>
            {groups.map((g, i) => (
              <div key={g.label || i} className="ops-group">
                {g.label ? <span className="ops-group-label">{g.label}</span> : null}
                {g.items.map(([k, label, Icon]) => (
                  <button key={k} type="button" className="ops-nav-item" aria-current={page === k ? 'page' : undefined} onClick={() => go(k)}>
                    <Icon size={20} />
                    <span className="ops-nav-label">{label}</span>
                    {counts[k] ? <span className="ops-nav-count">{counts[k].toLocaleString('en-IN')}</span> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>
        {menuOpen ? <button type="button" className="ops-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} /> : null}
        <div className="ops-col">
          <header className="ops-bar-top">
            <button type="button" className="ui-icon-btn ops-menu-btn" aria-label={menuOpen ? 'Close menu' : 'Menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            </button>
            <OpsSearch go={go} />
            <span className="ops-domain" title="CLOR staff console">
              <NI.domain size={18} aria-hidden="true" />
              ops.clor.in
            </span>
            {has('alerts') ? (
              <button type="button" className="ops-round-btn" aria-label="Alerts" title="Alerts" onClick={() => go('alerts')}>
                <Bell size={18} aria-hidden="true" />
              </button>
            ) : null}
            <Avatar name={name} role={roleName} signOut={signOut} />
          </header>
          <main className="ws ops-main">
            <div className="ws-inner">
              <Screen key={`${page}/${route.id}`} route={page === route.page ? route : { page, id: '', tab: '', params: {} }} go={go} has={has} me={me} />
            </div>
          </main>
        </div>
      </div>
      <Toaster />
    </div>
  );
}

/** The person signed in: their initials, and a small menu with their name, role and Sign out. */
function Avatar({ name, role, signOut }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const initials = String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <div className="ops-avatar-box" ref={box}>
      <button type="button" className="ops-avatar" aria-label={`${name} · ${role}`} title={`${name} · ${role}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        {initials}
      </button>
      {open ? (
        <div className="ops-avatar-menu" role="menu">
          <p className="ops-avatar-who">
            <strong>{name}</strong>
            <span>{role}</span>
          </p>
          <button type="button" role="menuitem" className="ops-avatar-item" onClick={signOut}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      ) : null}
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
        door="ops"
        subtitle="CLOR staff sign in here with an authenticator."
        onHome={() => (window.location.href = 'https://clor.in')}
        onForgot={() => (window.location.href = 'https://app.clor.in/forgot-password')}
      />
    );
  }
  return <Console />;
}
