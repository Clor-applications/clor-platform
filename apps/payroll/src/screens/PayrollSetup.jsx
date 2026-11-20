import React, { useCallback, useEffect, useRef, useState } from 'react';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { ArrowRight, Check, Wallet } from '@ui/components/ui/lineIcons';

import { PageHeader, SkeletonCard, Button } from '@ui/components/ui/Primitives';
import { FormPart } from '@ui/components/ui/FormPart';
import { notify } from '@ui/components/ui/notify';
import { getPayrollSetup } from '../api/payrollSetup';
import { ProvisionalDaysSetting } from '../components/ProvisionalDaysSetting';
import { DeductionCapSetting } from '../components/DeductionCapSetting';
import { FnfRecoverySetting } from '../components/FnfRecoverySetting';
import { StatutoryRegistrationsStep } from '../components/StatutoryRegistrationsStep';
import { errorWords } from '@ui/utils/errorWords';
/*
 * Switching payroll on goes through the platform, not through a module of this
 * app's own. There is one record of what a company has bought — the feature
 * flags the shell reads — and this screen was importing `../api/features`,
 * which has never existed. That import is why this screen was in the build and
 * in nobody's navigation: mounting it broke the page.
 */
import { setFeature } from '@platform/auth';
import { orgId as platformOrgId, branchId as platformBranchId, requestOpenScreen } from '@platform/context';
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

/* The step list names screens the way the server does; the shell knows them by their navigation keys. */
const SCREEN_KEYS = {
  payrollRuns: 'runs',
  payrollPeriods: 'periods',
  payrollComponents: 'components',
  salaryStructures: 'structures',
  payrollCompliancePage: 'compliance',
  payrollLedgerMapping: 'ledgers',
  salaryAssignments: 'assignments',
  payrollSetup: 'setup',
};
const openScreen = (key) => requestOpenScreen(SCREEN_KEYS[key] || key);

export default function PayrollSetup({ onOpen = openScreen, params }) {
  /* Switching the app on changes the navigation, so the flags the rest of the
     app reads have to be re-read — otherwise Payroll stays a single "start
     using" link until somebody reloads the page. */
  const { reload: reloadFeatures } = useFeatures();
  const [setup, setSetup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  /* The registrations step is answered on this page: its "Set up" opens the form below and goes to it. */
  const [registrationsOpen, setRegistrationsOpen] = useState(params?.step === 'registrations');
  const registrationsRef = useRef(null);
  const openRegistrations = () => {
    setRegistrationsOpen(true);
    registrationsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  useEffect(() => {
    if (params?.step === 'registrations') registrationsRef.current?.scrollIntoView?.({ block: 'start' });
  }, [params?.step, loading]);

  const load = useCallback(async () => {
    try {
      setSetup(await getPayrollSetup());
      setError('');
    } catch (e) {
      setError(errorWords(e, 'load Payroll setup'));
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
      notify.error(errorWords(e, 'switch payroll on'));
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <SkeletonCard lines={6} />;

  if (error) {
    return (
      <div className="space-y-3">
        <PageHeader entity="settings" title="Setup" description="Paying people, and the books that follow from it." />
        <div className="px-5 lg:px-7 pb-8 space-y-4 max-w-3xl">
        <LoadFailed message={error} onRetry={load} />
        </div>
      </div>
    );
  }

  if (!setup) return null;

  /* Before it is switched on there is nothing to check — the invitation is the
     whole screen. */
  if (!setup.enabled) {
    return (
      <div className="space-y-3">
        <PageHeader entity="settings" title="Setup" description="Paying people, and the books that follow from it." />
        <div className="px-5 lg:px-7 pb-8 space-y-4 max-w-3xl">

        <FormPart id="start-payroll" title="Start using Payroll" className="max-w-[44rem]">
          <div className="space-y-3">
          <p className="text-sm">
            Payroll works out what everybody is owed, what is withheld for provident fund, ESI, professional tax and income tax, and
            writes the whole month into the same books the rest of the company uses. It keeps its own records, separate from the
            accounts.
          </p>
          <p className="ui-caption">
            Nothing is paid and nothing reaches the books until you say so. Switching it on just makes it available to set up.
          </p>
          <div>
            <Button variant="primary" icon={Wallet} onClick={start} loading={starting}>
              {starting ? 'Switching on…' : 'Start using Payroll'}
            </Button>
          </div>
          </div>
        </FormPart>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader
        entity="settings"
        title="Setup"
        description={
          setup.ready
            ? setup.done === setup.total
              ? 'Everything payroll needs is in place. It is ready to run.'
              : `${setup.done} of ${setup.total} done. Payroll can run; the rest can be added later.`
            : `${setup.done} of ${setup.total} done. Payroll can run once the rest are.`
        }
        actions={
          setup.ready ? (
            <button type="button" className="ui-btn ui-btn-primary !ps-4 !pe-3.5" onClick={() => onOpen('payrollRuns')}>
              Run payroll <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : setup.nextStep ? (
            <button type="button" className="ui-btn ui-btn-primary !ps-4 !pe-3.5" onClick={() => onOpen(setup.nextStep.screen)}>
              {setup.nextStep.title} <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : null
        }
      />
      <div className="px-5 lg:px-7 pb-8 space-y-4 max-w-3xl">

      <ol className="ui-list-surface overflow-hidden divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        {setup.steps.map((step, i) => (
          <li key={step.key} className="flex items-start gap-3 px-4 py-3">
            {/* The step's marker: a hairline ring with its number, or a tick in the done ink. Classes and tokens, no fill. */}
            <span
              aria-hidden="true"
              className={`mt-0.5 shrink-0 inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${
                step.done ? 'border-[rgb(var(--pos))] text-[rgb(var(--pos))]' : 'border-[rgb(var(--border-field))] text-[rgb(var(--fg-muted))]'
              }`}
            >
              {step.done ? <Check size={13} aria-hidden="true" /> : i + 1}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{step.title}</span>
                {/* Done is what a step should be, so only the step still to do carries a tag. */}
                {step.done ? <span className="sr-only">Done</span> : <span className="ui-pill ui-pill-neutral">To do</span>}
              </div>
              <p className="ui-caption">{step.blurb}</p>
              <p className="ui-caption">{step.detail}</p>
            </div>

            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-sm shrink-0"
              onClick={() => (step.key === 'registrations' ? openRegistrations() : onOpen(step.screen))}
            >
              {step.done ? 'Review' : 'Set up'}
            </button>
          </li>
        ))}
      </ol>

      {/* The numbers each return is filed under: asked here, kept where Compliance keeps them. */}
      <div ref={registrationsRef}>
        <StatutoryRegistrationsStep startOpen={registrationsOpen} onSaved={load} />
      </div>

      {/* How a run treats the days of the month that have not happened yet (O-11). */}
      <ProvisionalDaysSetting />

      {/* How much of a payslip's wages deductions may take. */}
      <DeductionCapSetting />

      {/* How much of a leaver's final wages loans and advances may take. */}
      <FnfRecoverySetting />

      </div>
    </div>
  );
}
