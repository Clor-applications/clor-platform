import React from 'react';
import { ArrowRight } from 'lucide-react';
import { ExceptionTag } from '@ui/components/ui/ExceptionTag';
import './PeopleQuickLaunch.css';

export function DashboardHeader({ title, action, children }) {
  return <header className="people-daily-brief">
    <div className="people-brief-title"><h1 className="ui-t-page">{title}</h1>{action}</div>
    {children}
  </header>;
}

/* A block on the page ground: a title, one link on the right, then its list under one hairline. */
export function DashboardBlock({ id, title, action = null, children, label, className }) {
  return (
    <section aria-labelledby={id} aria-label={label} className={className}>
      <header className="people-block-head">
        <h2 id={id} className="people-block-title">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function DashboardFigures({ id, title, figures, icons }) {
  return (
    <section className="people-team-overview" aria-labelledby={id}>
      <h2 id={id} className="people-home-section-title">{title}</h2>
      <ul className="people-team-figures">
        {figures.map(({ key, label, value, detail, status, max, action, onClick }) => {
          const Icon = icons[key];
          return (
            <li key={key} className="people-team-row" data-figure={key}>
              <span className="people-team-label"><Icon size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />{label}</span>
              <span className="people-team-value tabular-nums">{value ?? <span aria-label="Unavailable">—</span>}</span>
              {detail || status ? <span className="people-home-status-line">{status ? <ExceptionTag label={status.label} tone={status.tone} /> : null}{detail ? <span className="ui-caption">{detail}</span> : null}</span> : null}
              {max && value >= 0 && value <= max ? <meter className="people-team-meter" value={value} max={max} aria-label={label + " out of expected"} /> : null}
              {onClick ? <button type="button" className="ui-link people-team-action" onClick={onClick}>{action}<ArrowRight size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" /></button> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
