import React, { useEffect, useState } from 'react';
import { PageHead, ago } from '../../apps/admin/src/screens/wsKit';
import { CountLine } from '@ui/components/ui/CountLine';
import { opsBrokenConnections } from './api';
import { Empty, Err, Loading, errorWords } from './kit';

/**
 * Broken connections (server: /ops/connections/broken): every customer's reader, site agent, HR
 * connection, single sign-on or e-invoice link that is not working, longest broken first. Background
 * jobs counted these; nothing listed them, so finding the customer meant opening accounts one by one.
 * A row opens that customer's Connections tab, where Support acts. Read only.
 */
const STATE = { error: ['Failing', 'danger'], offline: ['Silent', 'warn'] };

export function BrokenConnections({ openCustomer }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('');
  useEffect(() => {
    let live = true;
    opsBrokenConnections()
      .then((r) => live && setD(r))
      .catch((e) => live && setError(errorWords(e, 'load the broken connections')));
    return () => {
      live = false;
    };
  }, []);

  const kinds = Object.entries(d?.kinds || {}).sort((a, b) => b[1] - a[1]);
  const rows = (d?.items || []).filter((r) => !kind || r.kind === kind);
  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead crumbs={['Platform']} title="Broken connections" description="Every customer’s reader, agent, HR connection, sign-on or e-invoice link that is not working. Longest broken first." />
        {d?.items?.length ? (
          <CountLine
            label="Broken connection figures"
            items={[
              { key: 'all', label: d.items.length === 1 ? 'connection not working' : 'connections not working', value: d.items.length, onClick: () => setKind(''), active: !kind },
              { key: 'customers', label: d.customers === 1 ? 'customer' : 'customers', value: d.customers },
              ...kinds.map(([k, n]) => ({ key: k, label: k, value: n, onClick: () => setKind((was) => (was === k ? '' : k)), active: kind === k })),
            ]}
          />
        ) : null}
        <Err>{error}</Err>
        {!d ? (
          error ? null : <Loading />
        ) : !d.items.length ? (
          <Empty>Every connection that is switched on is working.</Empty>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Connections that are not working, by customer</caption>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Connection</th>
                  <th>State</th>
                  <th>What it said</th>
                  <th>Last worked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [word, tone] = STATE[r.state] || [r.state, 'off'];
                  return (
                    <tr key={`${r.kind}:${r.id}`}>
                      <td>
                        <button type="button" className="ws-name-link" onClick={() => openCustomer(r.accountId)}>{r.customer || 'A customer'}</button>
                      </td>
                      <td>
                        {r.name}
                        <div className="ws-item-sub">{r.kind}</div>
                      </td>
                      <td><span className={`ws-pill ws-pill--${tone}`}>{word}</span></td>
                      <td style={{ whiteSpace: 'normal' }}>{r.error || (r.state === 'offline' ? 'Has not called in for a day or more' : '')}</td>
                      <td>{r.since ? ago(r.since) : 'Never'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
