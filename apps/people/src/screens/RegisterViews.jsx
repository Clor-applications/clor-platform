import React, { useRef, useState } from 'react';
import {
  BookOpenLightbulb20Color, Calendar20Color, CalendarClock20Color, CheckmarkCircle20Color, CoinMultiple20Color, Drafts20Color,
  Food20Color, Gift20Color, Heart20Color, Laptop20Color, MegaphoneLoud20Color, People20Color, PersonWarning20Color, Savings20Color,
  ShieldCheckmark20Color, Toolbox20Color,
} from '@fluentui/react-icons';
import { MoreHorizontal } from '@ui/components/ui/lineIcons';
import Popover from '@ui/components/ui/Popover';
import { colorSet } from '@ui/components/ui/colorIcon';
import { formatDate } from '@ui/components/ui/DatePicker';
import { KpiTiles, Meter } from '../components/Core';
import { statusName, statusPill } from './workspaceConfig';
import { symbolOf } from './symbols';
import {
  announcementFigures, assetFigures, benefitFigures, eventFigures, planEnrolment, reachOf, toRecover,
} from './registerFigures';
import './registers.css';

/**
 * What makes each register look like its R&D design (clor-rnd PEOPLE-08 Assets, 10 Benefits, 22 Announcements,
 * 23 Events): the figures over the list, the asset and enrolment columns, the benefit plan cards, the announcement
 * feed and the dated event list. WorkspaceList keeps the data, the drawer, search, tabs, export and permissions.
 */

const ICON = colorSet({
  laptop: Laptop20Color, team: People20Color, store: Toolbox20Color, recover: PersonWarning20Color,
  gift: Gift20Color, heart: Heart20Color, coin: CoinMultiple20Color, life: ShieldCheckmark20Color, food: Food20Color,
  savings: Savings20Color, learn: BookOpenLightbulb20Color, post: MegaphoneLoud20Color, draft: Drafts20Color,
  calendar: Calendar20Color, soon: CalendarClock20Color, done: CheckmarkCircle20Color,
}, 20);

const day = (v) => (v ? formatDate(String(v).slice(0, 10)) : '');
/** "20 Nov" for a date this year, "4 Jan 2027" otherwise. */
const short = (v, today) => {
  const d = String(v || '').slice(0, 10);
  if (!d) return '';
  const full = formatDate(d);
  return d.slice(0, 4) === today.slice(0, 4) ? full.replace(/\s\d{4}$/, '') : full;
};
const weekday = (v) => new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
const monthWord = (v) => new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A status with its word, in the register's own tones. */
export function StatusPill({ cfg, status, children = null, tone = null }) {
  return <span className={`ui-pill ${tone ? `ui-pill-${tone}` : statusPill(cfg, status)}`}>{children || statusName(cfg, status)}</span>;
}

