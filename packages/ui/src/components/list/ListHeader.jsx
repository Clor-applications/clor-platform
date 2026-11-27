import React, { useRef } from 'react';

import { EmptyState, PageHeader } from '../ui/Primitives';
import { usePeoplePageSlot } from './PeoplePageLayout';
import { CountLine } from '../ui/CountLine';
import { useTabIndicator } from '../ui/RecordTabs';

/**
 * The one header every People list wears (People plan, 8 Nov 2026, §3 rule 2):
 * breadcrumb (module › section › screen), the title as the menu says it, one
 * line on what the screen is for, one primary action top right, then the
 * toolbar on one line (search · filters · view), then the tabs with their
 * counts, and the list under that.
 *
 * Five screens had five layouts of the same parts. They are parts of one
 * component now, so a new list cannot put the search on a second row or the
 * tabs above the toolbar by accident.
 *
 * `primary` is either `{ label, onClick, icon, disabled, title }` or a ready
 * element (a `Button` that needs `loading`). Either way it is drawn once, here,
 * and nowhere else on the screen: an empty state offers a secondary or a link.
 */
export default function ListHeader({
  breadcrumb = null,
  module = 'People',
  section = null,
  title,
  description = null,
  /** A figures strip whose numbers the tabs do not already carry (Employees); never one that repeats them. */
  strip = null,
  headingCounts = null,
  headingSummary = null,
  primary = null,
  secondary = null,
  toolbar = null,
  toolbarInHeading = false,
  toolbarEnd = null,
  tabs = null,
  tab = null,
  onTab = null,
  tabsLabel = null,
  entity = '',
  /** Round 40, rowcount B: how many rows match, drawn in the title as "Employees (6)". Null until known; not in Books. */
  count = null,
  children = null,
}) {
  const crumbs = breadcrumb || [{ label: module }, ...(section ? [{ label: section }] : []), { label: title }];
  const primaryNode = !primary ? null : React.isValidElement(primary) ? primary : (
    <button type="button" className="ui-btn ui-btn-primary" onClick={primary.onClick} disabled={primary.disabled || undefined} title={primary.title || undefined}>
      {primary.icon ? <primary.icon size={16} aria-hidden="true" /> : null}
      {primary.label}
    </button>
  );
  const headingTools = toolbarInHeading && toolbar ? <div className="time-heading-tools">{toolbar}</div> : null;
  const actions = headingTools || secondary || primaryNode ? <>{headingTools}{secondary}{primaryNode}</> : null;
  const people = typeof document !== 'undefined' && document.documentElement.dataset.app === 'people';
  const [columnsSlot] = usePeoplePageSlot('toolbar', !toolbarEnd);
  const inlineSummary = people && strip?.type === CountLine ? strip : null;
  const controls = (!toolbarInHeading && toolbar) || toolbarEnd || columnsSlot ? (
    <div className="ui-list-toolbar">
      {!toolbarInHeading && toolbar}
      {columnsSlot && <span className="people-columns-slot" ref={columnsSlot} />}
      {toolbarEnd ? <div className="ui-list-toolbar-end">{toolbarEnd}</div> : null}
    </div>
  ) : null;
  const views = tabs?.length ? <FilterTabs tabs={tabs} value={tab} onChange={onTab} label={tabsLabel || title} appearance={people ? 'underline' : 'chips'} /> : null;
  return (
    <header className="ui-list-header">
      <PageHeader breadcrumb={people && !crumbs.some((c) => c.onClick) ? null : crumbs} title={titleWithCount(title, count)} entity={entity} counts={headingCounts} summary={people ? headingSummary || inlineSummary : null} actions={actions} />
      {description ? <p className="ui-list-desc ui-muted">{description}</p> : null}
      {!inlineSummary && strip}
      {!people && headingSummary}
      {people && (controls || views) ? <div className="people-list-controls">{views}{controls}</div> : <>{controls}{views}</>}
      {children}
    </header>
  );
}

const isBooks = () => typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo';

/** `Employees` + 6 → `Employees (6)`, with the figure in tabular numbers. Books keeps its plain title. */
export function titleWithCount(title, count) {
  const n = Number(count);
  if (count == null || count === '' || !Number.isFinite(n) || n < 0 || isBooks()) return title;
  return <>{title} <span className="ui-title-count tabular-nums">({n.toLocaleString('en-IN')})</span></>;
}

/**
 * Status tabs with their counts: `[{ key, label, count, tone }]`. A count of
 * nought is not drawn; `tone="warn"` marks what waits on the reader. The tab
 * carries the count so no figure strip above it has to.
 */
export function FilterTabs({ tabs, value, onChange, label, appearance = typeof document !== 'undefined' && document.documentElement.dataset.app === 'people' ? 'underline' : 'chips' }) {
  const ref = useRef(null);
  const indicator = useTabIndicator(ref, value);
  const availableTabs = tabs.filter(Boolean);
  const focusKey = availableTabs.find(t => t.key === value)?.key ?? availableTabs[0]?.key;
  const handleKey = (event) => {
    const buttons = Array.from(ref.current.querySelectorAll('[role="tab"]'));
    const index = buttons.indexOf(event.target);
    if (index < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = { ArrowRight: (index + 1) % buttons.length, ArrowLeft: (index + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    buttons[next].focus();
    buttons[next].click();
  };
  return (
    <div ref={ref} onKeyDown={handleKey} role="tablist" aria-label={label} className={`ui-record-tablist ${appearance === 'chips' ? 'ui-filter-chips' : ''} ${indicator ? 'has-indicator' : ''}`}>
      {availableTabs.map((t) => (
        <button key={t.key} type="button" role="tab" tabIndex={focusKey === t.key ? 0 : -1} aria-selected={value === t.key} className={`ui-tab ${value === t.key ? 'is-active' : ''}`} onClick={() => onChange?.(t.key)}>
          {t.label}
          {t.count ? <span className="ui-tab-count tabular-nums" data-tone={t.tone || undefined}>{t.count}</span> : null}
        </button>
      ))}
      {indicator}
    </div>
  );
}

/**
 * A segmented switch between views of one list (Day / Month, What is owed /
 * Rules): one style everywhere, the chosen segment solid. It is a radio
 * group, not a tablist: it changes how the same rows are shown.
 */
export function SegmentedControl({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="ui-segmented ui-segmented-solid">
      {options.filter(Boolean).map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} className="ui-segment" onClick={() => onChange?.(o.key)}>
          {o.label}
          {o.count ? <span className="ui-segment-count tabular-nums">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** A list's empty state: the heading, one sentence on what the screen is for, and at most a secondary way in. */
export function ListEmpty(props) {
  return <EmptyState describe {...props} />;
}
