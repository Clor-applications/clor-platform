import React, { useEffect, useState } from 'react';

import NotConnected from '@ui/components/ui/NotConnected';
import { getAccountOverview } from '@platform/admin/admin';
import { getEntitlement } from '@ui/api/features';
import { ICON, PageHead, Panel, Stat } from './wsKit';
import './workspace.css';

/**
 * Workspace → Plan → Billing (redesign W-R8), built ahead of the service
 * behind it.
 *
 * The plan an account is on is real — stored, deciding what the product
 * offers, and read here from the server — and so is the usage. What does not
 * exist yet is everything a payment provider owns: money taken, a card on
 * file, receipts. Those are not drawn at all, not even as samples: a screen
 * with invoice rows gets demonstrated as this account's. Pricing is not
 * decided here either.
 */
const used = (n, limit) => `${n ?? '—'}${limit ? ` / ${limit}` : ''}`;

export default function BillingPreview() {
  const [plan, setPlan] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // The plan and the usage are real; there is no money to show.
    Promise.all([getEntitlement().catch(() => null), getAccountOverview().catch(() => null)]).then(([ent, acct]) => {
      if (cancelled) return;
      setPlan(ent?.plan || acct?.plan || null);
      setUsage(acct?.usage || ent?.usage || null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Plan', 'Billing']}
          title="Billing"
        />

        <NotConnected what="billing">
          Plan and usage below are live.
        </NotConnected>

        <div className="ws-stats">
          <Stat
            icon={ICON.plan}
            label="Current plan"
            value={plan?.name || '—'}
            note={plan ? (plan.inGoodStanding === false ? `Status: ${plan.status}` : 'Active') : 'Reading the plan…'}
          />
          <Stat icon={ICON.companies} label="Companies" value={used(usage?.companies, plan?.limits?.maxCompanies)} note={plan?.limits?.maxCompanies ? 'Used of the plan’s allowance' : 'No limit on this plan'} />
          <Stat icon={ICON.people} label="Users" value={used(usage?.users, plan?.limits?.maxUsers)} note={plan?.limits?.maxUsers ? 'Used of the plan’s allowance' : 'No limit on this plan'} />
        </div>

        <div className="ws-layout">
          <div className="ws-main">
            <Panel title="Billing history">
              <p className="ws-card-blurb">
                No invoices yet.
              </p>
            </Panel>
          </div>
          <aside className="ws-side">
            <Panel title="Payment method">
              <p className="ws-card-blurb">None on file. Nothing has been charged to this account.</p>
              <p className="ws-card-blurb">Nothing is charged.</p>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}
