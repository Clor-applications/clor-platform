import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExceptionTag, exceptionsFirst } from '@ui/components/ui/ExceptionTag';
import { Banknote, Plus, TrendingUp, Users } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listSalaryStructures } from '../api/payrollStructures';
import UanQuestion from '../components/UanQuestion';
import PtStateField from '../components/PtStateField';
import { SKILL_LEVELS } from '../components/minimumWageText';
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  listAssignments,
  createAssignment,
  checkMinimumWage,
} from '../api/payrollPeople';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { wholeRupees as money } from '@ui/utils/money';
import { CtcSplit } from '../components/round59';
import { dayText, errorWords } from '@ui/utils/errorWords';
import { countItems } from '../components/countItems';

/**
 * Who is paid what.
 *
 * One screen rather than two, because that is one question. A roster of people
 * with the salary each is currently on, and everything about a person reachable
 * from their row — their details, their salary history, and recording the next
 * raise.
 *
 * A raise is never an edit. It writes a new salary from the date it applies and
 * closes the one before it, so a payroll run for March still finds March's
 * figure however many raises have happened since. The drawer says so, because
 * the alternative is somebody hunting for an edit button that should not exist.
 */


const shownDate = (iso) => {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const today = () => new Date().toISOString().slice(0, 10);

const STATUSES = [
  { id: 'ACTIVE', label: 'Active' },
  { id: 'ON_NOTICE', label: 'On notice' },
  { id: 'LEFT', label: 'Left' },
  { id: 'SUSPENDED', label: 'Suspended' },
];

const blankEmployee = () => ({
  name: '',
  code: '',
  email: '',
  phone: '',
  designation: '',
  department: '',
  dateOfJoining: today(),
  dateOfLeaving: '',
  status: 'ACTIVE',
  notes: '',
  payroll: {
    payrollStatus: 'IN_PAYROLL',
    taxRegime: 'NEW',
    bankAccountName: '',
    bankAccountNumber: '',
    bankIfsc: '',
    bankName: '',
    pan: '',
    uan: '',
    pfNumber: '',
    esiNumber: '',
    professionalTaxState: '',
    /* Minimum wage (round 66): the skill level the state's rates are read for. */
    skillLevel: 'UNSKILLED',
    minimumWageZone: '',
    /* Not sent unless set: a blank here must never switch PF or PT off for somebody who has them. */
    pfApplicable: undefined,
    esiApplicable: undefined,
    ptApplicable: undefined,
  },
});

const TABS = [
  { value: '', label: 'Everyone', tone: 'all' },
  { value: 'PAID', label: 'On a salary', tone: 'paid' },
  { value: 'NONE', label: 'No salary', tone: 'outstanding' },
  { value: 'LEAVING', label: 'On notice or left', tone: 'cancelled' },
];
const statusLabel = (p) => STATUSES.find((s) => s.id === p.status)?.label || p.status;
/* The roster's tag, on exceptions only (DESIGN.md "Status tags"): a person still here with no salary, on notice
   or suspended. Somebody who left is not waiting on anyone, so the word is grey. Active with a salary: no tag. */
const exceptionOf = (p, paid) =>
  p.status === 'LEFT' ? { label: 'Left', tone: 'neutral' }
    : p.status === 'ACTIVE' ? (paid ? null : { label: 'No salary', tone: 'warn' })
      : { label: statusLabel(p), tone: 'warn' };

export default function SalaryAssignments({ params } = {}) {
  const [people, setPeople] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [structures, setStructures] = useState([]);
  const [sensitiveVisible, setSensitiveVisible] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState('');

  const load = useCallback(() => {
    Promise.all([listEmployees(), listAssignments({ status: 'ACTIVE' }), listSalaryStructures({ status: 'ACTIVE' })])
      .then(([roster, salaries, structureRows]) => {
        setPeople(roster.employees);
        setSensitiveVisible(roster.sensitiveVisible);
        setAssignments(salaries);
        setStructures(structureRows);
        setError('');
      })
      .catch((e) => setError(errorWords(e, 'load the salary assignments')));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* Opened for one person (a statutory file's "Fix", round 26 pick): their details, once the roster is in. */
  const askedFor = params?.employeeId || '';
  const [openTab, setOpenTab] = useState('salary');
  /* Adjusted while rendering, once per request, rather than in an effect (no second render pass). */
  const [handled, setHandled] = useState('');
  const askKey = askedFor ? `${askedFor}|${params?.tab || ''}` : '';
  if (askKey && people && handled !== askKey) {
    setHandled(askKey);
    const person = people.find((p) => p.id === askedFor);
    if (person) {
      setOpenTab(params?.tab === 'details' ? 'details' : 'salary');
      setOpen(person);
    }
  }

  /* The salary each person is currently on, so the roster answers the question
     it is there to answer without a request per row. */
  const currentByEmployee = useMemo(() => {
    const map = new Map();
    for (const a of assignments) if (!map.has(a.employeeId)) map.set(a.employeeId, a);
    return map;
  }, [assignments]);

  const structureName = useCallback((id) => structures.find((x) => x.id === id)?.name || '—', [structures]);
  const inTabOf = useCallback(
    (p, t) => {
      if (!t) return true;
      const has = currentByEmployee.has(p.id);
      if (t === 'PAID') return has;
      if (t === 'NONE') return !has && !['LEFT'].includes(p.status);
      return ['ON_NOTICE', 'LEFT'].includes(p.status);
    },
    [currentByEmployee]
  );
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.value, (people || []).filter((p) => inTabOf(p, t.value)).length])), [people, inTabOf]);
  const figures = useMemo(() => {
    const paid = (people || []).map((p) => currentByEmployee.get(p.id)).filter(Boolean);
    return {
      annual: paid.reduce((a, c) => a + Number(c.annualCtc || 0), 0),
      monthly: paid.reduce((a, c) => a + Number(c.monthlyCtc || 0), 0),
    };
  }, [people, currentByEmployee]);
  const inTab = useMemo(() => (people || []).filter((p) => inTabOf(p, tab)), [people, tab, inTabOf]);
  const search = useListSearch(inTab, ['name', 'code', 'designation', 'department']);
  const filters = useColumnFilters();
  const COLUMNS = useMemo(
    () => ({
      name: (p) => p.name,
      designation: (p) => p.designation || '—',
      structure: (p) => (currentByEmployee.get(p.id) ? structureName(currentByEmployee.get(p.id).structureId) : '—'),
      status: statusLabel,
    }),
    [currentByEmployee, structureName]
  );
  const filtered = filters.applyFilters(search.filtered, COLUMNS);
  /* Exceptions first, unless the reader has sorted a column themselves. */
  const rows = filters.sort ? filtered : exceptionsFirst(filtered, (p) => exceptionOf(p, currentByEmployee.has(p.id))?.tone === 'warn');
  const EXPORT_COLUMNS = [
    { key: 'name', label: 'Employee' },
    { key: 'code', label: 'Code' },
    { key: 'designation', label: 'Designation' },
    { key: 'structure', label: 'Structure', value: COLUMNS.structure },
    { key: 'since', label: 'On this salary since', value: (p) => dayText(currentByEmployee.get(p.id)?.effectiveFrom) },
    { key: 'annual', label: 'Annual cost to company (CTC)', value: (p) => Number(currentByEmployee.get(p.id)?.annualCtc || 0) },
    { key: 'monthly', label: 'Per month', value: (p) => Number(currentByEmployee.get(p.id)?.monthlyCtc || 0) },
    { key: 'status', label: 'Status', value: statusLabel },
  ];
  const add = () => setAdding(true);

  return (
    <DocumentListShell
      entity="salary"
      title="Salary assignments"
      description="Who is paid what, and from when. A raise records a new salary rather than changing the old one."
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people…', label: 'Search the payroll roster' }}
      moreItems={people?.length ? [exportMenuItem('Export salaries')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Salary assignments', fileName: 'Salary assignments', label: 'person/people', columns: EXPORT_COLUMNS, rows });
      }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={add}>
          <Plus size={16} aria-hidden="true" /> Add person
        </button>
      }
      countLine={countItems([
        { label: 'On a salary', value: counts.PAID || 0, count: true, tone: 'paid', onSelect: () => setTab('PAID') },
        { label: 'No salary', value: counts.NONE || 0, count: true, tone: 'outstanding', onSelect: () => setTab('NONE') },
        { label: 'Annual cost to company (CTC)', value: figures.annual, tone: 'sent' },
        { label: 'A month', value: figures.monthly, tone: 'partial' },
      ])}
      tabs={TABS}
      statusValue={tab}
      statusCounts={counts}
      onStatusChange={setTab}
      tabsLabel="Salary"
    >
      <LoadFailed message={error} onRetry={load} />
      {!people ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="name" state={filters} />
                <ColumnHeader label="Designation" col="designation" state={filters} />
                <ColumnHeader label="Structure" col="structure" state={filters} />
                <th scope="col" className="ui-col-h-center">On this salary since</th>
                <th scope="col" className="ui-col-h-right">Annual CTC</th>
                <th scope="col" className="ui-col-h-right">Per month</th>
                <ColumnHeader label="Status" col="status" state={filters} align="center" />
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={7}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="Nobody matches" description="Nobody in this tab matches the search or the column filters." />
                    ) : !structures.length && !people.length ? (
                      <EmptyState
                        icon={Banknote}
                        title="No active salary structures yet"
                        description="A salary is a structure plus a figure. Build a structure under Settings → Salary structures, then people can be put on it."
                      />
                    ) : (
                      <EmptyState
                        icon={Users}
                        title={{ PAID: 'Nobody has a salary yet', NONE: 'Everyone has a salary', LEAVING: 'Nobody on notice or gone' }[tab] || 'Nobody on payroll yet'}
                        description="Add the people this company pays, and give each of them a salary."
                        routes={tab ? undefined : [{ label: 'Add person', description: 'Their details, bank and statutory numbers.', onSelect: add }]}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((p) => {
                  const current = currentByEmployee.get(p.id);
                  return (
                    <tr key={p.id} className="ui-row-click" onClick={() => setOpen(p)}>
                      <td className="ui-col-entity">
                        {p.name}
                        {p.code ? <span className="ui-caption"> · {p.code}</span> : null}
                      </td>
                      <td className="ui-col-meta">{p.designation || '—'}</td>
                      <td className="ui-col-meta">{current ? structureName(current.structureId) : '—'}</td>
                      <td className="ui-col-date ui-col-h-center">{current ? shownDate(current.effectiveFrom) : '—'}</td>
                      <td className="ui-col-amount">{current ? money(current.annualCtc) : '—'}</td>
                      <td className="ui-col-amount">{current ? money(current.monthlyCtc) : '—'}</td>
                      <td className="ui-col-h-center">
                        <ExceptionTag {...(exceptionOf(p, Boolean(current)) || {})} normal="Active" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a person to payroll"
        description="Their details, and what payroll needs to know about them."
      >
        {adding ? (
          <EmployeeForm
            initial={blankEmployee()}
            sensitiveVisible
            onClose={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              load();
            }}
          />
        ) : null}
      </Drawer>

      <Drawer
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open?.name || 'Employee'}
        description="Their details, their salary, and the raises behind it."
      >
        {open ? (
          <PersonPanel
            key={open.id}
            person={open}
            initialTab={openTab}
            structures={structures}
            sensitiveVisible={sensitiveVisible}
            onClose={() => {
              setOpen(null);
              setOpenTab('salary');
            }}
            onChanged={() => {
              setOpen(null);
              setOpenTab('salary');
              load();
            }}
          />
        ) : null}
      </Drawer>
    </DocumentListShell>
  );
}

/* --------------------------------------------------------- one person */

const PersonPanel = ({ person, structures, sensitiveVisible, onClose, onChanged, initialTab = 'salary' }) => {
  const [tab, setTab] = useState(initialTab);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setHistory(await listAssignments({ employeeId: person.id }));
    } catch (e) {
      notify.error(errorWords(e, 'load their salary history'));
    } finally {
      setLoading(false);
    }
  }, [person.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="space-y-4">
      <div className="ui-segmented" role="tablist" aria-label="Employee detail">
        <button type="button" role="tab" aria-selected={tab === 'salary'} className="ui-segment" onClick={() => setTab('salary')}>
          Salary
        </button>
        <button type="button" role="tab" aria-selected={tab === 'details'} className="ui-segment" onClick={() => setTab('details')}>
          Details
        </button>
      </div>

      {tab === 'salary' ? (
        loading ? (
          <SkeletonCard lines={3} />
        ) : (
          <SalaryTab person={person} structures={structures} history={history} onSaved={onChanged} />
        )
      ) : (
        <EmployeeForm
          initial={{ ...blankEmployee(), ...person, payroll: { ...blankEmployee().payroll, ...(person.payroll || {}) } }}
          sensitiveVisible={sensitiveVisible}
          onClose={onClose}
          onSaved={onChanged}
        />
      )}
    </div>
  );
};

