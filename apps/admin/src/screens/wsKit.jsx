import React from 'react';
import { ArrowLeft, ChevronRight } from '@ui/components/ui/lineIcons';
import { BookOpenRegular, CalendarCheckmarkRegular, FlagRegular, PersonRegular, TimerRegular } from '@fluentui/react-icons';
import { requestOpenScreen } from '@platform/context';
import {
  Bell,
  BookOpen,
  Books,
  Briefcase,
  BuildingOffice,
  Buildings,
  CalendarDots,
  ChatCircle,
  Tray,
  ClockCounterClockwise,
  CreditCard,
  Database,
  EnvelopeSimple,
  FileText,
  Fingerprint,
  GearSix,
  House,
  Lightbulb,
  Lightning,
  Receipt,
  Shield,
  ShieldCheck,
  SquaresFour,
  User,
  UserPlus,
  UsersFour,
  UsersThree,
  Wallet,
  Warning,
} from '@phosphor-icons/react';

import Drawer from '@ui/components/ui/Drawer';
import { duoSet } from '@ui/components/ui/duoIcon';
import './workspace.css';

/**
 * The Workspace's page kit (redesign W-R2): one page head, stat, panel and
 * meter, so every Workspace page is built from the same few pieces. Icons are
 * People's two-tone Phosphor marks (owner, 9 Nov 2026: one icon family in every
 * app but Accounting); line icons stay for small affordances (chevrons).
 */
export const ICON = duoSet({
  home: House,
  inbox: Tray,
  company: BuildingOffice,
  companies: Buildings,
  people: UsersThree,
  team: UsersFour,
  person: User,
  invite: UserPlus,
  mail: EnvelopeSimple,
  security: Shield,
  secure: ShieldCheck,
  history: ClockCounterClockwise,
  plan: Receipt,
  payments: CreditCard,
  data: Database,
  apps: SquaresFour,
  settings: GearSix,
  alert: Bell,
  automation: Lightning,
  warning: Warning,
  help: Lightbulb,
  guide: FileText,
  library: Books,
  chat: ChatCircle,
  /* Products, as clor.in names them, each its own app tile's mark. */
  accounting: BookOpen,
  payroll: Wallet,
  people_app: UsersThree,
  attendance: Fingerprint,
  projects: Briefcase,
  timesheet: CalendarDots,
}, 20);

/**
 * The Workspace side panel: one width, the Workspace colours and field styles,
 * and the panel's actions in a footer that stays in view under a long form.
 */
export function WsDrawer({ actions = null, widthClass = 'w-[min(40rem,94vw)]', children, ...rest }) {
  return (
    <Drawer widthClass={widthClass} {...rest}>
      <div className="ws ws-drawer">
        {children}
        {actions ? <div className="ws-drawer-foot">{actions}</div> : null}
      </div>
    </Drawer>
  );
}

/** A product's icon, by app id. */
export const productIcon = (id) => ICON[id === 'people' ? 'people_app' : id] || ICON.apps;

/* Where a breadcrumb's section name leads: each module's own first page. */
const SECTION_HOME = { Overview: 'home', Company: 'companies', Access: 'accessHome', Security: 'securityHome', Plan: 'account', Data: 'dataHome' };
const openWorkspace = (screen) => requestOpenScreen(screen);

/**
 * Back to wherever the person came from. The Workspace records each page in
 * the browser history, so history.back() returns exactly there; arriving
 * from a link (no history in this tab) falls back to the section's own page.
 */
export function goBack(fallback = 'home') {
  if (window.history.length > 1) window.history.back();
  else openWorkspace(fallback);
}

/** Page head: where you are, what this page is, its one primary action. */
/**
 * `scope="account"` marks a page that covers every company in the account
 * (Companies, Members, Plan…); every other Workspace page acts on the company
 * chosen in the bar, which the bar names.
 */
