import React, { useRef } from 'react';

import { PageHeader } from '../ui/Primitives';
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
  primary = null,
  secondary = null,
  toolbar = null,
  toolbarEnd = null,
  tabs = null,
  tab = null,
  onTab = null,
  tabsLabel = null,
  entity = '',
  children = null,
}) {
  const crumbs = breadcrumb || [{ label: module }, ...(section ? [{ label: section }] : []), { label: title }];
  const primaryNode = !primary ? null : React.isValidElement(primary) ? primary : (
    <button type="button" className="ui-btn ui-btn-primary" onClick={primary.onClick} disabled={primary.disabled || undefined} title={primary.title || undefined}>
      {primary.icon ? <primary.icon size={16} aria-hidden="true" /> : null}
      {primary.label}
    </button>
  );
  const actions = secondary || primaryNode ? <>{secondary}{primaryNode}</> : null;
  return (
    <header className="ui-list-header">
      <PageHeader breadcrumb={crumbs} title={title} entity={entity} actions={actions} />
      {description ? <p className="ui-list-desc ui-muted">{description}</p> : null}
      {strip}
      {toolbar || toolbarEnd ? (
        <div className="ui-list-toolbar">
          {toolbar}
          {toolbarEnd ? <div className="ui-list-toolbar-end">{toolbarEnd}</div> : null}
        </div>
      ) : null}
      {tabs?.length ? <FilterTabs tabs={tabs} value={tab} onChange={onTab} label={tabsLabel || title} /> : null}
      {children}
    </header>
  );
}

/**
 * Status tabs with their counts: `[{ key, label, count, tone }]`. A count of
 * nought is not drawn; `tone="warn"` marks what waits on the reader. The tab
 * carries the count so no figure strip above it has to.
 */
export function FilterTabs({ tabs, value, onChange, label }) {
  const ref = useRef(null);
  const indicator = useTabIndicator(ref, value);
  return (
    <div ref={ref} role="tablist" aria-label={label} className={`ui-record-tablist ${indicator ? 'has-indicator' : ''}`}>
      {tabs.filter(Boolean).map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className={`ui-tab ${value === t.key ? 'is-active' : ''}`} onClick={() => onChange?.(t.key)}>
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
