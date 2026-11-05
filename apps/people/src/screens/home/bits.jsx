import React from 'react';

/* Small pieces Home's panels share (screens/PeopleOverview.jsx and screens/home/*). */

export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const shortDate = (d) => new Date(String(d).length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const dayDate = (d) => new Date(String(d).length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
export const range = (from, to) => (!to || from === to ? dayDate(from) : `${shortDate(from)} to ${shortDate(to)}`);
export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/* A face in its team's colour: the photo when there is one, initials when not. */
export function Face({ person, size = 40, colour }) {
  /* No text under 12px (DESIGN.md): a small face grows its initials to 12px rather than shrinking them. */
  const style = { width: size, height: size, '--dept': `var(--dept-${colour ?? 0})`, fontSize: Math.max(12, Math.round(size * 0.36)) };
  return person?.photoUrl ? (
    <img src={person.photoUrl} alt="" className="people-face" style={style} />
  ) : (
    <span className="people-face" style={style} aria-hidden="true">{initials(person?.name)}</span>
  );
}

/* A panel's head: a small tinted icon, the title, and one link on the right. */
export function PanelHead({ id, icon: Icon, tint, title, action = null }) {
  return (
    <header className="people-panel-head">
      <h2 id={id} className="soft-panel-title"><span className="soft-panel-icon" data-tint={tint}><Icon size={16} weight="duotone" aria-hidden="true" /></span>{title}</h2>
      {action}
    </header>
  );
}
