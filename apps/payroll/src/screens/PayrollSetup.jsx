import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, Wallet } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { getPayrollSetup } from '../api/payrollSetup';
/*
 * Switching payroll on goes through the platform, not through a module of this
 * app's own. There is one record of what a company has bought — the feature
 * flags the shell reads — and this screen was importing `../api/features`,
 * which has never existed. That import is why this screen was in the build and
 * in nobody's navigation: mounting it broke the page.
 */
import { setFeature } from '@platform/auth';
import { orgId as platformOrgId, branchId as platformBranchId } from '@platform/context';
import { useFeatures } from '@ui/permissions/useFeatures';

/**
 * Getting payroll running.
 *
 * Payroll is its own application inside the platform, and an application is
 * something you start using rather than a checkbox you find in a list. So this
 * screen is where payroll begins: it is what every payroll route shows before
 * the app is in use, in place of an error nobody can act on.
 *
 * The steps are a checklist, not a wizard. A wizard assumes one person does
 * everything in one sitting; setting up payroll is four people over a week —
 * somebody types the salary structure, somebody in finance maps the ledgers,
 * somebody else knows which statutory schemes apply. So every step is reachable
 * at any time, in any order, and the screen simply says what is still missing.
 *
 * Each step's state is worked out from real records rather than a flag, which
 * means it cannot claim to be done about a company where it is not, and it goes
 * back to undone if somebody deletes what made it true.
 */

export default function PayrollSetup({ onOpen = () => {} }) {
  /* Switching the app on changes the navigation, so the flags the rest of the
     app reads have to be re-read — otherwise Payroll stays a single "start
     using" link until somebody reloads the page. */
  const { reload: reloadFeatures } = useFeatures();
  const [setup, setSetup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      setSetup(await getPayrollSetup());
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not work out where payroll setup has got to.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* Turning the app on is its own act, and the only one on this screen that
     changes anything. Everything else is a way in to the screen that owns the
     decision. */
  const start = async () => {
    setStarting(true);
    try {
      await setFeature(platformOrgId(), platformBranchId(), 'payroll', true);
      notify.success('Payroll is on. Work through the steps below and it is ready to run.');
      reloadFeatures?.();
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not switch payroll on.'));
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <SkeletonCard lines={6} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader entity="settings" title="Payroll" description="Paying people, and the books that follow from it." />
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      </div>
    );
  }

  if (!setup) return null;

  /* Before it is switched on there is nothing to check — the invitation is the
     whole screen. */
  if (!setup.enabled) {
    return (
      <div className="space-y-6">
        <PageHeader entity="settings" title="Payroll" description="Paying people, and the books that follow from it." />

        <div className="ui-card p-6 space-y-3" style={{ maxWidth: '44rem' }}>
          <div className="flex items-center gap-2">
            <Wallet size={18} aria-hidden="true" />
            <div className="ui-t-sec">Start using Payroll</div>
          </div>
          <p className="text-sm">
            Payroll works out what everybody is owed, what is withheld for provident fund, ESI, professional tax and income tax, and
            writes the whole month into the same books the rest of the company uses. It keeps its own records, separate from the
            accounts.
          </p>
          <p className="ui-caption">
            Nothing is paid and nothing reaches the books until you say so. Switching it on just makes it available to set up.
          </p>
          <div>
            <button type="button" className="ui-btn ui-btn-primary" onClick={start} disabled={starting}>
              {starting ? 'Switching on…' : 'Start using Payroll'} <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Set up Payroll"
        description={
          setup.ready
            ? 'Everything payroll needs is in place. It is ready to run.'
            : `${setup.done} of ${setup.total} done. Payroll can run once the rest are.`
        }
        actions={
          setup.ready ? (
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => onOpen('payrollRuns')}>
              Run payroll <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : setup.nextStep ? (
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => onOpen(setup.nextStep.screen)}>
              {setup.nextStep.title} <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : null
        }
      />

      <ol className="ui-card overflow-hidden divide-y" style={{ borderColor: 'rgb(var(--border))', maxWidth: '54rem' }}>
        {setup.steps.map((step, i) => (
          <li key={step.key} className="flex items-start gap-3 px-4 py-3">
            <span
              aria-hidden="true"
              className="mt-0.5 shrink-0 inline-flex items-center justify-center rounded-full"
              style={{
                width: 22,
                height: 22,
                fontSize: 12,
                background: step.done ? 'rgb(var(--pos))' : 'rgb(var(--surface-2, var(--border)))',
                color: step.done ? 'white' : 'inherit',
              }}
            >
              {step.done ? <Check size={13} aria-hidden="true" /> : i + 1}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{step.title}</span>
                <span className={`ui-pill ${step.done ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{step.done ? 'Done' : 'To do'}</span>
              </div>
              <p className="ui-caption">{step.blurb}</p>
              <p className="ui-caption">{step.detail}</p>
            </div>

            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm shrink-0" onClick={() => onOpen(step.screen)}>
              {step.done ? 'Review' : 'Set up'}
            </button>
          </li>
        ))}
      </ol>

      <p className="ui-caption" style={{ maxWidth: '54rem' }}>
        The steps can be done in any order and by different people — somebody types the salary structure, somebody in finance maps the
        ledgers. This list reads what is actually there, so it stays right whoever did what.
      </p>
    </div>
  );
}
