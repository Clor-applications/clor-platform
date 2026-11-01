import React, { useState } from 'react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { notify } from '@ui/components/ui/notify';
import { formatDate } from '@ui/components/ui/DatePicker';

import { getCompanyChoices, saveCompanyChoice } from '../api/choices';

/**
 * Settings → Company choices (docs/people/workflow-engine/SPEC.md 3.7): the decisions HR and the owner make for
 * the company, each one sentence with its control. A settings page: compact width, the list on the page ground
 * under hairlines, one primary action (Save, top right). Two of the six live with the rules they belong to, and
 * are listed here with a way there.
 */
const GROUPS = [
  {
    key: 'approvals',
    title: 'Approvals',
    items: [
      { key: 'attendance.correctionApproval', sentence: 'Missed punch, work from home, on duty, permission and shift change requests are decided by' },
      { key: 'notifications.withdrawn', sentence: 'When someone withdraws a request, the “waiting for you” notice' },
      { key: 'leave.onEngine', sentence: 'Leave requests are decided by the approval rules' },
      { key: 'attendance.onEngine', sentence: 'Attendance requests, overtime and field punches are decided by the approval rules' },
    ],
  },
  {
    key: 'privacy',
    title: 'Privacy',
    items: [
      { key: 'people.hrSeesSalaryRevisions', sentence: 'HR without Payroll access can see salary revisions', caption: 'Read only: the list with the old and new pay. They cannot raise, review or approve one.' },
      { key: 'people.leavingsForReadOnly', sentence: 'Read-only users and IT administrators see who is leaving and their last day' },
      { key: 'people.leavingReasonForReadOnly', sentence: 'They also see the reason typed for leaving', caption: 'HR, the owner and admins always see it. A manager sees it only when the exit interview is not kept from them.' },
    ],
  },
];

const CAPTIONS = {
  'attendance.correctionApproval': {
    HR_OR_MANAGER: 'Whoever acts first: HR, or the person’s manager or their stand-in.',
    MANAGER: 'HR decides when the person has no manager.',
    HR: 'Managers see the request but cannot decide it.',
    MANAGER_THEN_HR: 'The manager approves first, then HR. Someone without a manager goes straight to HR.',
  },
  'leave.onEngine': {
    false: 'Off: leave is decided as it is today. Only the owner or an admin can turn this on.',
    true: 'The same people decide as today. Each request shows its steps, who has it and by when; reminders come from the approval rules. Requests already waiting finish as they started.',
  },
  'attendance.onEngine': {
    false: 'Off: missed punches, work from home, on duty, permission, shift changes, overtime, comp-off and field punches are decided as they are today. Only the owner or an admin can turn this on.',
    true: 'The same people decide as today. Each request shows its steps and who has it now. Requests already waiting finish as they started.',
  },
  'notifications.withdrawn': {
    SHOW_WITHDRAWN: 'It says “Withdrawn”, is marked read and opens the closed request.',
    REMOVE: 'It disappears from the approver’s notices.',
  },
};

const changedLine = (c) => (c?.changed ? `Changed by ${c.changed.by || 'someone no longer here'}, ${formatDate(String(c.changed.at).slice(0, 10))}` : 'Standard');

function Choice({ item, choice, value, onChange }) {
  const id = `choice-${item.key.replace(/\W/g, '-')}`;
  const caption = CAPTIONS[item.key]?.[value] || item.caption || null;
  return (
    <li className="py-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-start sm:gap-6">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm block">{item.sentence}</label>
        {caption ? <p className="ui-caption mt-1">{caption}</p> : null}
        <p className="ui-caption mt-1">{changedLine(choice)}{!choice.canChange && choice.why ? ` · ${choice.why}` : ''}</p>
      </div>
      <select id={id} className="ui-select w-full min-h-[44px] sm:min-h-0" value={String(value)} disabled={!choice.canChange} onChange={(e) => onChange(item.key, e.target.value)}>
        {choice.options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </li>
  );
}

export default function CompanyChoices({ openScreen }) {
  const req = useRequest(() => getCompanyChoices(), []);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const choices = req.data?.choices || [];
  const byKey = Object.fromEntries(choices.map((c) => [c.key, c]));
  const valueOf = (key) => (key in draft ? draft[key] : byKey[key]?.value);
  const changed = Object.keys(draft).filter((k) => byKey[k] && draft[k] !== byKey[k].value);
  const dirty = changed.length > 0;
  useUnsavedChanges(dirty);
  const title = 'Company choices';

  if (req.error && !req.data) return <div className="space-y-6 max-w-2xl"><PageHeader title={title} /><ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!req.data) return <div className="space-y-6 max-w-2xl"><PageHeader title={title} /><SkeletonCard lines={8} /></div>;

  const canChangeAny = choices.some((c) => c.canChange);
  const onChange = (key, raw) => {
    const def = byKey[key];
    const v = typeof def.default === 'boolean' ? raw === 'true' : raw;
    setDraft((d) => ({ ...d, [key]: v }));
  };
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    let last = null;
    try {
      /* One choice at a time, each audited on its own. A refusal stops there; what saved before it stays saved. */
      for (const key of changed) {
        last = await saveCompanyChoice(key, draft[key]);
        setDraft((d) => {
          const { [key]: _done, ...rest } = d;
          return rest;
        });
      }
      notify.success(changed.length === 1 ? 'Choice saved.' : 'Choices saved.');
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      if (last) req.setData?.(last);
      if (!req.setData) req.reload();
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title={title} actions={canChangeAny ? <button type="button" className="ui-btn ui-btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button> : null} />
      {GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`cc-${g.key}`}>
          <h2 id={`cc-${g.key}`} className="ui-t-sec">{g.title}</h2>
          <ul className="divide-y border-t" style={{ borderColor: 'rgb(var(--border))' }}>
            {g.items.filter((i) => byKey[i.key]).map((i) => <Choice key={i.key} item={i} choice={byKey[i.key]} value={valueOf(i.key)} onChange={onChange} />)}
          </ul>
        </section>
      ))}
      <section aria-labelledby="cc-elsewhere">
        <h2 id="cc-elsewhere" className="ui-t-sec">Set with their rules</h2>
        <ul className="divide-y border-t" style={{ borderColor: 'rgb(var(--border))' }}>
          <li className="py-4 text-sm">
            How much a late mark cuts, after the grace and the free ones.{' '}
            {openScreen ? <button type="button" className="ui-link min-h-[44px] sm:min-h-0" onClick={() => openScreen('attendanceRules')}>Attendance rules</button> : 'In Attendance rules.'}
          </li>
          <li className="py-4 text-sm">How much of a loan or advance a final settlement recovers. In Payroll, under Settings.</li>
        </ul>
      </section>
    </div>
  );
}
