import React from 'react';
import { ChevronRight } from 'lucide-react';
import {
  AlertColor,
  AppsColor,
  BookColor,
  BriefcaseColor,
  BuildingColor,
  BuildingMultipleColor,
  CalendarCheckmarkColor,
  CalendarClockColor,
  ChatColor,
  DatabaseColor,
  DocumentTextColor,
  HistoryColor,
  HomeColor,
  LibraryColor,
  LightbulbColor,
  MailColor,
  PeopleColor,
  PeopleTeamColor,
  PersonAddColor,
  PersonColor,
  ReceiptColor,
  SettingsColor,
  ShieldCheckmarkColor,
  ShieldColor,
  WarningColor,
} from '@fluentui/react-icons';

import { colorIcon } from '@ui/components/ui/iconSet';

/**
 * The Workspace's page kit (redesign W-R2): one page head, stat, panel and
 * meter, so every Workspace page is built from the same few pieces. Icons are
 * Microsoft Fluent colour icons, the set Clor Attendance draws in
 * (iconSet: 'color'); line icons stay for small affordances (chevrons).
 */
export const ICON = {
  home: colorIcon(HomeColor, 'Home'),
  company: colorIcon(BuildingColor, 'Building'),
  companies: colorIcon(BuildingMultipleColor, 'BuildingMultiple'),
  people: colorIcon(PeopleColor, 'People'),
  team: colorIcon(PeopleTeamColor, 'PeopleTeam'),
  person: colorIcon(PersonColor, 'Person'),
  invite: colorIcon(PersonAddColor, 'PersonAdd'),
  mail: colorIcon(MailColor, 'Mail'),
  security: colorIcon(ShieldColor, 'Shield'),
  secure: colorIcon(ShieldCheckmarkColor, 'ShieldCheckmark'),
  history: colorIcon(HistoryColor, 'History'),
  plan: colorIcon(ReceiptColor, 'Receipt'),
  data: colorIcon(DatabaseColor, 'Database'),
  apps: colorIcon(AppsColor, 'Apps'),
  settings: colorIcon(SettingsColor, 'Settings'),
  alert: colorIcon(AlertColor, 'Alert'),
  warning: colorIcon(WarningColor, 'Warning'),
  help: colorIcon(LightbulbColor, 'Lightbulb'),
  guide: colorIcon(DocumentTextColor, 'DocumentText'),
  library: colorIcon(LibraryColor, 'Library'),
  chat: colorIcon(ChatColor, 'Chat'),
  /* Products, as clor.in names them. */
  accounting: colorIcon(BookColor, 'Book'),
  payroll: colorIcon(ReceiptColor, 'Receipt'),
  people_app: colorIcon(PeopleTeamColor, 'PeopleTeam'),
  attendance: colorIcon(CalendarCheckmarkColor, 'CalendarCheckmark'),
  projects: colorIcon(BriefcaseColor, 'Briefcase'),
  timesheet: colorIcon(CalendarClockColor, 'CalendarClock'),
};

/** A product's icon, by app id. */
export const productIcon = (id) => ICON[id === 'people' ? 'people_app' : id] || ICON.apps;

/** Page head: where you are, what this page is, its one primary action. */
export function PageHead({ crumbs = [], title, description, meta, actions }) {
  return (
    <header className="ws-head">
      <div style={{ minWidth: 0 }}>
        {crumbs.length ? (
          <nav className="ws-crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <React.Fragment key={`${c}-${i}`}>
                {i ? <ChevronRight size={14} aria-hidden="true" /> : null}
                <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c}</span>
              </React.Fragment>
            ))}
          </nav>
        ) : null}
        <h1 className="ws-title">{title}</h1>
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
