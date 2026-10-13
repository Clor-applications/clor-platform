import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';

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

const score = (label, group, q) => {
  const l = label.toLowerCase();
  const g = String(group || '').toLowerCase();
  if (!q) return 1;
  if (l === q) return 100;
  if (l.startsWith(q)) return 80;
  // Word-boundary hit: "sales returns" should match "ret".
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 60;
  if (l.includes(q)) return 40;
  if (g.startsWith(q) || g.includes(q)) return 20;
  return 0;
};

/**
 * Mounted only while open (see App), so its state starts fresh every time and
 * there is no reset-on-open effect to synchronise. A palette that reopens
 * showing the previous query is a palette people stop trusting.
 */
export default function CommandPalette({ onClose, items = [], onSelect, searchRecords }) {
  const [query, setQuery] = useState('');
  // The highlight is stored with the query it belongs to, so a new query
  // resets it during render rather than in an effect that fires a second pass.
  const [highlight, setHighlight] = useState({ q: '', i: 0 });
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const destinations = items
      .map((it) => ({ ...it, _s: score(it.label, it.group, q) }))
      .filter((it) => it._s > 0)
      .sort((a, b) => b._s - a._s || a.label.localeCompare(b.label))
      .slice(0, 40);

    // Records only appear once there is something to match. An empty palette
    // showing eight hundred documents is a list, not an answer.
    const records = q && typeof searchRecords === 'function' ? searchRecords(q) : [];
    if (!records.length) return destinations;

    // A document number is a precise thing to type. When the query looks like
    // one — an exact or near-exact hit on a record — that record outranks a
    // screen whose name merely contains the same letters.
    const merged = [...records, ...destinations];
    return merged.sort((a, b) => b._s - a._s).slice(0, 40);
  }, [items, query, searchRecords]);

  // Focus lands in the input on mount; nothing else needs synchronising.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, []);

  const active = highlight.q === query ? highlight.i : 0;
  const setActive = (next) =>
    setHighlight((prev) => ({
      q: query,
      i: typeof next === 'function' ? next(prev.q === query ? prev.i : 0) : next,
    }));

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = useCallback(
    (item) => {
      if (!item) return;
      onSelect?.(item);
      onClose?.();
    },
    [onSelect, onClose]
  );

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-start justify-center px-4 pt-[12vh]"
      style={{ zIndex: 'var(--z-palette)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Scrim: dismisses on click, and dims enough to isolate the panel. */}
      <button
        type="button"
        aria-label="Close command palette"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ backgroundColor: 'rgb(2 6 23 / 0.55)', backdropFilter: 'blur(2px)' }}
      />

      <div
        /* No entrance. ⌘K is keyboard-initiated and used dozens of times a day —
            the tier where animation reads as lag, not polish. Raycast opens
            instantly and that is the bar. */
        className="relative w-full max-w-xl overflow-hidden"
        style={{
          backgroundColor: 'rgb(var(--surface))',
          border: '1px solid rgb(var(--border))',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lift)',
        }}
      >
        <div className="flex items-center gap-3 px-4" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
          <Search size={18} className="ui-subtle flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            /* Key handling lives on the input, not the panel: focus is here,
               and the listbox pattern expects the combobox itself to own
               arrow/enter/escape rather than depending on bubbling. */
            onKeyDown={onKeyDown}
            placeholder="Search invoices, customers, reports, settings…"
            className="w-full bg-transparent border-0 outline-none py-3.5 text-sm"
            style={{ color: 'rgb(var(--fg))' }}
            role="combobox"
            aria-expanded="true"
            aria-label="Search"
            aria-controls="cmdk-results"
            aria-activedescendant={results[active] ? `cmdk-${results[active].key}` : undefined}
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="ui-kbd flex-shrink-0">esc</kbd>
        </div>

        <div id="cmdk-results" ref={listRef} role="listbox" className="max-h-[54vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm ui-muted">
              Nothing matches “{query}”.
            </p>
          ) : (
            results.map((it, i) => {
              const Icon = it.icon;
              return (
                <div
                  key={it.key}
                  id={`cmdk-${it.key}`}
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(it)}
                  className="mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5"
                  style={i === active ? { backgroundColor: 'rgb(var(--brand-soft))' } : undefined}
                >
                  {Icon ? (
                    <Icon
                      size={16}
                      aria-hidden="true"
                      style={{ color: i === active ? 'rgb(var(--brand))' : 'rgb(var(--fg-subtle))' }}
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {it.label}
                    {it.detail ? <span className="ui-subtle"> · {it.detail}</span> : null}
                  </span>
                  <span className="ui-subtle text-xs">{it.group}</span>
                  {i === active ? <CornerDownLeft size={14} className="ui-subtle" aria-hidden="true" /> : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
