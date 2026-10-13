import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from '@ui/chrome/SettingsScreenHeader';
import { notify } from '@ui/components/ui/notify';
import { listSalaryComponents, setComponentLedgers } from '../api/payrollComponents';
import { expenseAccounts, withheldToAccounts } from '../api/payrollAccounting';

/**
 * Where each part of a salary lands in the books.
 *
 * Payroll is usually the largest entry a company writes each month, and it
 * cannot be written at all until every component knows which account it posts
 * to. Companies discover this at the worst moment — the first time they press
 * Post, with payslips already produced — so this screen is built to be read as
 * a checklist rather than a form: what is still unmapped is the first thing on
 * it, and each row says plainly what it is waiting for.
 *
 * Which accounts a component may post to follows from what it is, and the
 * screen does not offer the wrong ones:
 *
 *   An earning is a cost. It needs an expense account and nothing else.
 *   A deduction is money withheld, and where it lands depends on why. Most is
 *     owed onward to somebody else — a fund, the tax department — which is a
 *     liability. But a loan recovery is the company taking back money it lent,
 *     which reduces an asset. So a deduction may post to either, and never to
 *     income.
 *   An employer contribution is a cost and a debt in one movement, so it needs
 *     both.
 */

const NEEDS = {
  EARNING: { expense: true, liability: false, why: 'An earning is a cost to the company.' },
  DEDUCTION: {
    expense: false,
    liability: true,
    why: 'Most of what is withheld is owed onward, which is a liability; a loan recovery takes back money the company lent, which reduces an asset.',
  },
  EMPLOYER_CONTRIBUTION: { expense: true, liability: true, why: 'An employer contribution is a cost and a debt in one movement.' },
};

const TYPE_LABEL = {
  EARNING: 'Earning',
  DEDUCTION: 'Deduction',
  EMPLOYER_CONTRIBUTION: 'Employer cost',
};

export default function PayrollLedgerMapping() {
  const [components, setComponents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [withheldTo, setWithheldTo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [rows, expense, withheld] = await Promise.all([
        listSalaryComponents(),
        expenseAccounts(),
        withheldToAccounts(),
      ]);
      setComponents(rows);
      setExpenses(expense);
      setWithheldTo(withheld);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load the ledger mapping.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* Which accounts each kind may post to is decided by the integration
     boundary, not by filtering a chart of accounts on the screen. */
  const accounts = useMemo(() => [...expenses, ...withheldTo], [expenses, withheldTo]);

  const missing = useMemo(
    () =>
      components.filter((c) => {
        if (!c.isActive) return false;
        const needs = NEEDS[c.type] || {};
        return (needs.expense && !c.expenseLedgerId) || (needs.liability && !c.liabilityLedgerId);
      }),
    [components]
  );

  const save = async (component, patch) => {
    setBusy(component.id);
    try {
      await setComponentLedgers(component.id, {
        expenseLedgerId: component.expenseLedgerId || null,
        liabilityLedgerId: component.liabilityLedgerId || null,
        ...patch,
      });
      notify.success(`${component.name} mapped.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not save that mapping.'));
    } finally {
      setBusy('');
    }
  };

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Ledger mapping"
        description="Which account each part of a salary posts to. Payroll cannot be written into the books until every component here has one."
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {!accounts.length ? (
        <EmptyState
          title="No accounts to post to"
          description="Payroll posts into the same chart of accounts everything else uses. Set that up first and each component can be pointed at one."
        />
      ) : !components.length ? (
        <EmptyState
          title="No salary components yet"
          description="Add the earnings and deductions a salary is built from, and each one can be told where it posts."
        />
      ) : (
        <>
          {missing.length ? (
            <div className="ui-card p-3 flex items-start gap-2">
              <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
              <p className="text-sm">
                {missing.length} {missing.length === 1 ? 'component has' : 'components have'} nowhere to post yet, so payroll cannot be
                written into the books: {missing.map((c) => c.name).join(', ')}.
              </p>
            </div>
          ) : (
            <div className="ui-card p-3 flex items-start gap-2">
              <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--pos))' }} />
              <p className="text-sm">Everything has somewhere to post. Payroll can be written into the books.</p>
            </div>
          )}

          <div className="ui-card overflow-hidden">
            <div className="overflow-x-auto ui-table-scroll">
              <table className="ui-table w-full">
                <thead>
                  <tr>
                    <th scope="col" className="ui-th">Component</th>
                    <th scope="col" className="ui-th">Kind</th>
                    <th scope="col" className="ui-th">Expense account</th>
                    <th scope="col" className="ui-th">Withheld to</th>
                    <th scope="col" className="ui-th ui-col-h-center">Ready</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((c) => {
                    const needs = NEEDS[c.type] || {};
                    const ready = (!needs.expense || c.expenseLedgerId) && (!needs.liability || c.liabilityLedgerId);
                    return (
                      <tr key={c.id} style={c.isActive ? undefined : { opacity: 0.55 }}>
                        <td className="ui-col-entity">
                          {c.name}
                          <span className="ui-caption"> · {c.code}</span>
                          {c.isActive ? null : <span className="ui-caption"> · no longer in use</span>}
                        </td>
                        <td className="ui-col-meta">{TYPE_LABEL[c.type] || c.type}</td>
                        <td>
                          {needs.expense ? (
                            <select
                              className="ui-select w-full"
                              aria-label={`Expense account for ${c.name}`}
                              value={c.expenseLedgerId || ''}
                              disabled={busy === c.id}
                              onChange={(e) => save(c, { expenseLedgerId: e.target.value || null })}
                            >
                              <option value="">Not set</option>
                              {expenses.map((a) => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="ui-caption">Not needed</span>
                          )}
                        </td>
                        <td>
                          {needs.liability ? (
                            <select
                              className="ui-select w-full"
                              aria-label={`Account withheld to for ${c.name}`}
                              value={c.liabilityLedgerId || ''}
                              disabled={busy === c.id}
                              onChange={(e) => save(c, { liabilityLedgerId: e.target.value || null })}
                            >
                              <option value="">Not set</option>
                              {withheldTo.map((a) => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="ui-caption">Not needed</span>
                          )}
                        </td>
                        <td>
                          <span className={`ui-pill ${ready ? 'ui-pill-pos' : 'ui-pill-warn'}`}>{ready ? 'Yes' : 'Not yet'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="ui-caption">
            {NEEDS.DEDUCTION.why} {NEEDS.EMPLOYER_CONTRIBUTION.why} A payslip already produced keeps the mapping it was calculated with;
            changing one here applies to what is posted from now on.
          </p>
        </>
      )}
    </div>
  );
}
