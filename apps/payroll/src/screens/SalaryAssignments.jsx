import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, TrendingUp } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { listSalaryStructures } from '../api/payrollStructures';
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  listAssignments,
  createAssignment,
} from '../api/payrollPeople';

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

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

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
    pfApplicable: false,
    esiApplicable: false,
    ptApplicable: false,
  },
});

export default function SalaryAssignments() {
  const [people, setPeople] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [structures, setStructures] = useState([]);
  const [sensitiveVisible, setSensitiveVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [roster, salaries, structureRows] = await Promise.all([
        listEmployees(),
        listAssignments({ status: 'ACTIVE' }),
        listSalaryStructures({ status: 'ACTIVE' }),
      ]);
      setPeople(roster.employees);
      setSensitiveVisible(roster.sensitiveVisible);
      setAssignments(salaries);
      setStructures(structureRows);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load the payroll roster.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* The salary each person is currently on, so the roster answers the question
     it is there to answer without a request per row. */
  const currentByEmployee = useMemo(() => {
    const map = new Map();
    for (const a of assignments) if (!map.has(a.employeeId)) map.set(a.employeeId, a);
    return map;
  }, [assignments]);

  const structureName = (id) => structures.find((s) => s.id === id)?.name || '—';

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="customer"
        title="Salary assignments"
        description="Who is paid what, and from when. A raise records a new salary rather than changing the old one."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> Add person
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {structures.length === 0 ? (
        <EmptyState
          title="No active salary structures yet"
          description="A salary is a structure plus a figure. Build a structure under Payroll → Salary structures, then people can be put on it."
        />
      ) : people.length === 0 ? (
        <EmptyState
          title="Nobody on payroll yet"
          description="Add the people this company pays, and give each of them a salary."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" /> Add person
            </button>
          }
        />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Designation</th>
                  <th scope="col" className="ui-th">Structure</th>
                  <th scope="col" className="ui-th ui-col-h-center">On this salary since</th>
                  <th scope="col" className="ui-th ui-col-h-right">Annual CTC</th>
                  <th scope="col" className="ui-th ui-col-h-right">Per month</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const current = currentByEmployee.get(p.id);
                  return (
                    <tr key={p.id} className="ui-row-click" onClick={() => setOpen(p)}>
                      <td className="ui-col-entity">
                        {p.name}
                        {p.code ? <span className="ui-caption block">{p.code}</span> : null}
                      </td>
                      <td className="ui-col-meta">{p.designation || '—'}</td>
                      <td className="ui-col-meta">{current ? structureName(current.structureId) : '—'}</td>
                      <td className="ui-col-date ui-col-h-center">{current ? shownDate(current.effectiveFrom) : '—'}</td>
                      <td className="ui-col-amount">{current ? money(current.annualCtc) : '—'}</td>
                      <td className="ui-col-amount">{current ? money(current.monthlyCtc) : '—'}</td>
                      <td>
                        <span className={`ui-pill ${p.status === 'ACTIVE' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                          {STATUSES.find((s) => s.id === p.status)?.label || p.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
            person={open}
            structures={structures}
            sensitiveVisible={sensitiveVisible}
            onClose={() => setOpen(null)}
            onChanged={() => {
              setOpen(null);
              load();
            }}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

/* --------------------------------------------------------- one person */

const PersonPanel = ({ person, structures, sensitiveVisible, onClose, onChanged }) => {
  const [tab, setTab] = useState('salary');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setHistory(await listAssignments({ employeeId: person.id }));
    } catch (e) {
      notify.error(String(e?.message || 'Could not load their salary history.'));
    } finally {
      setLoading(false);
    }
  }, [person.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="space-y-6">
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
    <div className="space-y-6">
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
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th ui-col-h-center">From</th>
                  <th scope="col" className="ui-th ui-col-h-center">To</th>
                  <th scope="col" className="ui-th ui-col-h-right">Annual CTC</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((a) => (
                  <tr key={a.id}>
                    <td className="ui-col-date ui-col-h-center">{shownDate(a.effectiveFrom)}</td>
                    <td className="ui-col-date ui-col-h-center">{a.effectiveTo ? shownDate(a.effectiveTo) : '—'}</td>
                    <td className="ui-col-amount">{money(a.annualCtc)}</td>
                    <td>
                      <span className={`ui-pill ${a.status === 'ACTIVE' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                        {a.status === 'ACTIVE' ? 'Current' : 'Past'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      await createAssignment({
        employeeId: person.id,
        structureId: form.structureId,
        effectiveFrom: form.effectiveFrom,
        annualCtc: Number(form.annualCtc) || 0,
      });
      notify.success(`${person.name}'s salary recorded.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Could not record that salary.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6">
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
      if (initial.id) await updateEmployee(initial.id, payload);
      else await createEmployee(payload);
      notify.success(`${form.name} saved.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Could not save that person.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6">
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
          <div>
            <label className="ui-label" htmlFor="employee-uan">UAN</label>
            <input
              id="employee-uan"
              className="ui-input ui-mono w-full"
              value={form.payroll.uan || ''}
              onChange={(e) => setPay({ uan: e.target.value })}
            />
          </div>
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
