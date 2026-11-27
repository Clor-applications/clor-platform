import React from 'react';
import { ArrowUpRight } from './lineIcons';
import './DashboardBoard.css';

export function DashboardStats({ label, items }) {
  if (!items.length) return null;
  return (
    <ul className="dashboard-stats" aria-label={label}>
      {items.map(({ key, label: title, value, detail, onClick, tone }) => {
        const contents = (
          <>
            <span className="dashboard-stat-label">{title}{onClick ? <ArrowUpRight size={14} aria-hidden="true" /> : null}</span>
            <strong className="dashboard-stat-value tabular-nums">{value ?? '—'}</strong>
            {detail ? <span className="dashboard-stat-detail">{detail}</span> : null}
          </>
        );
        return (
          <li key={key} className="dashboard-stat" data-tone={tone || undefined}>
            {onClick ? <button type="button" className="dashboard-stat-content" onClick={onClick}>{contents}</button> : <div className="dashboard-stat-content">{contents}</div>}
          </li>
        );
      })}
    </ul>
  );
}
