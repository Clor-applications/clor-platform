import React, { useEffect, useId, useRef, useState } from 'react';
import { Search } from '@ui/components/ui/lineIcons';

import { opsSearch } from './api';

/**
 * The search box at the top of every console page (Ops P0): a customer by
 * business or company name, any code, a person's email or name, a GSTIN or a
 * phone number; one of CLOR's invoices by number; or a request ID read off an
 * error. Type, pick with the arrows or the mouse, Enter opens. "/" jumps here.
 */
export function OpsSearch({ go }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const box = useRef(null);
  const listId = useId();

  /* Ask the server a moment after typing stops; an older answer never replaces a newer one. */
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return undefined;
    let live = true;
    const t = setTimeout(() => {
      opsSearch(term)
        .then((res) => live && (setR(res), setActive(0)))
        .catch(() => live && setR({ customers: [], people: [], invoices: [], requestId: null }));
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      e.preventDefault();
      input.current?.focus();
    };
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, []);

  const short = q.trim().length < 2;
  const options = short || !r
    ? []
    : [
        ...r.customers.map((c) => ({ key: `c-${c.id}`, group: 'Customers', title: c.title, sub: [c.code, c.suspended ? 'suspended' : ''].filter(Boolean).join(' · '), open: () => go('customers', {}, c.id) })),
        ...r.people.map((p) => ({ key: `p-${p.id}`, group: 'People', title: p.name || p.email, sub: [p.email, p.accountName].filter(Boolean).join(' · '), open: () => go('customers', {}, p.accountId, 'users') })),
        ...r.invoices.map((i) => ({ key: `i-${i.id}`, group: 'Invoices', title: i.number, sub: i.status.toLowerCase(), open: () => go('invoices', {}, i.id) })),
        ...(r.requestId ? [{ key: 'req', group: 'Request ID', title: `Look up ${r.requestId}`, sub: 'Opens System health with the logs link', open: () => go('health', { request: r.requestId }) }] : []),
      ];

  const pick = (o) => {
    if (!o) return;
    o.open();
    setOpen(false);
    setQ('');
    setR(null);
    input.current?.blur();
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((n) => Math.min(n + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((n) => Math.max(n - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
    }
  };

  const showList = open && !short;
  let lastGroup = '';
  return (
    <div className="ops-search" ref={box}>
      <Search size={16} aria-hidden="true" className="ops-search-icon" />
      <input
        ref={input}
        type="search"
        className="ui-input ops-search-input"
        placeholder="Search customers, people, GSTIN, phone, invoice, request ID"
        aria-label="Search the console"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${listId}-${options[active].key}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (e.target.value.trim().length < 2) setR(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul className="ops-search-list" id={listId} role="listbox" aria-label="Results">
          {!r ? (
            <li className="ops-search-note" role="presentation">Searching…</li>
          ) : options.length ? (
            options.map((o, i) => {
              const head = o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <React.Fragment key={o.key}>
                  {head ? <li className="ops-search-group" role="presentation">{head}</li> : null}
                  <li
                    id={`${listId}-${o.key}`}
                    role="option"
                    aria-selected={i === active}
                    className="ops-search-option"
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(o);
                    }}
                  >
                    <span className="ops-search-title">{o.title}</span>
                    {o.sub ? <span className="ops-search-sub">{o.sub}</span> : null}
                  </li>
                </React.Fragment>
              );
            })
          ) : (
            <li className="ops-search-note" role="presentation">Nothing matches “{q.trim()}”.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
