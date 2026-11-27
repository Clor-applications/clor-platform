import { Command } from 'cmdk';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, History, Search } from '@ui/components/ui/lineIcons';
import { recentSearches, rememberSearch } from '@ui/components/ui/recents';
import { useLayer } from './layerStack';

/**
 * Spotlight-style command palette (⌘K / Ctrl+K).
 *
 * The point is not the search box — it is that a finance team lives in five or
 * six destinations and should never hunt through a tree for them. Everything
 * here is reachable by keyboard alone; the mouse path still exists in the
 * sidebar for people who prefer it.
 *
 * Scoring is deliberately simple and predictable: an exact prefix beats a word
 * boundary, which beats a loose substring. A fuzzy matcher that surprises you
 * is worse than one you can anticipate.
 */

const score = (label, group, q, keywords = [], matchWords = false) => {
  const l = label.toLowerCase();
  const g = String(group || '').toLowerCase();
  if (!q) return 1;
  if (l === q) return 100;
  if (l.startsWith(q)) return 80;
  // Word-boundary hit: "sales returns" should match "ret".
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 60;
  // The word people use for a job, not the screen's name: "probation", "punch", "payslip".
  if (keywords.some((k) => k.toLowerCase().startsWith(q) || (q.length > 3 && k.toLowerCase().includes(q)))) return 50;
  if (l.includes(q)) return 40;
  if (g.startsWith(q) || g.includes(q)) return 20;
  const words = q.split(/\s+/);
  if (matchWords && words.length > 1 && words.every((word) => [l, g, ...keywords].some((text) => text.toLowerCase().includes(word)))) return 15;
  return 0;
};

/**
 * Mounted only while open (see App), so its state starts fresh every time and
 * there is no reset-on-open effect to synchronise. A palette that reopens
 * showing the previous query is a palette people stop trusting.
 */
/* Books searches its documents; every other app passes its own words, and without them the palette searches screens. */
const defaultPlaceholder = () => (typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo'
  ? 'Search invoices, customers, reports, settings…'
  : 'Search screens and apps…');

export default function CommandPalette({ onClose, items = [], onSelect, searchRecords, loadRecords, remember = false, placeholder = defaultPlaceholder() }) {
  const [query, setQuery] = useState('');
  /* Round 55 (recentsearch A): with `remember`, an empty box opens on the last five searches; choosing one types it back in. Read once per opening. */
  const [recent] = useState(() => (remember ? recentSearches() : []));
  /* Records found on the server for a query (`loadRecords(q)`: people by name, code or email), kept with the query they answer. */
  const [loaded, setLoaded] = useState({ q: '', items: [] });
  useEffect(() => {
    const q = query.trim();
    if (typeof loadRecords !== 'function' || q.length < 2) return undefined;
    let live = true;
    const t = setTimeout(() => {
      Promise.resolve(loadRecords(q)).then((found) => { if (live) setLoaded({ q, items: found || [] }); }).catch(() => {});
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [query, loadRecords]);
  const inputRef = useRef(null);


  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && recent.length) {
      return recent.map((r) => ({ key: `recent:${r}`, label: r, group: 'Recent search', icon: History, recentQuery: r }));
    }
    const destinations = items
      .map((it) => ({ ...it, _s: score(it.label, it.group, q, it.keywords, it.matchWords) }))
      .filter((it) => it._s > 0)
      .sort((a, b) => b._s - a._s || a.label.localeCompare(b.label))
      .slice(0, 40);

    // Records only appear once there is something to match. An empty palette
    // showing eight hundred documents is a list, not an answer.
    const records = [
      ...(q && typeof searchRecords === 'function' ? searchRecords(q, query.trim()) : []),
      ...(q && loaded.q.toLowerCase() === q ? loaded.items.map((r) => ({ _s: 70, ...r })) : []),
    ];
    if (!records.length) return destinations;

    // A document number is a precise thing to type. When the query looks like
    // one — an exact or near-exact hit on a record — that record outranks a
    // screen whose name merely contains the same letters.
    const merged = [...records, ...destinations];
    return merged.sort((a, b) => b._s - a._s).slice(0, 40);
  }, [items, query, searchRecords, loaded, recent]);

  // Focus lands in the input on mount, and goes back to whatever opened the
  // palette (the search button, usually) when it closes.
  useEffect(() => {
    const back = document.activeElement;
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => {
      clearTimeout(t);
      if (back && back !== document.body && typeof back.focus === 'function' && document.contains(back)) back.focus();
    };
  }, []);

  /* On the shared layer stack: Escape from anywhere in the palette closes it, and Tab stays inside. */
  const dialogRef = useRef(null);
  useLayer(true, { kind: 'dialog', onEscape: () => onClose?.(), trap: () => dialogRef.current });

  const choose = useCallback(
    (item) => {
      if (!item) return;
      if (item.recentQuery) {
        setQuery(item.recentQuery);
        inputRef.current?.focus();
        return;
      }
      if (remember) rememberSearch(query);
      onSelect?.(item);
      onClose?.();
    },
    [onSelect, onClose, remember, query]
  );

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 flex items-start justify-center px-4 pt-[12vh]"
      style={{ zIndex: 'var(--z-palette)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Search CLOR"
    >
      {/* Scrim: dismisses on click, and dims enough to isolate the panel. */}
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="ui-cmdk-scrim absolute inset-0 cursor-default"
        style={{ backgroundColor: 'rgb(2 6 23 / 0.55)', backdropFilter: 'blur(2px)' }}
      />

      <Command shouldFilter={false} label="Search CLOR"
        /* No entrance. ⌘K is keyboard-initiated and used dozens of times a day —
            the tier where animation reads as lag, not polish. Raycast opens
            instantly and that is the bar. */
        className="ui-cmdk-panel relative w-full max-w-xl overflow-hidden"
        style={{
          backgroundColor: 'rgb(var(--surface))',
          border: '1px solid rgb(var(--border))',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lift)',
        }}
      >
        <div className="flex items-center gap-3 px-4" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
          <Search size={18} className="ui-subtle flex-shrink-0" aria-hidden="true" />
          <Command.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={placeholder}
            className="w-full bg-transparent border-0 outline-none py-3.5 text-sm"
            style={{ color: 'rgb(var(--fg))' }}
            role="combobox"
            aria-expanded="true"
            aria-label="Search"
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="ui-kbd flex-shrink-0">esc</kbd>
        </div>

        <Command.List className="max-h-[54vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm ui-muted">
              Nothing matches “{query}”.
            </p>
          ) : (
            results.map((it) => {
              const Icon = it.icon;
              return (
                <Command.Item key={it.key} value={String(it.key)} onSelect={() => choose(it)}
                  className="mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5"
                >
                  {Icon ? (
                    <Icon
                      size={16}
                      aria-hidden="true"
                      className="ui-subtle"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {it.label}
                    {it.detail ? <span className="ui-subtle"> · {it.detail}</span> : null}
                  </span>
                  <span className="ui-palette-kind ui-subtle text-xs">{it.group}</span>
                  <CornerDownLeft size={14} className="ui-cmdk-enter" aria-hidden="true" />
                </Command.Item>
              );
            })
          )}
        </Command.List>
      </Command>
    </div>
  );
}
