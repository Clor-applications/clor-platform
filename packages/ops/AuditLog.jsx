import React, { useEffect, useId, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { PageHead } from '../../apps/admin/src/screens/wsKit';
import { Empty, Err, Loading, Pager, when, errorWords } from './kit';
import { opsAccounts, opsAudit, opsAuditExport, opsAuditFilters } from './api';

/**
 * The audit log (operator console): everything CLOR staff did, newest first,
 * by staff member, action, customer and date, and the same as a CSV file.
 * The record cannot be changed or deleted, by anybody (server trigger).
 */
export function AuditLog({ initialAccount = null, openCustomer }) {
  const [f, setF] = useState({ operatorId: '', action: '', accountId: initialAccount?.id || '', from: '', to: '', page: 0 });
  const [account, setAccount] = useState(initialAccount);
  const [choices, setChoices] = useState({ operators: [], actions: [] });
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    opsAuditFilters().then(setChoices).catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    opsAudit(f)
      .then((r) => live && (setD(r), setError('')))
      .catch((e) => live && setError(errorWords(e, 'load the Staff audit log')));
    return () => {
      live = false;
    };
  }, [f, tick]);
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value, page: 0 }));

  const download = async () => {
    setBusy(true);
    try {
      const { page: _page, ...filters } = f;
      const text = await opsAuditExport(filters);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `clor-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify.success('Downloaded. The download is in the audit log too.');
    } catch (e) {
      notify.error(errorWords(e, 'download the Staff audit log'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Staff audit log"
        description="Every change a CLOR staff member made, with who, when, the customer and the reason. Nobody can edit or remove a line."
        actions={
          <button type="button" className="ws-btn ws-btn--quiet" disabled={busy || !d?.events?.length} onClick={download}>
            {busy ? 'Preparing…' : 'Download CSV'}
          </button>
        }
      />
      <div className="ops-filters" role="search">
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Staff member</span>
          <select className="ui-select" value={f.operatorId} onChange={set('operatorId')}>
            <option value="">Everybody</option>
            {choices.operators.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-semibold">What they did</span>
          <select className="ui-select" value={f.action} onChange={set('action')}>
            <option value="">Anything</option>
            {choices.actions.map((a) => (
              <option key={a.action} value={a.action}>{a.label}</option>
            ))}
          </select>
        </label>
        <CustomerPicker value={account} onChange={(a) => { setAccount(a); setF((v) => ({ ...v, accountId: a?.id || '', page: 0 })); }} />
        <label className="grid gap-1">
          <span className="text-sm font-semibold">From</span>
          <input className="ui-input tabular-nums" type="date" value={f.from} onChange={set('from')} />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-semibold">To</span>
          <input className="ui-input tabular-nums" type="date" value={f.to} onChange={set('to')} />
        </label>
      </div>
      <Err onRetry={() => setTick((n) => n + 1)}>{error}</Err>
      {!d ? (
        error ? null : <Loading />
      ) : d.events.length === 0 ? (
        <Empty>Nothing recorded for these filters.</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table ops-stack">
            <caption className="sr-only">Everything CLOR staff did, newest first</caption>
            <thead>
              <tr>
                <th>When</th>
                <th>Staff member</th>
                <th>What they did</th>
                <th className="hidden md:table-cell">Customer</th>
                <th className="hidden sm:table-cell">Why, or what changed</th>
              </tr>
            </thead>
            <tbody>
              {d.events.map((e) => (
                <tr key={e.id}>
                  <td className="tabular-nums" data-label="When">{when(e.at)}</td>
                  <td data-label="Staff member">{e.operator?.fullName || e.operator?.email || '—'}</td>
                  <td className="ops-primary" style={{ whiteSpace: 'normal' }}>
                    {e.label}
                    {e.targetUser ? <div className="ws-item-sub">{e.targetUser.email}</div> : null}
                  </td>
                  <td className="hidden md:table-cell" data-label="Customer">
                    {e.targetAccountId ? (
                      <button type="button" className="ws-name-link" onClick={() => openCustomer(e.targetAccountId)}>{e.accountName || 'Customer'}</button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="hidden sm:table-cell" data-label="Why" style={{ whiteSpace: 'normal', maxWidth: 420 }}>
                    {e.summary || '—'}
                    {e.details ? <div className="ws-item-sub">{e.details}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d ? <Pager page={f.page} hasMore={d.hasMore} onPage={(page) => setF((v) => ({ ...v, page }))} /> : null}
    </>
  );
}

/**
 * Type part of a customer's name, ID or owner email; pick from what matches. A combobox like the
 * console search: arrows move, Enter picks, Escape or leaving the field closes the list. "No account
 * matches" is said only once the server has answered; a failed search says so.
 */
function CustomerPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState({ state: 'idle', hits: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const term = q.trim();
  useEffect(() => {
    if (!term) return undefined;
    let live = true;
    const t = setTimeout(() => {
      opsAccounts({ q: term })
        .then((r) => {
          if (!live) return;
          setRes({ state: 'done', hits: (r?.accounts || []).slice(0, 6) });
          setActive(0);
        })
        .catch(() => live && setRes({ state: 'error', hits: [] }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [term]);
  const pick = (a) => {
    if (!a) return;
    onChange({ id: a.id, name: a.name });
    setQ('');
    setOpen(false);
    setRes({ state: 'idle', hits: [] });
  };
  const hits = res.state === 'done' ? res.hits : [];
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((n) => Math.min(n + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((n) => Math.max(n - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && hits[active]) {
        e.preventDefault();
        pick(hits[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };
  if (value) {
    return (
      <div className="grid gap-1">
        <span className="text-sm font-semibold">Customer</span>
        <span className="flex items-center gap-2" style={{ minHeight: 40 }}>
          <span>{value.name}</span>
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => onChange(null)}>Clear</button>
        </span>
      </div>
    );
  }
  const showList = open && Boolean(term);
  return (
    <div className="grid gap-1" style={{ position: 'relative' }}>
      <label className="grid gap-1">
        <span className="text-sm font-semibold">Customer</span>
        <input
          className="ui-input"
          value={q}
          placeholder="Any customer"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${listId}-${hits[active].id}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (e.target.value.trim() !== term) setRes({ state: 'loading', hits: [] });
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </label>
      {showList ? (
        <ul className="ops-picker" id={listId} role="listbox" aria-label="Matching customers">
          {res.state === 'loading' || res.state === 'idle' ? (
            <li className="ops-search-note" role="presentation">Searching…</li>
          ) : res.state === 'error' ? (
            <li className="ops-search-note" role="presentation">The search did not answer. Type again to retry.</li>
          ) : hits.length ? (
            hits.map((a, i) => (
              <li
                key={a.id}
                id={`${listId}-${a.id}`}
                role="option"
                aria-selected={i === active}
                className="ops-search-option"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(a);
                }}
              >
                <span className="ops-search-title">{a.name}</span>
                {a.code ? <span className="ops-search-sub tabular-nums">{a.code}</span> : null}
              </li>
            ))
          ) : (
            <li className="ops-search-note" role="presentation">No account matches.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
