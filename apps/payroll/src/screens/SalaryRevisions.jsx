import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Clock, Percent, Plus, TrendingUp } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
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
import { wholeRupees as money } from '@ui/utils/money';

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

const shownDate = (iso) => {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'OPEN', label: 'To decide', tone: 'outstanding' },
  { value: 'APPROVED', label: 'Approved', tone: 'sent' },
  { value: 'APPLIED', label: 'In effect', tone: 'paid' },
  { value: 'REJECTED', label: 'Rejected', tone: 'cancelled' },
];
const inTabOf = (r, tab) => !tab || (tab === 'OPEN' ? ['DRAFT', 'REVIEWED'].includes(r.status) : r.status === tab);
const COLUMNS = {
  employee: (r) => r.employeeName,
};
const EXPORT_COLUMNS = [
  { key: 'employeeName', label: 'Employee' },
  { key: 'employeeCode', label: 'Code' },
  { key: 'currentAnnualCtc', label: 'From (a year)', value: (r) => Number(r.currentAnnualCtc || 0) },
  { key: 'proposedAnnualCtc', label: 'To (a year)', value: (r) => Number(r.proposedAnnualCtc || 0) },
  { key: 'incrementPercent', label: 'Rise %', value: (r) => r.incrementPercent ?? '' },
  { key: 'effectiveFrom', label: 'In effect from' },
  { key: 'reason', label: 'Why' },
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
      .catch((e) => setError(String(e?.message || 'Could not load salary revisions.')));
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
      description="Increments, with what each one does to take-home pay and to the company's cost before anybody agrees to it."
      compact
      tight
      denseCards
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
      cards={[
        { label: 'To decide', value: counts.OPEN || 0, count: true, tone: 'outstanding', tint: 'butter', Icon: Clock, onSelect: () => setStatus('OPEN') },
        { label: 'Approved', value: counts.APPROVED || 0, count: true, tone: 'sent', tint: 'mint', Icon: Check, onSelect: () => setStatus('APPROVED') },
        { label: 'Yearly rise', value: figures.rise, whole: true, tone: 'partial', tint: 'sky', Icon: TrendingUp },
        { label: 'Average rise', value: `${figures.avg}%`, count: true, tone: 'paid', tint: 'lilac', Icon: Percent },
      ]}
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
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <th scope="col" className="ui-col-h-right">From</th>
                <th scope="col" className="ui-col-h-right">To</th>
                <th scope="col" className="ui-col-h-right">Rise</th>
                <th scope="col" className="ui-col-h-center">In effect from</th>
                <th scope="col" className="ui-col-grow">Why</th>
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
                        title={status ? `No ${TABS.find((t) => t.value === status)?.label.toLowerCase()} revisions` : 'No revisions yet'}
                        description="Propose an increment and see what it does to take-home pay, to deductions and to what the company spends — before anybody agrees to it."
                        routes={canStart && !status ? [{ label: 'New revision', description: 'The impact shows as you type.', onSelect: start }] : undefined}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="ui-row-click" onClick={() => setOpenId(r.id)}>
                    <td className="ui-col-entity">
                      {r.employeeName}
                      {r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}
                    </td>
                    <td className="ui-col-amount">{money(r.currentAnnualCtc)}</td>
                    <td className="ui-col-amount">{money(r.proposedAnnualCtc)}</td>
                    <td className="ui-col-amount">{r.incrementPercent ? `${r.incrementPercent}%` : '—'}</td>
                    <td className="ui-col-date ui-col-h-center">{shownDate(r.effectiveFrom)}</td>
                    <td className="ui-col-meta ui-col-grow whitespace-normal">{r.reason || '—'}</td>
                    <td className="ui-col-h-center">
                      <span className={`ui-pill ${STATUS[r.status]?.tone || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span>
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
      notify.error(String(err?.message || 'Could not create that revision.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="ui-card p-4 space-y-3" onSubmit={save}>
      <div className="ui-sec-head">New revision</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="ui-label" htmlFor="rev-employee">Who</label>
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
          <input
            id="rev-ctc"
            type="number"
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
        <label className="ui-label" htmlFor="rev-reason">Why</label>
        <input
          id="rev-reason"
          className="ui-input w-full"
          value={form.reason}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="Annual increment, promotion, market correction…"
        />
      </div>

      {impact ? <Impact impact={impact} compact /> : null}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving || !impact}>
          {saving ? 'Creating…' : 'Create as draft'}
        </button>
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
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Figure label="Take-home a month" value={money(impact.monthly.to)} change={impact.monthly.change} />
      <Figure label="Deductions a month" value={money(impact.deductions.to)} change={impact.deductions.change} />
      <Figure label="Company pays a month" value={money(impact.employerCost.to)} change={impact.employerCost.change} />
      <Figure
        label="Cost to company a year"
        value={money(impact.ctc.to)}
        change={impact.ctc.change}
        hint={impact.ctc.percent ? `${impact.ctc.percent}%` : ''}
      />
    </div>

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
      <div className="ui-card overflow-hidden">
        <div className="px-4 py-3 ui-sec-head" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
          What changes, line by line
        </div>
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col">Kind</th>
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
                  <td className="ui-col-amount">{money(l.from)}</td>
                  <td className="ui-col-amount">{money(l.to)}</td>
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

const Figure = ({ label, value, change, hint = '' }) => (
  <div className="ui-card p-3">
    <div className="ui-caption">{label}</div>
    <div className="ui-amount mt-0.5">{value}</div>
    <div className="ui-caption">
      {signed(change)}
      {hint ? ` · ${hint}` : ''}
    </div>
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
      notify.error(String(e?.message || 'Could not load that revision.'));
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
      notify.error(String(e?.message || 'Could not do that.'));
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    const ok = await confirmDialog({
      title: 'Put this salary into effect?',
      message: `From ${shownDate(revision.effectiveFrom)}, ${revision.employeeName} is on ${money(
        revision.proposedAnnualCtc
      )} a year. Their current salary closes the day before, and payroll pays the new one from then on.`,
      confirmLabel: 'Yes, apply it',
      tone: 'default',
    });
    if (!ok) return;
    act(() => applySalaryRevision(revisionId), 'Applied. This is their salary now.', 'apply');
  };

  const reject = async () => {
    const ok = await confirmDialog({
      title: 'Reject this revision?',
      message: 'It stays in the list, marked rejected, so the decision is visible.',
      confirmLabel: 'Yes, reject',
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
      <button key="apply" type="button" className="ui-btn ui-btn-primary" disabled={busy === 'apply'} onClick={apply}>
        {busy === 'apply' ? 'Applying…' : 'Put into effect'}
      </button>
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
        } · from ${shownDate(revision.effectiveFrom)}${revision.reason ? ` · ${revision.reason}` : ''}`}
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
          {shownDate(revision.effectiveFrom)}.
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
        <p className="ui-caption">The impact could not be worked out — the structure or the rates behind it may have changed.</p>
      )}

      {revision.notes ? <p className="ui-caption">{revision.notes}</p> : null}
      </div>
    </div>
  );
};
