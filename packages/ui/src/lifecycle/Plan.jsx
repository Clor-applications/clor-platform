import React, { useState } from 'react';

import Drawer from '@ui/components/ui/Drawer';
import { SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import { formatDate } from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { getChecklist } from '@ui/personnel/api';
import { hasApp } from '@platform/context';

import { OWNER_WORD, leavingExtras, leavingPreview, startPlan } from './api';
import { TaskDrawer, readerWords } from './shared';
import LeavingSections, { FinalPayBanner } from './LeavingExtras';

/**
 * One person's joining or leaving plan, from the Joining and Leaving lists:
 * every step with its owner, date and state; a step opens to be closed or
 * handed on (the server refuses closing one's own plan, and the drawer says
 * so). A plan that never started has a Start button. Leaving also
 * shows who their team reports to after the last day and what they hold.
 * `row.lineOnly`: someone outside the person's team who owns a no-dues line sees that line, not the plan.
 */
/*
 * The leaving's header from the latest read, not the list row it was opened from: right after "They stay" it
 * says so, and a moved last day shows the new one.
 */
const leavingWords = (row, now) => {
  if (now && !now.dateOfLeaving) return 'Staying on: the leaving was withdrawn';
  const day = now?.dateOfLeaving || row.dateOfLeaving;
  const stage = now && now.dateOfLeaving !== row.dateOfLeaving ? null : row.stageLabel;
  return `Last day ${formatDate(day)}${stage ? ` · ${stage}` : ''}`;
};

export default function PlanDrawer({ row, kind, canEdit, canAssign, openScreen, onClose, onChanged }) {
  const plan = useRequest(() => (row.lineOnly ? Promise.resolve(null) : getChecklist(row.id)), [row.id, row.lineOnly]);
  const preview = useRequest(() => (kind === 'LEAVING' && !row.lineOnly ? leavingPreview(row.id) : Promise.resolve(null)), [row.id, kind, row.lineOnly]);
  /* The final-pay clock, no-dues and exit interview (WORKFLOW-GAP-RESEARCH 4.3, 4.9); a refusal or failure just leaves them out. */
  const extras = useRequest(() => (kind === 'LEAVING' ? leavingExtras(row.id).catch(() => null) : Promise.resolve(null)), [row.id, kind]);
  const extrasChanged = () => { extras.reload(); if (!row.lineOnly) plan.reload(); onChanged?.(); };
  const [task, setTask] = useState(null);
  const [starting, setStarting] = useState(false);
  const list = plan.data?.[kind === 'JOINING' ? 'joining' : 'leaving'];
  const start = async () => {
    setStarting(true);
    try {
      await startPlan(row.id, kind);
      notify.success('Plan started.');
      plan.reload();
      onChanged?.();
    } catch (e) {
      notify.error(String(e?.message || 'Not started.'));
    } finally {
      setStarting(false);
    }
  };
  const p = preview.data;
  /* Withdrawn while the plan was open ("They stay"): nothing of a leaving is left to do, so none of it is offered. */
  const staying = kind === 'LEAVING' && Boolean(extras.data?.person) && !extras.data.person.dateOfLeaving;
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(38rem,96vw)]" title={row.name} description={kind === 'JOINING' ? `Joins ${formatDate(row.dateOfJoining)} · ${row.stageLabel}` : leavingWords(row, extras.data?.person)}
      footer={<>
        {openScreen && !row.lineOnly ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => openScreen('employee', { id: row.id })}>Open their record</button> : null}
        <button type="button" className="ui-btn ui-btn-primary" onClick={onClose}>Close</button>
      </>}>
      <div className="grid gap-6">
        {kind === 'LEAVING' && extras.data?.finalPay ? <FinalPayBanner clock={extras.data.finalPay} /> : null}
        {kind === 'JOINING' && row.invite ? <p className="text-sm">Joining form: {{ SENT: 'sent, not opened yet', STARTED: 'opened, not sent back', RETURNED: 'sent back: check it on their record', CHECKED: 'checked', EXPIRED: 'the link ran out', CANCELLED: 'cancelled' }[row.invite.status] || row.invite.status.toLowerCase()}.</p> : null}
        {staying ? <p className="text-sm">They stay. The leaving was withdrawn: its steps, no-dues lines and exit interview are kept on their record, and nothing more is asked.</p> : null}
        {row.lineOnly || staying ? null : plan.error && !plan.data ? <ErrorState error={plan.error} onRetry={plan.reload} compact /> : !list ? <SkeletonCard lines={5} /> : list.total ? (
          <section aria-label="Steps" className="space-y-2">
            <div className="flex items-center justify-between gap-2"><h3 className="ui-t-sec">Steps</h3><span className="ui-caption tabular-nums">{list.done} of {list.total} done</span></div>
            <ul className="divide-y border-t">
              {list.tasks.map((t) => (
                <li key={t.id}>
                  <button type="button" className="flex w-full items-start gap-3 py-2 text-left" onClick={() => setTask({ ...t, kind, employee: { id: row.id, name: row.name }, late: t.overdue })}>
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${t.done ? 'ui-dot-pos' : t.overdue ? 'ui-dot-neg' : 'ui-dot-quiet'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${t.done ? 'ui-muted' : ''}`}>{t.title}<span className="sr-only">{t.done ? ', done' : t.overdue ? ', late' : ', open'}</span></span>
                      <span className="block ui-caption">
                        {t.ownerName ? `${t.ownerName} (${OWNER_WORD[t.owner] || t.owner})` : OWNER_WORD[t.owner] || t.owner}
                        {t.dueDate ? <span className={t.overdue ? 'ui-text-neg' : ''}> · {t.done ? 'due' : t.overdue ? 'was due' : 'due'} {formatDate(t.dueDate)}</span> : null}
                        {t.done && t.doneBy ? ` · done by ${t.doneBy}` : ''}
                      </span>
                      {t.system === 'READERS' && !t.done ? <span className={`block ui-caption ${t.systemState === 'FAILED' ? 'ui-text-neg font-medium' : ''}`}>{readerWords(t)}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">No {kind === 'JOINING' ? 'joining' : 'leaving'} plan yet. CLOR starts it within a quarter of an hour.</p>
            {canEdit ? <button type="button" className="ui-btn ui-btn-secondary" disabled={starting} onClick={start}>{starting ? 'Starting…' : 'Start it now'}</button> : null}
          </div>
        )}

        {kind === 'LEAVING' && p && !staying ? (
          <section aria-label="After the last day" className="space-y-2">
            <h3 className="ui-t-sec">After the last day</h3>
            {p.reports.length ? (
              <p className="text-sm">{p.reports.length === 1 ? `${p.reports[0].name} reports` : `${p.reports.length} people report`} to {row.name}. They will report to {p.nextManager ? p.nextManager.name : 'nobody (no manager above)'}; move them on their records before the day to choose someone else.</p>
            ) : <p className="text-sm ui-muted">Nobody reports to them.</p>}
            {p.assets.length ? <p className="text-sm">They hold {p.assets.map((a) => `${a.title}${a.tag ? ` (${a.tag})` : ''}`).join(', ')}. Each is a step above; open items never hold up final wages.</p> : null}
          </section>
        ) : null}
        {/* The final-pay clock, no-dues sign-off and exit interview (WORKFLOW-GAP-RESEARCH 4.3, 4.9); the money itself is Payroll's full and final (gap 15). */}
        {kind === 'LEAVING' && !staying ? <LeavingSections data={extras.data} employeeId={row.id} name={row.name} onChanged={extrasChanged} /> : null}
        {kind === 'LEAVING' && hasApp('payroll') && !extras.data?.finalPay && !row.lineOnly && !staying ? (
          <section aria-label="Final pay" className="space-y-1">
            <h3 className="ui-t-sec">Final pay</h3>
            <p className="text-sm">Dues, recoveries and the final payslip are worked out in Payroll. <a className="ui-link" href="?app=payroll&open=settlements">Open full and final settlement</a></p>
          </section>
        ) : null}
      </div>
      {task ? <TaskDrawer task={task} canAssign={canAssign} onClose={() => setTask(null)} onSaved={() => { setTask(null); plan.reload(); extrasChanged(); }} /> : null}
    </Drawer>
  );
}
