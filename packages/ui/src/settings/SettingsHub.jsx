import React, { useMemo, useState } from 'react';
import { ArrowUpRight, ChevronRight, Search } from '@ui/components/ui/lineIcons';

import SearchField from '../components/ui/SearchField';
import { PageHeader } from '../components/ui/Primitives';
import { settingHits } from '../picks/round64';

/**
 * Settings as one page instead of a long sidebar (founder, 22 Oct 2026; the
 * pattern of Zoho People, Keka and greytHR settings). Everything set up once
 * and changed rarely, in groups, each with a line saying what it is for.
 * Only the rows this person may open: the shell hands over the nav it kept.
 *
 * groups: [{ title, note, tone?, items: [[navKey, note]], apps?: [[appId, label, note]] }]; `tone` (1–8) names the
 * group's identity colour (--cat-N), which a portal's stylesheet may use behind each tile's icon (People, PEOPLE-28).
 */
/* `menuLabel` is the menu's name for this page (Shell passes it); the title follows it, so People's "All settings" reads the same in the menu and on the page. */
export default function SettingsHub({ groups: GROUPS, openScreen, navItems = [], words = null, showNotes = true, description = 'What you set up once and rarely change.', menuLabel = '', browseCategories = false, params, updateParams, openApp, apps }) {
  const [localQuery, setLocalQuery] = useState('');
  const [localCategory, setLocalCategory] = useState('');
  const q = browseCategories && updateParams ? params?.q || '' : localQuery;
  const category = updateParams ? params?.category || '' : localCategory;
  const setQ = browseCategories && updateParams ? value => updateParams({ q: value || null }) : setLocalQuery;
  const chooseCategory = value => {
    if (updateParams) updateParams({ category: value || null, q: null }, { push: true });
    else { setLocalCategory(value); setLocalQuery(''); }
  };
  const byKey = useMemo(() => new Map(navItems.filter((i) => i.key).map((i) => [i.key, i])), [navItems]);
  const match = (...texts) => !q.trim() || texts.join(' ').toLowerCase().includes(q.trim().toLowerCase());
  /* Round 64 "settingsfind" A: a word inside a setting ("grace") finds it too, and says where it lives. */
  const hits = settingHits(q, words, GROUPS, byKey);
  const hitKeys = new Set(hits.map((h) => h.key));
  const groups = GROUPS.map((g) => ({
    ...g,
    cards: g.items.map(([key, note]) => ({ key, note, item: byKey.get(key) })).filter((c) => c.item && (hitKeys.has(c.key) || match(c.item.label, c.note, g.title, ...(c.item.keywords || [])))),
    apps: (g.apps || []).filter(([id, label, note]) => (!apps || apps.some(app => app.id === id)) && match(label, note, g.title)),
  })).filter((g) => g.cards.length || g.apps.length);

  const activeGroup = !q && browseCategories && groups.find(group => group.title === category);
  const showIndex = browseCategories && !q && !activeGroup;
  return (
    <div className="ui-settings-hub space-y-6 pb-8">
      {/* The search is a toolbar under the title (People plan 8 Nov 2026, step 3), not a right-hand column. */}
      {browseCategories ? <header className="ui-list-header">
        <PageHeader entity="settings" title={activeGroup?.title || menuLabel || 'Settings'} actions={
          <div className="people-settings-tools">
            {activeGroup && <button type="button" className="ui-btn ui-btn-secondary" onClick={() => chooseCategory('')}>All settings</button>}
            <SearchField value={q} onSearch={setQ} placeholder="Search all settings" label="Search all settings" delay={250} />
          </div>
        } />
      </header> : <header className="ui-list-header">
        <PageHeader entity="settings" title={menuLabel || 'Settings'} description={description} />
        <div className="ui-list-toolbar">
          <label className="relative block w-72 max-w-full">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" aria-hidden="true" />
            <input className="ui-input w-full pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings…" aria-label="Search settings" />
          </label>
        </div>
      </header>}
      {!groups.length ? <p className="ui-muted text-sm">No setting matches “{q}”.</p> : null}
      {!browseCategories && hits.length ? (
        <section aria-label="Settings that hold this word" className="ui-settings-hits">
          <p className="ui-caption">Found inside</p>
          <ul className="flex flex-wrap gap-2">
            {hits.map((h) => (
              <li key={h.key}>
                <button type="button" className="ui-settings-hit" onClick={() => openScreen?.(h.key)}>
                  <span>{h.word}</span> → {h.group} › {h.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {showIndex ? <nav className="people-settings-index" aria-label="Settings categories">
        {groups.map(group => {
          const labels = [...group.cards.map(card => card.item.label), ...group.apps.map(([, label]) => label)];
          return <button type="button" key={group.title} onClick={() => chooseCategory(group.title)}>
            <strong>{group.title}</strong>
            <ChevronRight size={16} aria-hidden="true" />
            <span>{labels.slice(0, 3).join(' · ')}</span>
          </button>;
        })}
      </nav> : <div className={activeGroup ? 'ui-settings-catalog people-settings-category' : 'ui-settings-catalog space-y-6'}>
        {(activeGroup ? [activeGroup] : groups).map((g) => {
          const headingId = `set-${g.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          return (
            <section key={g.title} className="ui-settings-group space-y-2" aria-labelledby={activeGroup ? undefined : headingId} aria-label={activeGroup ? g.title : undefined} data-tone={g.tone || undefined} style={g.tone ? { '--set-tone': `var(--cat-${g.tone})` } : undefined}>
              {!activeGroup && <div>
                <h2 id={headingId} className="ui-t-sec">{g.title}</h2>
                {showNotes && <p className="ui-caption ui-settings-note">{g.note}</p>}
              </div>}
              <ul className="ui-settings-rows">
                {g.cards.map(({ key, note, item }) => {
                  const Icon = item.icon;
                  return (
                    <li key={key}>
                      <button type="button" onClick={() => openScreen?.(key)} className="ui-settings-row">
                        <span className="ui-settings-row-icon" aria-hidden="true">{Icon ? <Icon size={20} aria-hidden="true" /> : null}</span>
                        <span className="ui-settings-row-label">{item.label}</span>
                        {showNotes && <span className="ui-settings-row-note">{note}</span>}
                        <ChevronRight size={16} aria-hidden="true" className="ui-settings-row-go" />
                      </button>
                    </li>
                  );
                })}
                {g.apps.map(([id, label, note]) => (
                  <li key={id}>
                    <a href={`?app=${id}`} className="ui-settings-row" onClick={event => {
                      if (!openApp || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                      event.preventDefault();
                      openApp(id);
                    }}>
                      <span className="ui-settings-row-icon" aria-hidden="true"><ArrowUpRight size={20} aria-hidden="true" /></span>
                      <span className="ui-settings-row-label">{label}</span>
                      {showNotes && <span className="ui-settings-row-note">{note}</span>}
                      <ChevronRight size={16} aria-hidden="true" className="ui-settings-row-go" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>}
    </div>
  );
}
