import React from 'react';
import { Check, ChevronDown, Search } from './lineIcons';
import { Menu as UiMenu, MenuPanel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './Menu';
import './filter-select.css';

/**
 * A filter chip ("App: All ⌄") that opens its menu right under it (DESIGN.md "Filter chips";
 * design audit G7). Promoted from the Workspace kit so every app filters the same way.
 *
 * `options` are `[value, label]` pairs, the first usually `['', 'All']`. The chip shows its
 * `label` and the chosen option's label; a chosen filter (any value but '') takes the app
 * colour for its border and word.
 *
 * A long list gets a search box at the top of the menu (DESIGN.md "Fields": five or more
 * options get one). Chips default to a box from eight options, since most status chips hold
 * five or six short words that read faster than they type; pass `searchable` to choose.
 */
const SEARCH_FROM = 8;

export function FilterSelect({ label, value, options, onChange, ariaLabel, width = '14rem', searchable }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const chosen = options.find(([v]) => v === value) || options[0];
  const withSearch = searchable ?? options.length >= SEARCH_FROM;
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter(([, l]) => String(l).toLowerCase().includes(q)) : options;
  const name = ariaLabel || label;

  const onOpenChange = (next) => {
    setOpen(next);
    if (!next) setQuery('');
  };

  return (
    <UiMenu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger className="ui-chip" aria-label={`${name}: ${chosen?.[1] || ''}`} data-set={value ? '' : undefined}>
        <span className="ui-chip-k">{label}:</span>
        <span className="ui-chip-v">{chosen?.[1]}</span>
        <ChevronDown size={14} aria-hidden="true" className="ui-chip-caret" />
      </MenuTrigger>
      <MenuPanel aria-label={name} minWidth="10rem" width={width} sideOffset={4}>
        {withSearch ? (
          <div className="ui-chip-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={`Find ${String(label).toLowerCase()}`}
              aria-label={`Find ${String(label).toLowerCase()}`}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              /* The menu reads letters as "jump to the item that starts with…"; in the box they are typing.
                 Arrow down and Escape still go to the menu, so the list stays reachable from the keyboard. */
              onKeyDown={(e) => { if (e.key !== 'ArrowDown' && e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); }}
            />
          </div>
        ) : null}
        <MenuRadioGroup value={value} onValueChange={(v) => { onChange(v); onOpenChange(false); }}>
          {shown.map(([v, l]) => (
            <MenuRadioItem key={v || '__all'} value={v} className="ui-chip-item">
              <span className="min-w-0 flex-1 truncate">{l}</span>
              {v === value ? <Check size={14} aria-hidden="true" /> : null}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {withSearch && !shown.length ? <p className="ui-chip-none">Nothing matches “{query.trim()}”.</p> : null}
      </MenuPanel>
    </UiMenu>
  );
}

export default FilterSelect;
