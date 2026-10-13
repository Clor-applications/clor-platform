import React from 'react';
import { ArrowRight, Maximize2 } from 'lucide-react';

/**
 * The tile every chart on a dashboard sits in.
 *
 * One shape repeated across the grid — title row, chart body, footer link —
 * because a dashboard's job is comparison, and comparison breaks the moment
 * two tiles are built differently. Every card is the same height so the rows
 * line up whatever the chart inside is doing.
 *
 * The expand control is real, not ornament: several of these charts are dense
 * enough that a full-width view is the difference between reading them and
 * squinting at them.
 */
export default function ChartCard({
  title,
  subtitle,
  onExpand,
  actionLabel,
  onAction,
  children,
  bodyClassName = '',
}) {
  return (
    <section className="ui-card flex flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h3 className="ui-card-title" style={{ color: 'rgb(var(--fg))' }}>
            {title}
          </h3>
          {subtitle ? <p className="ui-caption mt-0.5 truncate">{subtitle}</p> : null}
        </div>

        {onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            className="ui-icon-btn -mr-1 -mt-1 flex-shrink-0"
            aria-label={`Expand ${title}`}
          >
            <Maximize2 size={16} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {/* flex-1 so short and tall charts still produce equal-height cards. */}
      <div className={`flex-1 px-5 pt-4 ${bodyClassName}`}>{children}</div>

      {actionLabel ? (
        <footer className="px-5 pb-5 pt-4">
          <button type="button" onClick={onAction} className="ui-card-action">
            {actionLabel}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </footer>
      ) : (
        <div className="pb-5" />
      )}
    </section>
  );
}