export function PageHead({ crumbs = [], title, description, meta, actions, scope }) {
  const section = crumbs[0];
  /* A section's own Overview page is a top: it has nowhere to go back to. */
  const isTop = crumbs.length < 2 || crumbs[crumbs.length - 1] === 'Overview';
  return (
    <header className="ws-head">
      <div style={{ minWidth: 0 }}>
        {crumbs.length ? (
          <div className="ws-crumbs-row" data-depth={crumbs.length}>
            {isTop ? null : (
              <button type="button" className="ws-back" onClick={() => goBack(SECTION_HOME[section] || 'home')} aria-label="Back" title="Back">
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
            )}
            <nav className="ws-crumbs" aria-label="Breadcrumb">
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                const to = SECTION_HOME[c];
                return (
                  <React.Fragment key={`${c}-${i}`}>
                    {i ? <ChevronRight size={14} aria-hidden="true" /> : null}
                    {!last && to ? (
                      <button type="button" className="ws-crumb-link" onClick={() => openWorkspace(to)}>{c}</button>
                    ) : (
                      <span aria-current={last ? 'page' : undefined}>{c}</span>
                    )}
                  </React.Fragment>
                );
              })}
            </nav>
          </div>
        ) : null}
        <h1 className="ws-title">
          {title}
          {scope === 'account' ? <span className="ws-scope">All companies</span> : null}
        </h1>
        {description ? <p className="ws-lede">{description}</p> : null}
      </div>
      {meta || actions ? (
        <div className="grid gap-2 justify-items-end">
          {meta ? <span className="ws-head-meta">{meta}</span> : null}
          {actions ? <div className="ws-actions">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}

/** A number that matters, as a way in when it has somewhere to go. */
export function Stat({ icon: Icon, tone, label, value, note, onOpen }) {
  const body = (
    <>
      <span className={`ws-tile${tone ? ` ws-tile--${tone}` : ''}`} aria-hidden="true">
        {Icon ? <Icon size={20} /> : null}
      </span>
      <span className="ws-stat-label">{label}</span>
      {onOpen ? <ChevronRight size={16} aria-hidden="true" className="ws-chev" style={{ opacity: 1 }} /> : <span />}
      <span className="ws-stat-value" style={{ gridColumn: '2 / span 2' }}>{value}</span>
      {note ? <span className="ws-stat-note" style={{ gridColumn: '2 / span 2' }}>{note}</span> : null}
    </>
  );
  return onOpen ? (
    <button type="button" className="ws-stat" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="ws-stat">{body}</div>
  );
}

/** A titled block; `action` is a small link on the right. */
export function Panel({ title, action, children, labelledBy }) {
  const id = labelledBy || `ws-panel-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className="ws-panel" aria-labelledby={id}>
      <div className="ws-panel-head">
        <h2 id={id} className="ws-panel-title">{title}</h2>
        {action || null}
      </div>
      {children}
    </section>
  );
}

/** Usage against an allowance; an unlimited allowance says so instead of drawing a bar. */
export function Meter({ label, used, limit }) {
  const unlimited = limit == null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((Number(used) / Math.max(1, Number(limit))) * 100));
  return (
    <div className="ws-meter">
      <div className="ws-meter-row">
        <span>{label}</span>
        <strong>{unlimited ? `${used} · no limit` : `${used} / ${limit}`}</strong>
      </div>
      {unlimited ? null : (
        <div className="ws-meter-bar" role="meter" aria-valuemin={0} aria-valuemax={Number(limit)} aria-valuenow={Number(used)} aria-label={label}>
          <span style={{ width: `${pct}%` }} data-tight={pct >= 80 ? '' : undefined} />
        </div>
      )}
    </div>
  );
}

/** A session's device in words — "Chrome on Mac" — from its user agent; "Script or API client" for curl and the like. */
export function device(ua = '') {
  const u = String(ua);
  if (!u) return 'Unknown device';
  if (/curl|wget|python|node|axios|okhttp|postman/i.test(u)) return 'Script or API client';
  const browser = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(u) ? 'iPhone' : /Android/.test(u) ? 'Android' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** "3 hours ago" from a date, in words. */
export function ago(d) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/* ------------------------------------------------------------------ R&D kit
 * README §2–5 (14 Nov 2026): app marks in the app's colour, status pills that
 * always carry a word, KPI tiles, seat meters and initials avatars.
 */

/** Every CLOR app the Workspace speaks of: its name, its identity colour token and its mark. */
export const APP_INFO = {
  accounting: { name: 'Accounting', color: '--app-accounting', glyph: BookOpenRegular },
  people: { name: 'People', color: '--app-people', glyph: PersonRegular },
  payroll: { name: 'Payroll', color: '--app-payroll', glyph: null, text: '₹' },
  attendance: { name: 'Attendance', color: '--app-attendance', glyph: CalendarCheckmarkRegular },
  projects: { name: 'Projects', color: '--app-projects', glyph: FlagRegular },
  timesheet: { name: 'Timesheet', color: '--app-timesheet', glyph: TimerRegular },
};
/* Older ids for the same apps. */
const APP_ALIAS = { books: 'accounting', hr: 'people', time: 'attendance', clortime: 'attendance' };
export const appInfo = (id) => APP_INFO[APP_ALIAS[id] || id] || null;
export const appName = (id) => appInfo(id)?.name || (id ? String(id).charAt(0).toUpperCase() + String(id).slice(1) : '');

/** An app's square mark: white glyph on the app colour; `off` greys it (not in the plan). */
export function AppMark({ app, size = 24, off = false, title }) {
  const info = appInfo(app);
  const Glyph = info?.glyph;
  const label = title ?? info?.name ?? app;
  return (
    <span
      className="ws-appmark"
      data-off={off || undefined}
      role="img"
      aria-label={label}
      title={label}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55), borderRadius: size >= 32 ? 8 : 6, ...(info ? { '--app': `var(${info.color})` } : {}) }}
    >
      {Glyph ? <Glyph style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }} aria-hidden="true" /> : <span aria-hidden="true">{info?.text || String(label || '?').charAt(0)}</span>}
    </span>
  );
}

/** A neutral tag with a square in an app's colour: role tags, app tags in tables. */
export function AppTag({ app, children }) {
  const info = appInfo(app);
  return (
    <span className="ws-tag" style={info ? { '--tag': `var(${info.color})` } : undefined}>
      <i aria-hidden="true" />
      {children ?? info?.name ?? app}
    </span>
  );
}

/** State, said in words: tone is ok | warn | danger | neutral. */
export function StatusPill({ tone = 'neutral', children, title }) {
  return (
    <span className={`ws-pill ws-pill--${tone}`} title={title}>
      {children}
    </span>
  );
}

const CAT = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7', '--cat-8'];
/** Initials from a name or an email. */
export const initials = (name = '') => {
  const words = String(name).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
};
/** A person's initials on a soft fill, the colour fixed by their name. */
export function Avatar({ name, size, ink = false }) {
  const key = String(name || '');
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (
    <span className="ws-avatar" data-size={size} data-ink={ink || undefined} style={{ '--av': `var(${CAT[h % CAT.length]})` }} aria-hidden="true">
      {initials(key)}
    </span>
  );
}

/** A KPI tile: identity colour (categorical, 1–8) on the top accent and the chip; the number stays ink. */
export function KpiTile({ cat = 1, label, value, note, icon: Icon }) {
  return (
    <div className="ws-kpi" style={{ '--kpi': `var(--cat-${cat})` }}>
      <div className="ws-kpi-head">
        <span className="ws-kpi-chip" aria-hidden="true">{Icon ? <Icon size={18} /> : <i />}</span>
        <span className="ws-kpi-label">{label}</span>
      </div>
      <span className="ws-kpi-value">{value}</span>
      {note ? <span className="ws-kpi-note">{note}</span> : null}
    </div>
  );
}

/** Where a seat count stands: near at 90%, over past the limit. */
export const seatState = (used, limit) => (limit == null ? 'ok' : Number(used) > Number(limit) ? 'over' : Number(used) / Math.max(1, Number(limit)) >= 0.9 ? 'near' : 'ok');

/** One app's seats: mark and name, an 8px meter in the app colour with what a seat is, the count and its state. */
export function SeatRow({ app, used, limit, unit = 'users', note }) {
  const info = appInfo(app);
  const state = seatState(used, limit);
  const pct = limit == null ? 0 : Math.min(100, Math.round((Number(used) / Math.max(1, Number(limit))) * 100));
  const label = `${info?.name || app} seats`;
  return (
    <div className="ws-seat">
      <span className="ws-seat-app">
        <AppMark app={app} size={28} />
        {info?.name || app}
      </span>
      <span className="ws-seat-track">
        {limit == null ? null : (
          <span className="ws-meter-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Number(limit)} aria-valuenow={Number(used)} style={info ? { '--meter': `var(${info.color})` } : undefined}>
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
        {note ? <span className="ws-seat-note">{note}</span> : null}
      </span>
      <span className="ws-seat-value" data-state={state}>
        {limit == null ? `${used} ${unit} · no limit` : `${used} / ${limit} ${unit}`}
      </span>
      <span className="ws-seat-state">
        {state === 'over' ? <StatusPill tone="danger">Over limit</StatusPill> : state === 'near' ? <StatusPill tone="warn">Near limit</StatusPill> : <StatusPill tone="ok">OK</StatusPill>}
      </span>
    </div>
  );
}