const SalaryTab = ({ person, structures, history, onSaved }) => {
  const [raising, setRaising] = useState(false);
  const current = history.find((a) => a.status === 'ACTIVE') || history[0] || null;

  return (
    <div className="space-y-4">
      {raising ? (
        <RaiseForm
          person={person}
          structures={structures}
          current={current}
          onCancel={() => setRaising(false)}
          onSaved={onSaved}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="ui-sec-head">Salary history</div>
            <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => setRaising(true)}>
              <TrendingUp size={14} aria-hidden="true" /> {current ? 'Record a raise' : 'Set a salary'}
            </button>
          </div>

          {history.length === 0 ? (
            <p className="ui-caption">
              {person.name} has no salary yet. Set one, and payroll can pay them from that date.
            </p>
          ) : (
            <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-col-h-center">From</th>
                  <th scope="col" className="ui-col-h-center">To</th>
                  <th scope="col" className="ui-col-h-right">Annual CTC</th>
                  <th scope="col" className="ui-col-h-center">Status</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {history.map((a) => (
                  <tr key={a.id}>
                    <td className="ui-col-date ui-col-h-center">{shownDate(a.effectiveFrom)}</td>
                    <td className="ui-col-date ui-col-h-center">{a.effectiveTo ? shownDate(a.effectiveTo) : '—'}</td>
                    <td className="ui-col-amount">{money(a.annualCtc)}</td>
                    <td className="ui-col-meta">{a.status === 'ACTIVE' ? 'Current' : 'Past'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          <p className="ui-caption">
            A raise records a new salary from the date it applies and closes the one before it. Nothing already paid changes,
            so a payroll run for a past month still finds the figure it was calculated on.
          </p>
        </>
      )}
    </div>
  );
};

const RaiseForm = ({ person, structures, current, onCancel, onSaved }) => {
  const [form, setForm] = useState({
    structureId: current?.structureId || structures[0]?.id || '',
    effectiveFrom: today(),
    annualCtc: current?.annualCtc || 0,
  });
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  const increase = current && Number(form.annualCtc) > 0 && Number(current.annualCtc) > 0
    ? ((Number(form.annualCtc) - Number(current.annualCtc)) / Number(current.annualCtc)) * 100
    : null;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        employeeId: person.id,
        structureId: form.structureId,
        effectiveFrom: form.effectiveFrom,
        annualCtc: Number(form.annualCtc) || 0,
      };
      /* Round 66: below the state's minimum wage, asked while the figure can still change. */
      const below = await checkMinimumWage(payload).catch(() => null);
      if (below) {
        const keep = await confirmDialog({
          title: 'Below minimum wage',
          message: `${below.message}. Change the salary, or save it if the skill level or state on ${person.name}'s payroll details is wrong and you will correct it there.`,
          confirmLabel: 'Save anyway',
          cancelLabel: 'Change the salary',
          tone: 'warn',
          stayFirst: true,
        });
        if (!keep) return;
      }
      await createAssignment(payload);
      notify.success(`${person.name}'s salary recorded.`);
      onSaved();
    } catch (err) {
      notify.error(errorWords(err, 'record that salary'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="ui-sec-head">{current ? 'Record a raise' : 'Set a salary'}</div>

      <div>
        <label className="ui-label" htmlFor="raise-structure">Salary structure</label>
        <select
          id="raise-structure"
          className="ui-select w-full"
          value={form.structureId}
          onChange={(e) => set({ structureId: e.target.value })}
          required
        >
          <option value="">Choose one</option>
          {structures.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="ui-label" htmlFor="raise-from">Effective from</label>
          <input
            id="raise-from"
            type="date"
            className="ui-input w-full"
            value={form.effectiveFrom}
            onChange={(e) => set({ effectiveFrom: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="raise-ctc">Annual CTC</label>
          <input
            id="raise-ctc"
            type="number"
            min="0"
            step="1000"
            className="ui-input ui-num w-full"
            value={form.annualCtc}
            onChange={(e) => set({ annualCtc: e.target.value })}
            required
          />
        </div>
      </div>

      {/* Round 59 ctcsplit A: the yearly CTC split into its parts by the structure, with the net pay. */}
      <CtcSplit structureId={form.structureId} annualCtc={form.annualCtc} />

      {current ? (
        <dl className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="ui-caption">Currently on</dt>
            <dd className="ui-num text-sm">{money(current.annualCtc)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="ui-caption">Change</dt>
            <dd className="ui-num text-sm">
              {increase === null ? '—' : `${increase >= 0 ? '+' : ''}${increase.toFixed(1)}%`}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm font-medium">Per month after</dt>
            <dd className="ui-num text-sm font-medium">{money(Number(form.annualCtc || 0) / 12)}</dd>
          </div>
        </dl>
      ) : null}

      <p className="ui-caption">
        The salary before this one closes the day before {shownDate(form.effectiveFrom)}. Nothing already paid changes.
      </p>

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Record salary'}
        </button>
      </div>
    </form>
  );
};

/* ------------------------------------------------------- person details */

const EmployeeForm = ({ initial, sensitiveVisible, onClose, onSaved }) => {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const setPay = (patch) => setForm((p) => ({ ...p, payroll: { ...p.payroll, ...patch } }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        code: form.code || null,
        email: form.email || null,
        phone: form.phone || null,
        designation: form.designation || null,
        department: form.department || null,
        dateOfJoining: form.dateOfJoining || null,
        dateOfLeaving: form.dateOfLeaving || null,
        status: form.status,
        notes: form.notes || null,
        payroll: form.payroll,
      };
      const saved = initial.id ? await updateEmployee(initial.id, payload) : await createEmployee(payload);
      notify.success(
        saved?.bankChangePending
          ? `${form.name} saved. The new bank account waits for approval under Bank changes; pay goes to the current account until then.`
          : `${form.name} saved.`
      );
      onSaved();
    } catch (err) {
      notify.error(errorWords(err, 'save that person'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_9rem] gap-3">
        <div>
          <label className="ui-label" htmlFor="employee-name">Name</label>
          <input
            id="employee-name"
            className="ui-input w-full"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            required
            autoFocus
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="employee-code">Employee code</label>
          <input
            id="employee-code"
            className="ui-input ui-mono w-full"
            value={form.code || ''}
            onChange={(e) => set({ code: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="ui-label" htmlFor="employee-designation">Designation</label>
          <input
            id="employee-designation"
            className="ui-input w-full"
            value={form.designation || ''}
            onChange={(e) => set({ designation: e.target.value })}
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="employee-department">Department</label>
          <input
            id="employee-department"
            className="ui-input w-full"
            value={form.department || ''}
            onChange={(e) => set({ department: e.target.value })}
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="employee-joining">Joined on</label>
          <input
            id="employee-joining"
            type="date"
            className="ui-input w-full"
            value={form.dateOfJoining || ''}
            onChange={(e) => set({ dateOfJoining: e.target.value })}
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="employee-status">Status</label>
          <select
            id="employee-status"
            className="ui-select w-full"
            value={form.status}
            onChange={(e) => set({ status: e.target.value })}
          >
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <section className="space-y-3">
        <h3 className="ui-t-sec">Where their salary is paid</h3>
        {!sensitiveVisible ? (
          <p className="ui-caption">
            The account number and PAN are hidden and cannot be changed here. They are shown in full only to somebody granted
            that level.
          </p>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="ui-label" htmlFor="employee-bank-name">Bank</label>
            <input
              id="employee-bank-name"
              className="ui-input w-full"
              value={form.payroll.bankName || ''}
              onChange={(e) => setPay({ bankName: e.target.value })}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="employee-bank-account">Account number</label>
            <input
              id="employee-bank-account"
              className="ui-input ui-mono w-full"
              value={form.payroll.bankAccountNumber || ''}
              onChange={(e) => setPay({ bankAccountNumber: e.target.value })}
              disabled={!sensitiveVisible}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="employee-ifsc">IFSC</label>
            <input
              id="employee-ifsc"
              className="ui-input ui-mono w-full"
              value={form.payroll.bankIfsc || ''}
              onChange={(e) => setPay({ bankIfsc: e.target.value.toUpperCase() })}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="employee-pan">PAN</label>
            <input
              id="employee-pan"
              className="ui-input ui-mono w-full"
              value={form.payroll.pan || ''}
              onChange={(e) => setPay({ pan: e.target.value.toUpperCase() })}
              disabled={!sensitiveVisible}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="ui-t-sec">Statutory</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UanQuestion value={form.payroll.uan || ''} onChange={(uan) => setPay({ uan })} />
          {/* The state is also what the minimum wage is read for (round 66), so it shows with professional tax off too. */}
          <PtStateField
            employeeId={initial.id}
            value={form.payroll.professionalTaxState || ''}
            onChange={(professionalTaxState) => setPay({ professionalTaxState })}
            label={form.payroll.ptApplicable ? 'Professional tax state' : 'State they work in'}
            showSlab={Boolean(form.payroll.ptApplicable)}
          />
          <div>
            <label className="ui-label" htmlFor="employee-regime">Tax regime</label>
            <select
              id="employee-regime"
              className="ui-select w-full"
              value={form.payroll.taxRegime}
              onChange={(e) => setPay({ taxRegime: e.target.value })}
            >
              <option value="NEW">New</option>
              <option value="OLD">Old</option>
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor="employee-skill-level">Skill level</label>
            <select
              id="employee-skill-level"
              className="ui-select w-full"
              value={form.payroll.skillLevel || 'UNSKILLED'}
              onChange={(e) => setPay({ skillLevel: e.target.value })}
              aria-describedby="employee-skill-level-hint"
            >
              {SKILL_LEVELS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <p id="employee-skill-level-hint" className="ui-caption mt-1">Their pay is checked against the state’s minimum wage for this level.</p>
          </div>
          <div>
            <label className="ui-label" htmlFor="employee-min-wage-zone">Minimum wage zone</label>
            <input
              id="employee-min-wage-zone"
              className="ui-input w-full"
              value={form.payroll.minimumWageZone || ''}
              onChange={(e) => setPay({ minimumWageZone: e.target.value })}
              placeholder="Whole state"
              maxLength={60}
            />
          </div>
          {/* Which statutory deductions apply to this person (QA of #82, F9). Left untouched, they stay as they are. */}
          <fieldset className="sm:col-span-2">
            <legend className="ui-label">Deducted from their pay</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {[
                ['pfApplicable', 'Provident fund (PF)'],
                ['esiApplicable', 'ESI'],
                ['ptApplicable', 'Professional tax'],
              ].map(([key, label]) => (
                <label key={key} className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={Boolean(form.payroll[key])} onChange={(e) => setPay({ [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
};
