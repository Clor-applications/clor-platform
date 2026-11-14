import React, { useEffect, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { PageHead } from '../../apps/admin/src/screens/wsKit';
import { Empty, Err, Loading, Pager, when } from './kit';
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
  useEffect(() => {
    opsAuditFilters().then(setChoices).catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    opsAudit(f)
      .then((r) => live && (setD(r), setError('')))
      .catch((e) => live && setError(String(e?.message || e)));
    return () => {
      live = false;
    };
  }, [f]);
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
      notify.error(String(e?.message || e));
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
          <span className="text-sm font-medium">Staff member</span>
          <select className="ui-select" value={f.operatorId} onChange={set('operatorId')}>
            <option value="">Everybody</option>
            {choices.operators.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">What they did</span>
          <select className="ui-select" value={f.action} onChange={set('action')}>
            <option value="">Anything</option>
            {choices.actions.map((a) => (
              <option key={a.action} value={a.action}>{a.label}</option>
            ))}
          </select>
        </label>
        <CustomerPicker value={account} onChange={(a) => { setAccount(a); setF((v) => ({ ...v, accountId: a?.id || '', page: 0 })); }} />
        <label className="grid gap-1">
          <span className="text-sm font-medium">From</span>
          <input className="ui-input tabular-nums" type="date" value={f.from} onChange={set('from')} />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">To</span>
          <input className="ui-input tabular-nums" type="date" value={f.to} onChange={set('to')} />
        </label>
      </div>
      <Err>{error}</Err>
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
                  <td className="hidden sm:table-cell" data-label="Why" style={{ whiteSpace: 'normal', maxWidth: 420 }}>{e.summary || '—'}</td>
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

/** Type part of a customer's name, ID or owner email; pick from what matches. */
function CustomerPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  useEffect(() => {
    if (!q.trim()) return undefined;
    let live = true;
    const t = setTimeout(() => {
      opsAccounts({ q: q.trim() })
        .then((r) => live && setHits(r.accounts.slice(0, 6)))
        .catch(() => live && setHits([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  if (value) {
    return (
      <div className="grid gap-1">
        <span className="text-sm font-medium">Customer</span>
        <span className="flex items-center gap-2" style={{ minHeight: 40 }}>
          <span>{value.name}</span>
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => onChange(null)}>Clear</button>
        </span>
      </div>
    );
  }
  return (
    <div className="grid gap-1" style={{ position: 'relative' }}>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Customer</span>
        <input className="ui-input" value={q} placeholder="Any customer" onChange={(e) => setQ(e.target.value)} />
      </label>
      {q.trim() && hits.length ? (
        <ul className="ops-picker" role="listbox" aria-label="Matching customers">
          {hits.map((a) => (
            <li key={a.id}>
              <button type="button" role="option" aria-selected="false" onClick={() => { onChange({ id: a.id, name: a.name }); setQ(''); }}>
                {a.name} <span className="ws-item-sub tabular-nums">{a.code}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
