import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Search } from '@ui/components/ui/lineIcons';

import { PageHeader } from '../components/ui/Primitives';

/**
 * Settings as one page instead of a long sidebar (founder, 22 Oct 2026; the
 * pattern of Zoho People, Keka and greytHR settings). Everything set up once
 * and changed rarely, in groups, each with a line saying what it is for.
 * Only the cards this person may open: the shell hands over the nav it kept.
 *
 * groups: [{ title, note, items: [[navKey, note]], apps?: [[appId, label, note]] }]
 */
export default function SettingsHub({ groups: GROUPS, openScreen, navItems = [], description = 'Everything set up once and changed rarely, in one place.' }) {
  const [q, setQ] = useState('');
  const byKey = useMemo(() => new Map(navItems.filter((i) => i.key).map((i) => [i.key, i])), [navItems]);
  const match = (...texts) => !q.trim() || texts.join(' ').toLowerCase().includes(q.trim().toLowerCase());
  const groups = GROUPS.map((g) => ({
    ...g,
    cards: g.items.map(([key, note]) => ({ key, note, item: byKey.get(key) })).filter((c) => c.item && match(c.item.label, c.note, g.title)),
    apps: (g.apps || []).filter(([, label, note]) => match(label, note, g.title)),
  })).filter((g) => g.cards.length || g.apps.length);

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        entity="settings"
        title="Settings"
        description={description}
        actions={
          <label className="relative block w-72 max-w-full">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" aria-hidden="true" />
            <input className="ui-input w-full pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings…" aria-label="Search settings" />
          </label>
        }
      />
      {!groups.length ? <p className="ui-muted text-sm">No setting matches “{q}”.</p> : null}
      {groups.map((g) => (
        <section key={g.title} className="space-y-2" aria-labelledby={`set-${g.title}`}>
          <div>
            <h2 id={`set-${g.title}`} className="ui-t-sec">{g.title}</h2>
            <p className="ui-caption ui-settings-note">{g.note}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {g.cards.map(({ key, note, item }) => {
              const Icon = item.icon;
              return (
                <li key={key}>
                  <button type="button" onClick={() => openScreen?.(key)} className="ui-card w-full h-full p-4 text-left flex items-start gap-3 hover:border-[rgb(var(--brand))]">
                    {Icon ? <Icon size={22} aria-hidden="true" /> : null}
                    <span className="min-w-0">
                      <span className="block font-medium">{item.label}</span>
                      <span className="ui-caption block">{note}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {g.apps.map(([id, label, note]) => (
              <li key={id}>
                <a href={`?app=${id}`} className="ui-card w-full h-full p-4 text-left flex items-start gap-3 hover:border-[rgb(var(--brand))]">
                  <ArrowUpRight size={22} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-medium">{label}</span>
                    <span className="ui-caption block">{note}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
