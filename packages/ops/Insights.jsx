import React, { useEffect, useState } from 'react';
import { ICON, PageHead, Panel, Stat } from '../../apps/admin/src/screens/wsKit';
import { opsInsights } from './api';
import { inr } from './money';
import { APP_NAMES, Empty, Err, Loading, when, errorWords } from './kit';

/**
 * Insights (server: routes/opsInsights.ts): how CLOR is doing as a business,
 * from what is stored. Recurring revenue comes from the subscriptions staff
 * priced; a yearly price counts as a twelfth a month. A bundle's money is
 * shared evenly across its apps.
 */
const STATE_WORD = { trialing: 'Trial', active: 'Active', past_due: 'Overdue', paused: 'Paused', cancelled: 'Cancelled' };
const monthWord = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const Num = ({ children }) => <td className="num tabular-nums" style={{ textAlign: 'right' }}>{children}</td>;
const NumHead = ({ children }) => <th className="num" style={{ textAlign: 'right' }}>{children}</th>;

export function Insights() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    opsInsights().then(setD).catch((e) => setError(errorWords(e, 'load the insights')));
  }, []);
  if (!d) {
    return (
      <div className="ws"><div className="ws-inner">{error ? <Err>{error}</Err> : <Loading />}</div></div>
    );
  }
  const months = [...d.months].reverse();
  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead crumbs={['Overview']} title="Insights" description="Revenue and customers, from the subscriptions and invoices CLOR holds." counts={`As of ${when(d.asOf)}`} />
        {/* At most four figures, and none at zero (DESIGN.md "Layout"; design audit step 2). */}
        {d.mrr || d.paying || d.byState.trialing || d.byState.past_due ? (
          <div className="ws-stats">
            {d.mrr ? <Stat icon={ICON.payments} label="Monthly recurring revenue" value={inr(d.mrr)} note={`${inr(d.arr)} a year at this rate`} /> : null}
            {d.paying ? <Stat icon={ICON.companies} label="Paying customers" value={d.paying} note={`${inr(d.averagePerCustomer)} a month on average`} /> : null}
            {d.byState.trialing ? <Stat icon={ICON.plan} tone={d.trialsEndingSoon ? 'warn' : null} label="Trial" value={d.byState.trialing} note={d.trialsEndingSoon ? `${d.trialsEndingSoon} end in the next 7 days` : 'None end this week'} /> : null}
            {d.byState.past_due ? <Stat icon={ICON.warning} tone="warn" label="Overdue" value={d.byState.past_due} note={`${d.byState.cancelled || 0} cancelled in all`} /> : null}
          </div>
        ) : null}

        <Panel title="By app">
          {!d.byApp.length ? (
            <Empty>No customer has an app yet.</Empty>
          ) : (
            <div className="ws-table-wrap">
              <table className="ws-table">
                <caption className="sr-only">Customers and monthly revenue by app</caption>
                <thead>
                  <tr>
                    <th>App</th>
                    <NumHead>Customers, trial or paying</NumHead>
                    <NumHead>Monthly revenue</NumHead>
                  </tr>
                </thead>
                <tbody>
                  {d.byApp.map((r) => (
                    <tr key={r.app}>
                      <td>{APP_NAMES[r.app] || r.app}</td>
                      <Num>{r.customers}</Num>
                      <Num>{inr(r.mrr)}</Num>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="By plan">
          {!d.byPlan.length ? (
            <Empty>No priced subscription yet. Set one from a customer’s Subscription tab.</Empty>
          ) : (
            <div className="ws-table-wrap">
              <table className="ws-table">
                <caption className="sr-only">Paying customers and monthly revenue by plan</caption>
                <thead>
                  <tr>
                    <th>Plan</th>
                    <NumHead>Paying customers</NumHead>
                    <NumHead>Monthly revenue</NumHead>
                  </tr>
                </thead>
                <tbody>
                  {d.byPlan.map((r) => (
                    <tr key={r.plan}>
                      <td>{r.plan}</td>
                      <Num>{r.customers}</Num>
                      <Num>{inr(r.mrr)}</Num>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Month by month">
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Sign-ups, money collected and cancellations, last twelve months</caption>
              <thead>
                <tr>
                  <th>Month</th>
                  <NumHead>New accounts</NumHead>
                  <NumHead>Collected</NumHead>
                  <NumHead>Cancelled</NumHead>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month}>
                    <td>{monthWord(m.month)}</td>
                    <Num>{m.signups}</Num>
                    <Num>{inr(m.collected)}</Num>
                    <Num>{m.cancellations}</Num>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ws-card-blurb mt-2">Collected counts paid CLOR invoices. Cancelled counts plans ended from this console.</p>
        </Panel>

        <Panel title="Customers by state">
          <dl className="ws-rows">
            {Object.entries(STATE_WORD).map(([k, label]) => (
              <div key={k}>
                <dt>{label}</dt>
                <dd className="tabular-nums">{d.byState[k] || 0}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
