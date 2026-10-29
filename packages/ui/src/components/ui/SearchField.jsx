import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from '@ui/components/ui/lineIcons';

/**
 * SearchField (People design spec v1 §5): debounced, with a clear button.
 * Enter runs the search at once; Escape clears it (and a second Escape is left
 * to whatever popup holds the field). No Enter while an IME is composing.
 * `onSearch` gets the trimmed text after `delay` ms of quiet, or on Enter.
 */
export default function SearchField({ value = '', onSearch, delay = 300, placeholder = 'Search', label = 'Search', className = '', autoFocus = false }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const timer = useRef(null);
  /* A value changed from outside (a saved view, Clear filters) shows here. */
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  /* `value` is the search in force; nothing is sent when the text already matches it. */
  const send = (next) => {
    clearTimeout(timer.current);
    const trimmed = next.trim();
    if (trimmed === String(value || '').trim()) return;
    onSearch?.(trimmed);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (next) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send(next), delay);
  };
  return (
    <div className={`ui-search-field relative flex items-center ${className}`}>
      <Search size={16} aria-hidden="true" className="ui-subtle pointer-events-none absolute left-2.5" />
      <input
        type="search"
        role="searchbox"
        aria-label={label}
        className="ui-input w-full pl-8 pr-8"
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            send(text);
          } else if (e.key === 'Escape' && text) {
            e.preventDefault();
            e.stopPropagation();
            setText('');
            send('');
          }
        }}
      />
      {text ? (
        <button type="button" className="ui-icon-btn absolute right-1" aria-label="Clear search" onClick={() => { setText(''); send(''); }}>
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
