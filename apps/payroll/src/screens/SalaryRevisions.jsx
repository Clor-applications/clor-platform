import React, { useCallback, useEffect, useMemo, useState } from 'react';
import MoneyInput from '@ui/components/ui/MoneyInput';
import { Figures } from '../components/Figure';
import { FormPart } from '@ui/components/ui/FormPart';
import { ExceptionTag } from '@ui/components/ui/ExceptionTag';
import { AlertTriangle, ArrowLeft, Plus, TrendingUp } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { PageHeader, SkeletonCard, EmptyState, Button } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listSalaryStructures } from '../api/payrollStructures';
import { listEmployees } from '../api/payrollPeople';
import {
  listSalaryRevisions,
  getSalaryRevision,
  createSalaryRevision,
  previewRevisionImpact,
  submitRevisionForReview,
  approveSalaryRevision,
  rejectSalaryRevision,
  applySalaryRevision,
} from '../api/payrollRevisions';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { rupees as money, moneyCell } from '@ui/utils/money';
import { errorWords } from '@ui/utils/errorWords';
import { countItems } from '../components/countItems';
import { dateWords } from '@ui/utils/dates';

/**
 * Increments, and what they really cost.
 *
 * The screen exists because an increment is agreed as one number and means
 * another. Twelve percent on cost to company is not twelve percent in the hand:
 * provident fund rises with basic, tax can cross a band, and the company pays
 * more on top than the rise itself. So the impact is not a footnote here — it
 * is the screen, and the terms are the form above it.
 *
 * Approving and applying are deliberately two acts. Approving is a decision;
 * applying is the moment somebody's salary changes, on a date. Collapsing them
 * would make every approval an immediate pay change, including the ones meant
 * to take effect next quarter.
 */

const STATUS = {
  DRAFT: { label: 'Draft', tone: 'ui-pill-neutral' },
  REVIEWED: { label: 'Reviewed', tone: 'ui-pill-neutral' },
  APPROVED: { label: 'Approved', tone: 'ui-pill-pos' },
  APPLIED: { label: 'In effect', tone: 'ui-pill-pos' },
  REJECTED: { label: 'Rejected', tone: 'ui-pill-neutral' },
};