/** The "…" menu on a card or a list line: the same items the table's row menu offers. */
export function ItemMenu({ label, items }) {
  const shown = items.filter(Boolean);
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const list = useRef(null);
  if (!shown.length) return null;
  const onKey = (e) => {
    const all = [...(list.current?.querySelectorAll('[role="menuitem"]') || [])];
    const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <>
      <button ref={btn} type="button" className="ui-icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open ? (
        <Popover anchorRef={btn} onClose={() => setOpen(false)} minWidth={160} maxWidth={240}>
          <div ref={list} role="menu" aria-label={label} className="ui-menu" onKeyDown={onKey}>
            {shown.map((it, i) => (
              <button key={it.key} type="button" role="menuitem" data-autofocus={i === 0 ? '' : undefined} className="ui-menu-item" onClick={(e) => { e.stopPropagation(); setOpen(false); it.onSelect(); }}>{it.label}</button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

/* ----------------------------------------------------------------- figures */

/** The four tiles over each register. A tile that names a tab opens it. */
export function RegisterFigures({ kind, cfg, rows, people, working, today, onTab }) {
  const tab = (key) => (onTab ? () => onTab(key) : undefined);
  let items = null;
  if (kind === 'assets') {
    const f = assetFigures(rows, people);
    items = [
      { key: 'all', label: 'Assets', value: f.total, note: f.types ? `${plural(f.types, 'type')}${f.retired ? ` · ${f.retired} retired` : ''}` : 'Not counting retired', cat: 1, Icon: ICON.laptop, onClick: tab('ALL') },
      { key: 'assigned', label: 'Assigned', value: f.assigned, note: f.total ? `${Math.round((f.assigned / f.total) * 100)}% of assets` : null, cat: 2, Icon: ICON.team, onClick: tab('ASSIGNED') },
      { key: 'store', label: 'In store', value: f.inStore, note: f.repair ? `${f.repair} in repair` : 'Ready to hand out', cat: 3, Icon: ICON.store },
      { key: 'recover', label: 'To recover', value: f.recover, tone: 'warn', note: 'From people leaving or due back', cat: 4, Icon: ICON.recover },
    ];
  } else if (kind === 'benefits') {
    const f = benefitFigures(rows, working.length, today);
    items = [
      { key: 'plans', label: 'Plans offered', value: f.plans, note: f.draftPlans ? `${f.draftPlans} in draft` : 'Active now', cat: 1, Icon: ICON.gift },
      { key: 'enrolled', label: 'People enrolled', value: f.enrolled, note: working.length ? `${f.share}% of ${working.length} working` : null, cat: 2, Icon: ICON.team },
      { key: 'starting', label: 'Starting soon', value: f.starting, note: f.nextStart ? `Next on ${short(f.nextStart, today)}` : 'Nothing waiting', cat: 3, Icon: ICON.soon },
      { key: 'ending', label: 'Ending in 60 days', value: f.ending, tone: 'warn', note: 'Renew or let it lapse', cat: 4, Icon: ICON.calendar },
    ];
  } else if (kind === 'announcements') {
    const f = announcementFigures(rows, working, today);
    const diff = f.thisMonth - f.lastMonth;
    items = [
      { key: 'month', label: 'Posts this month', value: f.thisMonth, delta: diff ? `${diff > 0 ? '▲ +' : '▼ −'}${Math.abs(diff)}` : null, good: diff >= 0, note: `${f.lastMonth} last month`, cat: 1, Icon: ICON.post },
      { key: 'live', label: 'Published', value: f.published, note: f.archived ? `${f.archived} archived` : 'On the employee app', cat: 2, Icon: ICON.done, onClick: tab('PUBLISHED') },
      { key: 'reach', label: 'Reach', value: f.reach, note: 'Everyone working', cat: 3, Icon: ICON.team },
      { key: 'drafts', label: 'Drafts', value: f.drafts, note: 'Not sent yet', cat: 4, Icon: ICON.draft, onClick: tab('DRAFT') },
    ];
  } else if (kind === 'events') {
    const f = eventFigures(rows, today);
    items = [
      { key: 'upcoming', label: 'Upcoming', value: f.upcoming, note: f.next ? `Next on ${short(f.next, today)}` : 'Nothing planned', cat: 1, Icon: ICON.calendar, onClick: tab('upcoming') },
      { key: 'month', label: 'This month', value: f.thisMonth, note: 'Not counting cancelled', cat: 2, Icon: ICON.soon },
      { key: 'drafts', label: 'Drafts', value: f.drafts, note: 'Not in the employee app yet', cat: 3, Icon: ICON.draft },
      { key: 'held', label: 'Held this year', value: f.held, note: `Since 1 Jan ${today.slice(0, 4)}`, cat: 4, Icon: ICON.done, onClick: tab('past') },
    ];
  }
  return items ? <KpiTiles label={`${cfg.title} figures`} items={items} /> : null;
}

/* ------------------------------------------------------------------ assets */

export function AssetPill({ cfg, row, holder, today }) {
  if (toRecover(row, holder)) {
    return <StatusPill cfg={cfg} status={row.status} tone="warn">{row.dueDate ? `Return by ${short(row.dueDate, today)}` : holder?.status === 'LEFT' ? 'To recover' : 'Holder on notice'}</StatusPill>;
  }
  return <StatusPill cfg={cfg} status={row.status} />;
}

/* ---------------------------------------------------------------- benefits */

const PLAN_ICON = [
  [/health|medical|mediclaim|hospital/i, 'heart'], [/life|term|accident/i, 'life'], [/meal|food|lunch/i, 'food'],
  [/nps|pension|provident|gratuity|retire/i, 'savings'], [/advance|loan/i, 'coin'], [/learn|course|book|education/i, 'learn'],
];
const planIcon = (title) => ICON[(PLAN_ICON.find(([re]) => re.test(title)) || [null, 'gift'])[1]];

/** A card per company plan (PEOPLE-10): what it covers, how many of the people working are in it, and Manage. */
export function PlanCards({ cfg, plans, rows, working, today, onManage, onEnrol }) {
  if (!plans.length) return null;
  const activeIds = new Set(working.map((p) => p.id));
  return (
    <section className="rg-section" aria-label="Plans">
      <div className="rg-plans">
        {plans.map((plan, i) => {
          const cat = (i % 8) + 1;
          const n = planEnrolment(plan, rows, activeIds, today);
          const pct = working.length ? Math.round((n / working.length) * 100) : 0;
          const Icon = planIcon(plan.title);
          const d = plan.details || {};
          return (
            <article key={plan.id} className="rg-plan" style={{ '--rg-id': `var(--cat-${cat})` }}>
              <header className="rg-plan-head">
                <span className="rg-plan-icon" aria-hidden="true"><Icon /></span>
                <h3 className="rg-plan-title">{plan.title}</h3>
                {plan.status !== 'ACTIVE' ? <StatusPill cfg={cfg} status={plan.status} /> : null}
              </header>
              <p className="rg-plan-line">{[d.coverage, d.provider].filter(Boolean).join(' · ') || 'No coverage details yet'}</p>
              <div className="rg-plan-meter">
                <span className="rg-plan-count"><span>{n} of {working.length} enrolled</span><span className="tabular-nums">{pct}%</span></span>
                <Meter value={n} max={working.length} cat={cat} label={`${plan.title}: ${n} of ${working.length} enrolled`} />
              </div>
              <footer className="rg-plan-foot">
                <span className="rg-plan-note">{d.eligibility || (d.endDate ? `Until ${day(d.endDate)}` : 'Open to everyone')}</span>
                <span className="rg-plan-links">
                  {onEnrol ? <button type="button" className="rg-link" onClick={() => onEnrol(plan)} aria-label={`Enrol someone in ${plan.title}`}>Enrol</button> : null}
                  <button type="button" className="rg-link" onClick={() => onManage(plan)} aria-label={`Manage ${plan.title}`}>Manage</button>
                </span>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- announcements */

/** The feed of posts (PEOPLE-22): symbol, title, the message, when and for whom, and how many people it reaches. */
export function AnnouncementFeed({ cfg, rows, working, today, audienceOf, onOpen, menuOf, loading, empty }) {
  if (loading && !rows.length) return <div className="rg-feed" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="rg-post"><span className="ui-skel ui-skel-title" /><span className="ui-skel ui-skel-text" /><span className="ui-skel ui-skel-text" style={{ width: '60%' }} /></div>)}</div>;
  if (!rows.length) return empty;
  return (
    <ul className="rg-feed" aria-label={cfg.title}>
      {rows.map((r) => {
        const sym = symbolOf(r.details?.symbol);
        const n = reachOf(r, working);
        return (
          <li key={r.id} className="rg-post">
            <div className="rg-post-head">
              <span className="rg-post-sym" aria-hidden="true">{sym ? sym.emoji : <ICON.post />}</span>
              <button type="button" className="rg-post-title" onClick={() => onOpen(r)}>{r.title}</button>
              {r.status !== 'PUBLISHED' ? <StatusPill cfg={cfg} status={r.status} /> : null}
              <ItemMenu label={`Actions for ${r.title}`} items={menuOf(r)} />
            </div>
            {r.details?.body ? <p className="rg-post-body">{r.details.body}</p> : null}
            <div className="rg-post-foot">
              <span>{[r.status === 'DRAFT' ? `Saved ${short(r.updatedAt || r.createdAt, today)}` : short(r.createdAt, today), `to ${audienceOf(r) || 'Everyone'}`].filter(Boolean).join(' · ')}</span>
              {r.status === 'DRAFT' ? null : <span className="tabular-nums">Reaches {plural(n, 'person', 'people')}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Beside the feed: drafts waiting to go out, and how many people each audience in use reaches. */
export function AnnouncementSide({ rows, working, audienceOf, onOpen, canEdit }) {
  const drafts = rows.filter((r) => r.status === 'DRAFT');
  const groups = new Map([['Everyone', working.length]]);
  for (const r of rows) {
    if (r.status === 'ARCHIVED') continue;
    const words = audienceOf(r) || 'Everyone';
    if (!groups.has(words)) groups.set(words, reachOf(r, working));
  }
  return (
    <aside className="rg-side">
      <section className="rg-side-block" aria-labelledby="rg-drafts">
        <h2 id="rg-drafts" className="rg-h2">Drafts</h2>
        {drafts.length ? (
          <ul className="rg-lines">
            {drafts.map((r) => (
              <li key={r.id} className="rg-line">
                <span className="min-w-0"><span className="block truncate font-semibold">{r.title}</span><span className="rg-sub">For {audienceOf(r) || 'Everyone'}</span></span>
                <button type="button" className="rg-link" onClick={() => onOpen(r)} aria-label={`${canEdit ? 'Edit' : 'Open'} ${r.title}`}>{canEdit ? 'Edit' : 'Open'}</button>
              </li>
            ))}
          </ul>
        ) : <p className="rg-sub rg-none">Nothing waiting to go out.</p>}
      </section>
      <section className="rg-side-block" aria-labelledby="rg-audiences">
        <h2 id="rg-audiences" className="rg-h2">Audiences</h2>
        <ul className="rg-lines">
          {[...groups].map(([words, n]) => (
            <li key={words} className="rg-line"><span className="truncate">{words}</span><span className="tabular-nums" aria-label={`${plural(n, 'person', 'people')}`}>{n}</span></li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

/* ------------------------------------------------------------------ events */

/** The dated list of events (PEOPLE-23): a month-and-day block, the title, when and where, and the status. */
export function EventList({ cfg, rows, today, onOpen, menuOf, loading, empty }) {
  if (loading && !rows.length) return <div className="rg-events" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="rg-event"><span className="rg-date"><span className="ui-skel ui-skel-text" /></span><span className="ui-skel ui-skel-text" style={{ width: '40%' }} /></div>)}</div>;
  if (!rows.length) return empty;
  return (
    <ul className="rg-events" aria-label={cfg.title}>
      {rows.map((r) => {
        const d = r.details || {};
        const start = String(d.startDate || '').slice(0, 10);
        const end = String(d.endDate || '').slice(0, 10);
        const when = start ? `${weekday(start)} ${short(start, today)}${end && end !== start ? ` – ${weekday(end)} ${short(end, today)}` : ''}` : 'No date yet';
        const sym = symbolOf(d.symbol);
        return (
          <li key={r.id} className="rg-event">
            <span className="rg-date" aria-hidden="true">
              <span className="rg-date-month">{start ? monthWord(start) : '—'}</span>
              <span className="rg-date-day">{start ? Number(start.slice(8, 10)) : ''}</span>
            </span>
            <span className="rg-event-text">
              <button type="button" className="rg-event-title" onClick={() => onOpen(r)}>{sym ? <span className="mr-1.5" aria-hidden="true">{sym.emoji}</span> : null}{r.title}</button>
              <span className="rg-sub">{[when, d.location, d.organiser ? `by ${d.organiser}` : ''].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="rg-event-end">
              <StatusPill cfg={cfg} status={r.status} />
              <ItemMenu label={`Actions for ${r.title}`} items={menuOf(r)} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
