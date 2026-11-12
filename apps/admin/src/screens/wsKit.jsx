import React from 'react';
import { ArrowLeft, ChevronRight } from '@ui/components/ui/lineIcons';
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
          <div className="ws-crumbs-row">
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