const signed = (n) => {
  const v = Number(n || 0);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`;
};


const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'OPEN', label: 'To decide', tone: 'outstanding' },
  { value: 'APPROVED', label: 'Approved', tone: 'sent' },
  { value: 'APPLIED', label: 'In effect', tone: 'paid' },
  { value: 'REJECTED', label: 'Rejected', tone: 'cancelled' },
];
/* One written title per tab: a title built from the tab label read "No to decide revisions". */
const EMPTY_TITLES = {
  OPEN: 'No revisions waiting for a decision',
  APPROVED: 'No approved revisions waiting',
  APPLIED: 'No revisions in effect yet',
  REJECTED: 'No rejected revisions',
};
const inTabOf = (r, tab) => !tab || (tab === 'OPEN' ? ['DRAFT', 'REVIEWED'].includes(r.status) : r.status === tab);
const COLUMNS = {
  employee: (r) => r.employeeName,
};
const EXPORT_COLUMNS = [
  { key: 'employeeName', label: 'Employee' },
  { key: 'employeeCode', label: 'Code' },
  { key: 'currentAnnualCtc', label: 'From (a year)', value: (r) => Number(r.currentAnnualCtc || 0) },
  { key: 'proposedAnnualCtc', label: 'To (a year)', value: (r) => Number(r.proposedAnnualCtc || 0) },
  { key: 'incrementPercent', label: 'Raise %', value: (r) => r.incrementPercent ?? '' },
  { key: 'effectiveFrom', label: 'In effect from' },
  { key: 'reason', label: 'Reason' },
  { key: 'status', label: 'Status', value: (r) => STATUS[r.status]?.label || r.status },
];

export default function SalaryRevisions({ params } = {}) {
  const [all, setAll] = useState(null);
  const [people, setPeople] = useState([]);
  const [structures, setStructures] = useState([]);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  /* Opened from a People record's "Change salary" (`s.new=<employee id>`): the form starts on that person. */
  const [starting, setStarting] = useState(Boolean(params?.new));
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    Promise.all([listSalaryRevisions(), listEmployees({ status: 'ACTIVE' }), listSalaryStructures({ status: 'ACTIVE' })])
      .then(([revisions, employeeRows, structureRows]) => {
        setAll(revisions);
        setPeople(employeeRows.employees);
        setStructures(structureRows);
        setError('');
      })
      .catch((e) => setError(errorWords(e, 'load salary revisions')));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const list = all || [];
    return Object.fromEntries(TABS.map((t) => [t.value, list.filter((r) => inTabOf(r, t.value)).length]));
  }, [all]);
  const figures = useMemo(() => {
    const live = (all || []).filter((r) => ['APPROVED', 'APPLIED'].includes(r.status));
    const rise = live.reduce((a, r) => a + (Number(r.proposedAnnualCtc || 0) - Number(r.currentAnnualCtc || 0)), 0);
    const pcts = live.map((r) => Number(r.incrementPercent)).filter((n) => Number.isFinite(n) && n > 0);
    return { rise, avg: pcts.length ? Math.round((pcts.reduce((a, n) => a + n, 0) / pcts.length) * 10) / 10 : 0 };
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((r) => inTabOf(r, status)), [all, status]);
  const search = useListSearch(inTab, ['employeeName', 'employeeCode', 'reason']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);

  if (openId) {
    return (
      <RevisionDetail
        revisionId={openId}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  const canStart = people.length > 0 && structures.length > 0;
  const start = () => setStarting(true);

  return (
    <DocumentListShell
      entity="salaryRevision"
      title="Salary revisions"
      description="Raises, with what each one does to net pay and to the company's cost before anybody agrees to it."
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search revisions…', label: 'Search revisions' }}
      moreItems={all?.length ? [exportMenuItem('Export revisions')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Salary revisions', fileName: 'Salary revisions', label: 'revision/revisions', columns: EXPORT_COLUMNS, rows });
      }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={start} disabled={!canStart || starting}>
          <Plus size={16} aria-hidden="true" /> New revision
        </button>
      }
      countLine={countItems([
        { label: 'To decide', value: counts.OPEN || 0, count: true, tone: 'outstanding', onSelect: () => setStatus('OPEN') },
        { label: 'Approved', value: counts.APPROVED || 0, count: true, tone: 'sent', onSelect: () => setStatus('APPROVED') },
        { label: 'Yearly raise', value: figures.rise, whole: true, tone: 'partial' },
        { label: 'Average raise', value: `${figures.avg}%`, count: true, tone: 'paid' },
      ])}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Revision status"
      above={
        starting ? (
          <RevisionForm
            key={people.length}
            initialEmployeeId={params?.new}
            people={people}
            structures={structures}
            onCancel={() => setStarting(false)}
            onCreated={(revision) => {
              setStarting(false);
              setOpenId(revision.id);
            }}
          />
        ) : null
      }
    >
      <LoadFailed message={error} onRetry={load} />
      {!all ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky ui-table-phone w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <th scope="col" className="ui-col-h-right">From</th>
                <th scope="col" className="ui-col-h-right">To</th>
                <th scope="col" className="ui-col-h-right">Raise</th>
                <th scope="col" className="ui-col-h-center">In effect from</th>
                <th scope="col" className="ui-col-grow">Reason</th>
                <th scope="col" className="ui-col-h-center">Status</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={7}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No revisions match" description="Nothing in this tab matches the search or the column filters." />
                    ) : !canStart && !(all || []).length ? (
                      <EmptyState icon={TrendingUp} title="Nothing to revise yet" description="A revision moves somebody from one salary to another. Add people and an active salary structure first." />
                    ) : (
                      <EmptyState
                        icon={TrendingUp}
                        title={EMPTY_TITLES[status] || 'No revisions yet'}
                        description="Propose a raise and see what it does to net pay, to deductions and to what the company spends, before anybody agrees to it."
                        routes={canStart && !status ? [{ label: 'New revision', description: 'The impact shows as you type.', onSelect: start }] : undefined}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="ui-row-click" onClick={() => setOpenId(r.id)}>
                    <td className="ui-col-entity" data-phone="name">
                      {r.employeeName}
                      {r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}
                    </td>
                    <td className="ui-col-amount">{moneyCell(r.currentAnnualCtc)}</td>
                    <td className="ui-col-amount" data-phone="key">{moneyCell(r.proposedAnnualCtc)}</td>
                    <td className="ui-col-amount">{r.incrementPercent ? `${r.incrementPercent}%` : '—'}</td>
                    <td className="ui-col-date ui-col-h-center" data-phone="sub">{dateWords(r.effectiveFrom)}</td>
                    <td className="ui-col-meta ui-col-grow whitespace-normal">{r.reason || '—'}</td>
                    <td className="ui-col-h-center" data-phone="tag">
                      <ExceptionTag label={r.status === 'APPLIED' ? '' : STATUS[r.status]?.label || r.status} normal={STATUS[r.status]?.label} pill={STATUS[r.status]?.tone || 'ui-pill-neutral'} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </DocumentListShell>
  );
}

/**
 * The terms, with the impact underneath as they are typed.
 *
 * The impact is live here because the number somebody is choosing is the CTC,
 * and the thing they actually care about — what reaches the person — only
 * appears once it is computed. Waiting until after saving would mean typing a
 * number, saving it, and then discovering it meant something else.
 */
const RevisionForm = ({ people, structures, onCancel, onCreated, initialEmployeeId }) => {
  const [form, setForm] = useState({
    employeeId: (initialEmployeeId && people.some((p) => p.id === initialEmployeeId) ? initialEmployeeId : people[0]?.id) || '',
    proposedStructureId: structures[0]?.id || '',
    proposedAnnualCtc: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    reason: '',
  });
  const [impact, setImpact] = useState(null);
  const [current, setCurrent] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  const ctc = Number(form.proposedAnnualCtc);

  useEffect(() => {
    if (!form.employeeId || !form.proposedStructureId || !(ctc > 0)) {
      setImpact(null);
      return undefined;
    }
    let alive = true;
    previewRevisionImpact({
      employeeId: form.employeeId,
      proposedStructureId: form.proposedStructureId,
      proposedAnnualCtc: ctc,
      effectiveFrom: form.effectiveFrom,
    })
      .then((out) => {
        if (!alive) return;
        setImpact(out.impact);
        setCurrent(out.current);
      })
      .catch(() => {
        if (alive) setImpact(null);
      });
    return () => {
      alive = false;
    };
  }, [form.employeeId, form.proposedStructureId, ctc, form.effectiveFrom]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      onCreated(
        await createSalaryRevision({
          employeeId: form.employeeId,
          proposedStructureId: form.proposedStructureId,
          proposedAnnualCtc: ctc,
          effectiveFrom: form.effectiveFrom,
          reason: form.reason.trim() || null,
        })
      );
    } catch (err) {
      notify.error(errorWords(err, 'create that revision'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={save}>
      <FormPart title="New revision" id="new-revision">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="ui-label" htmlFor="rev-employee">Employee</label>
              <select id="rev-employee" className="ui-select w-full" value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value })} required>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.code ? ` · ${p.code}` : ''}
                  </option>
                ))}
              </select>
              {current ? <span className="ui-caption">On {money(current.annualCtc)} a year now.</span> : null}
            </div>
            <div>
              <label className="ui-label" htmlFor="rev-structure">Moves to</label>
              <select
                id="rev-structure"
                className="ui-select w-full"
                value={form.proposedStructureId}
                onChange={(e) => set({ proposedStructureId: e.target.value })}
                required
              >
                {structures.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="rev-ctc">New cost to company (a year)</label>
              <MoneyInput
                id="rev-ctc"
                type="text" inputMode="decimal"
                min="0"
                step="1"
                className="ui-input ui-num w-full"
                value={form.proposedAnnualCtc}
                onChange={(e) => set({ proposedAnnualCtc: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="ui-label" htmlFor="rev-from">In effect from</label>
              <input id="rev-from" type="date" className="ui-input w-full" value={form.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} required />
            </div>
          </div>

          <div>
            <label className="ui-label" htmlFor="rev-reason">Reason</label>
            <input
              id="rev-reason"
              className="ui-input w-full"
              value={form.reason}
              onChange={(e) => set({ reason: e.target.value })}
              placeholder="Annual increment, promotion, market correction…"
            />
          </div>

          {impact ? <Impact impact={impact} compact /> : null}
        </div>
      </FormPart>

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <Button variant="primary" loading={saving} disabled={!impact} type="submit">
          Create as draft
        </Button>
      </div>
    </form>
  );
};

/**
 * What the revision does, in the four figures somebody actually weighs.
 *
 * Take-home first, because that is what the person receiving it will ask about,
 * and the company's cost last, because that is what the person approving it
 * will. Neither is buried under the other.
 */
const Impact = ({ impact, compact = false }) => (
  <div className="space-y-3">
    <Figures
      label="What the revision changes"
      items={[
        { label: 'Net pay a month', value: moneyCell(impact.monthly.to, { zero: true }), raw: impact.monthly.to, hint: signed(impact.monthly.change) },
        { label: 'Deductions a month', value: moneyCell(impact.deductions.to, { zero: true }), raw: impact.deductions.to, hint: signed(impact.deductions.change) },
        { label: 'Company pays a month', value: moneyCell(impact.employerCost.to, { zero: true }), raw: impact.employerCost.to, hint: signed(impact.employerCost.change) },
        {
          label: 'Cost to company a year',
          value: moneyCell(impact.ctc.to, { zero: true }),
          raw: impact.ctc.to,
          hint: `${signed(impact.ctc.change)}${impact.ctc.percent ? ` · ${impact.ctc.percent}%` : ''}`,
        },
      ]}
    />

    {impact.notes?.length ? (
      <div className="space-y-1">
        {impact.notes.map((n) => (
          <div key={n.code} className="flex items-start gap-2">
            <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
            <p className="ui-caption">{n.message}</p>
          </div>
        ))}
      </div>
    ) : null}

    {!compact && impact.lines?.length ? (
      <div className="ui-list-surface overflow-hidden">
        <div className="px-4 py-3 ui-sec-head" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
          What changes, line by line
        </div>
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col">Type</th>
                <th scope="col" className="ui-col-h-right">Now</th>
                <th scope="col" className="ui-col-h-right">After</th>
                <th scope="col" className="ui-col-h-right">Change</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {impact.lines.map((l) => (
                <tr key={l.code}>
                  <td className="ui-col-entity">{l.name}</td>
                  <td className="ui-col-meta">
                    {l.type === 'DEDUCTION' ? 'Deduction' : l.type === 'EMPLOYER_CONTRIBUTION' ? 'Employer cost' : 'Earning'}
                  </td>
                  <td className="ui-col-amount">{moneyCell(l.from)}</td>
                  <td className="ui-col-amount">{moneyCell(l.to)}</td>
                  <td className="ui-col-amount">{signed(l.change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ) : null}
  </div>
);


const RevisionDetail = ({ revisionId, onBack }) => {
  const [revision, setRevision] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setRevision(await getSalaryRevision(revisionId));
    } catch (e) {
      notify.error(errorWords(e, 'load that revision'));
    } finally {
      setLoading(false);
    }
  }, [revisionId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn, done, key) => {
    setBusy(key);
    try {
      await fn();
      notify.success(done);
      load();
    } catch (e) {
      notify.error(errorWords(e, 'update this revision'));
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    const ok = await confirmDialog({
      title: 'Put this salary into effect?',
      message: `From ${dateWords(revision.effectiveFrom)}, ${revision.employeeName} is on ${money(
        revision.proposedAnnualCtc
      )} a year. Their current salary closes the day before, and payroll pays the new one from then on.`,
      confirmLabel: 'Put into effect',
      tone: 'default',
    });
    if (!ok) return;
    act(() => applySalaryRevision(revisionId), 'In effect. This is their salary now.', 'apply');
  };

  const reject = async () => {
    const ok = await confirmDialog({
      title: 'Reject this revision?',
      message: 'It stays in the list under Rejected, so the decision is visible. Their salary does not change.',
      confirmLabel: 'Reject revision',
    });
    if (!ok) return;
    act(() => rejectSalaryRevision(revisionId), 'Rejected.', 'reject');
  };

  if (loading) return <SkeletonCard lines={6} />;
  if (!revision) return null;

  const actions = [];
  if (revision.status === 'DRAFT') {
    actions.push(
      <button
        key="review"
        type="button"
        className="ui-btn ui-btn-primary"
        disabled={busy === 'review'}
        onClick={() => act(() => submitRevisionForReview(revisionId), 'Sent for review.', 'review')}
      >
        Send for review
      </button>
    );
  }
  if (revision.status === 'REVIEWED') {
    actions.push(
      <button
        key="approve"
        type="button"
        className="ui-btn ui-btn-primary"
        disabled={busy === 'approve'}
        onClick={() => act(() => approveSalaryRevision(revisionId), 'Approved.', 'approve')}
      >
        Approve
      </button>
    );
  }
  if (revision.status === 'APPROVED') {
    actions.push(
      <Button variant="primary" loading={busy === 'apply'} key="apply" onClick={apply}>
        Put into effect
      </Button>
    );
  }
  if (['DRAFT', 'REVIEWED', 'APPROVED'].includes(revision.status)) {
    actions.unshift(
      <button key="reject" type="button" className="ui-btn ui-btn-secondary" disabled={busy === 'reject'} onClick={reject}>
        Reject
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader
        entity="salaryRevision"
        title={revision.employeeName}
        description={`${money(revision.currentAnnualCtc)} → ${money(revision.proposedAnnualCtc)} a year${
          revision.incrementPercent ? ` · ${revision.incrementPercent}%` : ''
        } · from ${dateWords(revision.effectiveFrom)}${revision.reason ? ` · ${revision.reason}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            {actions}
          </div>
        }
      />

      <div className="px-5 lg:px-7 pb-8 space-y-4">
      <div className="flex items-center gap-2">
        <span className={`ui-pill ${STATUS[revision.status]?.tone || 'ui-pill-neutral'}`}>
          {STATUS[revision.status]?.label || revision.status}
        </span>
        {revision.proposedStructureName ? <span className="ui-caption">on {revision.proposedStructureName}</span> : null}
      </div>

      {revision.status === 'APPROVED' ? (
        <p className="ui-caption">
          Approved, but not yet anybody&rsquo;s salary. Putting it into effect is what changes what payroll pays, from{' '}
          {dateWords(revision.effectiveFrom)}.
        </p>
      ) : null}

      {revision.impact ? (
        <>
          <Impact impact={revision.impact} />
          <p className="ui-caption">
            {revision.impactIsStored
              ? 'These are the figures as they stood when this was approved. They do not move if rates change afterwards.'
              : 'Worked out just now, under the rates and structures in force today.'}
          </p>
        </>
      ) : (
        <p className="ui-caption">The impact could not be worked out. The structure or the rates behind it may have changed.</p>
      )}

      {revision.notes ? <p className="ui-caption">{revision.notes}</p> : null}
      </div>
    </div>
  );
};
