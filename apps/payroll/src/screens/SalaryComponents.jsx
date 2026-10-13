import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from '@ui/chrome/SettingsScreenHeader';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  listSalaryComponents,
  createSalaryComponent,
  updateSalaryComponent,
  deleteSalaryComponent,
  validateSalaryFormula,
  ruleCatalogue,
  setComponentConditions,
} from '../api/payrollComponents';

/**
 * The lines a salary is built from.
 *
 * This is the foundation of payroll: a structure is a list of these, a payslip
 * is what they evaluated to, and the ledger entry is where they post. So the
 * screen's job is to make each one's behaviour legible rather than to hide it
 * behind a name — two allowances with the same amount can be entirely
 * different things depending on whether they are taxable and whether they
 * count towards provident fund wages, and that difference belongs on the row,
 * not three clicks away.
 *
 * Every rule lives on the server. The form shows what it is told and reports
 * what it is refused; it does not decide for itself whether a combination is
 * allowed, because a second copy of a payroll rule is a copy that can disagree
 * with the one that actually runs.
 */

const TYPES = [
  { id: 'EARNING', label: 'Earnings', singular: 'Earning' },
  { id: 'DEDUCTION', label: 'Deductions', singular: 'Deduction' },
  { id: 'EMPLOYER_CONTRIBUTION', label: 'Employer costs', singular: 'Employer contribution' },
];

const METHODS = [
  { id: 'FIXED', label: 'Fixed amount' },
  { id: 'PERCENTAGE', label: 'Percentage of' },
  { id: 'FORMULA', label: 'Formula' },
  { id: 'VARIABLE', label: 'Entered each month' },
  { id: 'STATUTORY', label: 'Statutory rule' },
  { id: 'BALANCING', label: 'Balance of CTC' },
];

/*
 * Annual and per-period CTC both exist and are a thousand rupees apart in
 * meaning: half of an annual CTC as a MONTHLY component pays twelve times what
 * anybody intended. The list says which is which rather than leaving the
 * difference to be discovered on a payslip.
 */
const BASES = [
  { id: 'BASIC', label: 'Basic' },
  { id: 'GROSS', label: 'Gross for the period' },
  { id: 'MONTHLY_CTC', label: 'CTC for the period' },
  { id: 'CTC', label: 'CTC for the whole year' },
];
const SCHEMES = ['PF', 'ESI', 'PT', 'TDS', 'LWF'];

const blank = (type) => ({
  name: '',
  code: '',
  type,
  description: '',
  calculationMethod: 'FIXED',
  amount: 0,
  percentage: 0,
  formula: '',
  calculationBase: '',
  rounding: 'NEAREST',
  statutoryScheme: null,
  isTaxable: type === 'EARNING',
  prorate: true,
  includeInPfWage: false,
  includeInEsiWage: false,
  includeInGratuityWage: false,
  includeInGross: type === 'EARNING',
  /* An employer contribution never reaches take-home pay, and the server
     refuses one that claims to — so the form does not start it in a state it
     would immediately be told off for. */
  includeInNetPay: type !== 'EMPLOYER_CONTRIBUTION',
  isVariable: false,
  isFlexibleBenefit: false,
  expenseLedgerId: null,
  liabilityLedgerId: null,
  costCentreBehaviour: 'EMPLOYEE',
  displayOrder: 0,
  isActive: true,
  appliesTo: 'STRUCTURE',
  oneTimeDate: null,
  thresholdBase: '',
  thresholdOperator: '',
  thresholdAmount: 0,
  thresholdRangeEnd: 0,
  hasMaxLimit: false,
  maximumAmount: 0,
  exceedBehaviour: 'CAP',
  conditions: [],
});

/**
 * Who a component reaches, in one phrase.
 *
 * On the row, because a rule nobody can see from the list is a rule the next
 * person duplicates rather than reuses — and because "why did this allowance
 * appear on her payslip and not his" is answered here or not at all.
 */
const describeWho = (c) => {
  const named = (c.employeeTargets || []).length;
  const extra = named ? ` · ${named} named` : '';
  const when = c.oneTimeDate ? ` · once on ${c.oneTimeDate}` : '';
  if (c.appliesTo === 'ALL_EMPLOYEES') return `Everybody${extra}${when}`;
  if (c.appliesTo === 'CONDITIONS') {
    const n = (c.conditions || []).length;
    return `${n} condition${n === 1 ? '' : 's'}${extra}${when}`;
  }
  return `On a structure${extra}${when}`;
};

/** How a component works, in the words somebody configuring payroll would use. */
const describeMethod = (c) => {
  if (c.calculationMethod === 'PERCENTAGE') return `${Number(c.percentage)}% of ${c.calculationBase || '—'}`;
  if (c.calculationMethod === 'FORMULA') return c.formula || 'Formula';
  if (c.calculationMethod === 'VARIABLE') return 'Entered each month';
  if (c.calculationMethod === 'STATUTORY') return `${c.statutoryScheme || 'Statutory'} rule`;
  if (c.calculationMethod === 'BALANCING') return 'Balance of CTC';
  return 'Fixed amount';
};

export default function SalaryComponents() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [type, setType] = useState('EARNING');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await listSalaryComponents());
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load salary components.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const out = {};
    for (const t of TYPES) out[t.id] = rows.filter((r) => r.type === t.id).length;
    return out;
  }, [rows]);

  const shown = useMemo(
    () => rows.filter((r) => r.type === type).sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    [rows, type]
  );

  const remove = async (row) => {
    const ok = await confirmDialog({
      title: `Delete ${row.name}?`,
      message:
        'A component that has never been used on a payslip can be deleted. One that has must be made inactive instead, so old payslips stay readable.',
      confirmLabel: 'Yes, delete',
    });
    if (!ok) return;
    try {
      await deleteSalaryComponent(row.id);
      notify.success(`${row.name} deleted.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not delete that component.'));
    }
  };

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Salary components"
        description="The earnings, deductions and employer costs a salary is built from."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(blank(type))}>
            <Plus size={16} aria-hidden="true" /> New component
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {/* One strip, three populations. A deduction and an employer cost read
          almost the same on a row and mean opposite things to net pay, so they
          are never mixed into one list. */}
      <div className="ui-segmented" role="tablist" aria-label="Component type">
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={type === t.id}
            className="ui-segment"
            onClick={() => setType(t.id)}
          >
            {t.label}
            <span className="ui-segment-count">{counts[t.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={`No ${TYPES.find((t) => t.id === type)?.singular.toLowerCase()} components yet`}
          description="A salary structure is a list of components. Add the ones this company pays, and the structure can be built from them."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(blank(type))}>
              <Plus size={16} aria-hidden="true" /> New component
            </button>
          }
        />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Component</th>
                  <th scope="col" className="ui-th">Code</th>
                  <th scope="col" className="ui-th">How it is worked out</th>
                  <th scope="col" className="ui-th">Who gets it</th>
                  <th scope="col" className="ui-th ui-col-h-center">Taxable</th>
                  <th scope="col" className="ui-th ui-col-h-center">Prorated</th>
                  <th scope="col" className="ui-th">Counts towards</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th ui-col-h-center w-10">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const wages = [
                    c.includeInPfWage ? 'PF' : null,
                    c.includeInEsiWage ? 'ESI' : null,
                    c.includeInGratuityWage ? 'Gratuity' : null,
                  ].filter(Boolean);
                  return (
                    <tr key={c.id} className="ui-row-click" onClick={() => setEditing(c)}>
                      <td className="ui-col-entity">{c.name}</td>
                      <td className="ui-col-id">{c.code}</td>
                      <td className="ui-col-meta">{describeMethod(c)}</td>
                      <td className="ui-col-meta">{describeWho(c)}</td>
                      <td className="ui-col-h-center">{c.isTaxable ? 'Yes' : 'No'}</td>
                      <td className="ui-col-h-center">{c.prorate ? 'Yes' : 'No'}</td>
                      <td className="ui-col-meta">{wages.length ? wages.join(', ') : '—'}</td>
                      <td>
                        <span className={`ui-pill ${c.isActive ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                          {c.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="ui-icon-btn"
                          aria-label={`Delete ${c.name}`}
                          onClick={() => remove(c)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ComponentDrawer
        component={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </div>
  );
}

/* Split so the form's state lives only while it is open: closing discards an
   unsaved edit, and reopening reads the row fresh rather than a stale copy. */
const ComponentDrawer = ({ component, onClose, onSaved }) => (
  <Drawer
    open={Boolean(component)}
    onClose={onClose}
    title={component?.id ? 'Edit component' : 'New salary component'}
    description="What this line is, how it is worked out, and what it counts towards."
  >
    {component ? <ComponentForm initial={component} onClose={onClose} onSaved={onSaved} /> : null}
  </Drawer>
);

const ComponentForm = ({ initial, onClose, onSaved }) => {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  /*
   * The fields and comparisons a rule may use, read from the server.
   *
   * Not a list in this file. The eligibility service evaluates exactly these,
   * and a second catalogue here drifts the day somebody adds a field to one of
   * them — the symptom being a rule that saves and matches nobody.
   */
  const [catalogue, setCatalogue] = useState({ fields: [], operators: [] });
  useEffect(() => {
    let cancelled = false;
    ruleCatalogue()
      .then((c) => {
        if (!cancelled) setCatalogue({ fields: c.fields || [], operators: c.operators || [] });
      })
      .catch(() => {
        /* A catalogue that cannot be read leaves the rule editor empty and
           says so there, rather than failing the whole form. */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [formulaCheck, setFormulaCheck] = useState(null);
  const checkedFor = useRef('');

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const isNew = !initial.id;

  /* Checked against the same parser the payroll run uses, so a formula that
     passes here cannot fail on the twentieth employee of a run. Debounced —
     this is somebody typing, not somebody submitting. */
  useEffect(() => {
    if (form.calculationMethod !== 'FORMULA') {
      setFormulaCheck(null);
      return undefined;
    }
    const text = String(form.formula || '').trim();
    if (!text) {
      setFormulaCheck(null);
      return undefined;
    }
    const t = setTimeout(() => {
      checkedFor.current = text;
      validateSalaryFormula(text)
        .then((verdict) => {
          if (checkedFor.current === text) setFormulaCheck(verdict);
        })
        .catch(() => setFormulaCheck(null));
    }, 350);
    return () => clearTimeout(t);
  }, [form.formula, form.calculationMethod]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      /* `conditions` and `employeeTargets` are rows with their own endpoints,
         not fields of the component: sending them here would have every save
         of a name rewrite the rule set. */
      const { conditions, employeeTargets: _named, ...rest } = form;
      const payload = {
        ...rest,
        amount: Number(form.amount || 0),
        percentage: Number(form.percentage || 0),
        displayOrder: Number(form.displayOrder || 0),
        thresholdAmount: Number(form.thresholdAmount || 0),
        thresholdRangeEnd: Number(form.thresholdRangeEnd || 0),
        maximumAmount: Number(form.maximumAmount || 0),
        thresholdOperator: form.thresholdBase ? form.thresholdOperator || 'GT' : null,
        thresholdBase: form.thresholdBase || null,
        statutoryScheme: form.calculationMethod === 'STATUTORY' ? form.statutoryScheme : null,
      };
      const saved = isNew ? await createSalaryComponent(payload) : await updateSalaryComponent(initial.id, payload);

      /*
       * The rules, second, and only where they are the ones being used.
       *
       * A component that reaches people through a structure has no conditions
       * to save, and writing an empty set for it would quietly clear a rule
       * somebody had parked while switching modes to look at something.
       */
      if (form.appliesTo === 'CONDITIONS') {
        await setComponentConditions(saved.id, (conditions || []).map((c) => ({
          field: c.field,
          operator: c.operator,
          value: c.value ?? '',
        })));
      }
      notify.success(`${form.name} saved.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Could not save that component.'));
    } finally {
      setSaving(false);
    }
  };

  const Check = ({ field, label, hint = '' }) => (
    <label className="flex items-start gap-2 text-sm" htmlFor={`component-${field}`}>
      <input
        id={`component-${field}`}
        type="checkbox"
        className="ui-checkbox mt-0.5"
        checked={Boolean(form[field])}
        onChange={(e) => set({ [field]: e.target.checked })}
      />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint ? <span className="ui-caption block">{hint}</span> : null}
      </span>
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_10rem] gap-3">
          <div>
            <label className="ui-label" htmlFor="component-name">Name</label>
            <input
              id="component-name"
              className="ui-input w-full"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="component-code">Code</label>
            <input
              id="component-code"
              className="ui-input ui-mono w-full"
              value={form.code}
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
              required
            />
            <span className="ui-caption">What a formula refers to.</span>
          </div>
        </div>

        <div>
          <label className="ui-label" htmlFor="component-description">Description</label>
          <input
            id="component-description"
            className="ui-input w-full"
            value={form.description || ''}
            onChange={(e) => set({ description: e.target.value })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="ui-t-sec">How it is worked out</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="ui-label" htmlFor="component-method">Method</label>
            <select
              id="component-method"
              className="ui-select w-full"
              value={form.calculationMethod}
              onChange={(e) => set({ calculationMethod: e.target.value })}
            >
              {METHODS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          {form.calculationMethod === 'FIXED' ? (
            <div>
              <label className="ui-label" htmlFor="component-amount">Amount</label>
              <input
                id="component-amount"
                type="number"
                min="0"
                step="0.01"
                className="ui-input ui-num w-full"
                value={form.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </div>
          ) : null}

          {form.calculationMethod === 'PERCENTAGE' ? (
            <>
              <div>
                <label className="ui-label" htmlFor="component-percentage">Percentage</label>
                <input
                  id="component-percentage"
                  type="number"
                  min="0"
                  step="0.01"
                  className="ui-input ui-num w-full"
                  value={form.percentage}
                  onChange={(e) => set({ percentage: e.target.value })}
                />
              </div>
              <div>
                <label className="ui-label" htmlFor="component-base">Of</label>
                <select
                  id="component-base"
                  className="ui-select w-full"
                  value={form.calculationBase || ''}
                  onChange={(e) => set({ calculationBase: e.target.value })}
                >
                  <option value="">Choose one</option>
                  {BASES.map((b) => (
                    <option key={b.id} value={b.id}>{b.label}</option>
                  ))}
                </select>
              </div>
            </>
          ) : null}

          {form.calculationMethod === 'STATUTORY' ? (
            <div>
              <label className="ui-label" htmlFor="component-scheme">Scheme</label>
              <select
                id="component-scheme"
                className="ui-select w-full"
                value={form.statutoryScheme || ''}
                onChange={(e) => set({ statutoryScheme: e.target.value })}
              >
                <option value="">Choose one</option>
                {SCHEMES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label className="ui-label" htmlFor="component-rounding">Rounding</label>
            <select
              id="component-rounding"
              className="ui-select w-full"
              value={form.rounding}
              onChange={(e) => set({ rounding: e.target.value })}
            >
              <option value="NONE">None</option>
              <option value="NEAREST">Nearest rupee</option>
              <option value="UP">Up</option>
              <option value="DOWN">Down</option>
            </select>
          </div>
        </div>

        {form.calculationMethod === 'FORMULA' ? (
          <div>
            <label className="ui-label" htmlFor="component-formula">Formula</label>
            <input
              id="component-formula"
              className="ui-input ui-mono w-full"
              value={form.formula || ''}
              onChange={(e) => set({ formula: e.target.value })}
              placeholder="BASIC * 0.4"
            />
            {/* What it does, on a worked example, before it is saved. */}
            {formulaCheck?.ok ? (
              <span className="ui-caption block mt-1">
                Reads correctly. On a ₹40,000 basic and ₹80,000 gross this pays{' '}
                <span className="ui-num">{Number(formulaCheck.sample ?? 0).toLocaleString('en-IN')}</span>.
              </span>
            ) : null}
            {formulaCheck && !formulaCheck.ok ? (
              <span className="ui-caption block mt-1" style={{ color: 'rgb(var(--neg))' }}>
                {formulaCheck.error}
              </span>
            ) : null}
            {!formulaCheck ? (
              <span className="ui-caption block mt-1">
                BASIC, GROSS, CTC, PAYABLE_DAYS and WORKING_DAYS, with IF, MIN, MAX and ROUND.
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      {/*
        Who gets it, and within what limits.
        *
        * Two questions that look alike and are answered at different moments:
        * the conditions decide who the component is for, from facts about the
        * person, before any arithmetic; the threshold and the ceiling are about
        * the number it comes to, and are settled during the calculation. The
        * form keeps them in one section because somebody configuring an
        * allowance thinks of them together, and labels them apart because the
        * engine does not.
        */}
      <section className="space-y-3">
        <h3 className="ui-t-sec">Who gets it</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="ui-label" htmlFor="component-applies">Reaches</label>
            <select
              id="component-applies"
              className="ui-select w-full"
              value={form.appliesTo || 'STRUCTURE'}
              onChange={(e) => set({ appliesTo: e.target.value })}
            >
              <option value="STRUCTURE">Only where a salary structure lists it</option>
              <option value="ALL_EMPLOYEES">Everybody being paid</option>
              <option value="CONDITIONS">Everybody who matches the conditions below</option>
            </select>
          </div>

          <div>
            <label className="ui-label" htmlFor="component-onetime">One period only</label>
            <input
              id="component-onetime"
              type="date"
              className="ui-input w-full"
              value={form.oneTimeDate || ''}
              onChange={(e) => set({ oneTimeDate: e.target.value || null })}
            />
            <span className="ui-caption">
              A date rather than a switch: &ldquo;the March bonus&rdquo; has to survive being read in June.
            </span>
          </div>
        </div>

        {form.appliesTo === 'CONDITIONS' ? (
          <ConditionEditor
            catalogue={catalogue}
            conditions={form.conditions || []}
            onChange={(conditions) => set({ conditions })}
          />
        ) : null}

        <h3 className="ui-t-sec pt-2">Limits on the amount</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="ui-label" htmlFor="component-threshold-base">Only pay when</label>
            <select
              id="component-threshold-base"
              className="ui-select w-full"
              value={form.thresholdBase || ''}
              onChange={(e) => set({ thresholdBase: e.target.value, thresholdOperator: e.target.value ? form.thresholdOperator || 'GT' : '' })}
            >
              <option value="">No threshold</option>
              {BASES.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>
          {form.thresholdBase ? (
            <>
              <div>
                <label className="ui-label" htmlFor="component-threshold-op">is</label>
                <select
                  id="component-threshold-op"
                  className="ui-select w-full"
                  value={form.thresholdOperator || 'GT'}
                  onChange={(e) => set({ thresholdOperator: e.target.value })}
                >
                  <option value="GT">more than</option>
                  <option value="GE">at least</option>
                  <option value="LT">less than</option>
                  <option value="LE">at most</option>
                  <option value="EQ">exactly</option>
                  <option value="NE">anything but</option>
                  <option value="RANGE">between</option>
                </select>
              </div>
              <div>
                <label className="ui-label" htmlFor="component-threshold-amount">Amount</label>
                <input
                  id="component-threshold-amount"
                  type="number"
                  min="0"
                  className="ui-input ui-num w-full"
                  value={form.thresholdAmount ?? 0}
                  onChange={(e) => set({ thresholdAmount: e.target.value })}
                />
              </div>
              {form.thresholdOperator === 'RANGE' ? (
                <div className="sm:col-start-4">
                  <label className="ui-label" htmlFor="component-threshold-end">and</label>
                  <input
                    id="component-threshold-end"
                    type="number"
                    min="0"
                    className="ui-input ui-num w-full"
                    value={form.thresholdRangeEnd ?? 0}
                    onChange={(e) => set({ thresholdRangeEnd: e.target.value })}
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <Check field="hasMaxLimit" label="Has a maximum" hint="Measured on the full period, before any proration." />
          {form.hasMaxLimit ? (
            <>
              <div>
                <label className="ui-label" htmlFor="component-max">Maximum</label>
                <input
                  id="component-max"
                  type="number"
                  min="0"
                  className="ui-input ui-num w-full"
                  value={form.maximumAmount ?? 0}
                  onChange={(e) => set({ maximumAmount: e.target.value })}
                />
              </div>
              <div>
                <label className="ui-label" htmlFor="component-exceed">Past the maximum</label>
                <select
                  id="component-exceed"
                  className="ui-select w-full"
                  value={form.exceedBehaviour || 'CAP'}
                  onChange={(e) => set({ exceedBehaviour: e.target.value })}
                >
                  <option value="CAP">Pay the maximum</option>
                  <option value="EXCLUDE">Pay nothing</option>
                </select>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="ui-t-sec">What it counts towards</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
          <Check field="isTaxable" label="Taxable" hint="Counts towards income tax." />
          <Check field="prorate" label="Prorated" hint="Reduced when somebody joins or leaves mid-period." />
          <Check field="includeInGross" label="Part of gross" />
          <Check field="includeInNetPay" label="Part of net pay" />
          <Check field="includeInPfWage" label="Counts towards PF wages" />
          <Check field="includeInEsiWage" label="Counts towards ESI wages" />
          <Check field="includeInGratuityWage" label="Counts towards gratuity wages" />
          <Check field="isVariable" label="Entered each month" hint="The amount is given per payroll rather than standing." />
          <Check field="isActive" label="Active" hint="An inactive component stays on old payslips but is offered nowhere new." />
        </div>
      </section>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save component'}
        </button>
      </div>
    </form>
  );
};

/**
 * The rules that decide who a component is for.
 *
 * Every row is ANDed with the ones above it, and the screen says so in words
 * rather than leaving it to be inferred from layout — an engine with AND and
 * OR needs brackets, brackets need a shape nobody can see in a form, and the
 * result is rules whose own authors cannot say what they mean. Two populations
 * are two components, each named for the people it pays.
 *
 * The fields and comparisons come from the server, so this offers exactly what
 * the engine evaluates. A field this does not know about is a rule that saves
 * cleanly and matches nobody.
 */
const ConditionEditor = ({ catalogue, conditions, onChange }) => {
  const fields = catalogue.fields || [];
  const operators = catalogue.operators || [];
  const needsValue = (op) => operators.find((o) => o.operator === op)?.needsValue !== false;

  const update = (i, patch) => onChange(conditions.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  const add = () =>
    onChange([...conditions, { field: fields[0]?.field || '', operator: 'EQ', value: '' }]);
  const remove = (i) => onChange(conditions.filter((_, n) => n !== i));

  if (!fields.length) {
    return (
      <p className="ui-caption">
        The list of things a rule can test could not be read, so conditions cannot be edited here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {conditions.map((c, i) => {
        const field = fields.find((f) => f.field === c.field);
        return (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[3rem_1fr_1fr_1fr_2.5rem] gap-2 items-end">
            <span className="ui-caption pb-2">{i === 0 ? 'Where' : 'and'}</span>

            <div>
              <label className="sr-only" htmlFor={`cond-field-${i}`}>What to test</label>
              <select
                id={`cond-field-${i}`}
                className="ui-select w-full"
                value={c.field}
                onChange={(e) => update(i, { field: e.target.value, value: '' })}
              >
                {fields.map((f) => (
                  <option key={f.field} value={f.field}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="sr-only" htmlFor={`cond-op-${i}`}>Comparison</label>
              <select
                id={`cond-op-${i}`}
                className="ui-select w-full"
                value={c.operator}
                onChange={(e) => update(i, { operator: e.target.value })}
              >
                {operators.map((o) => (
                  <option key={o.operator} value={o.operator}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="sr-only" htmlFor={`cond-value-${i}`}>Value</label>
              {needsValue(c.operator) ? (
                field?.choices ? (
                  <select
                    id={`cond-value-${i}`}
                    className="ui-select w-full"
                    value={c.value || ''}
                    onChange={(e) => update(i, { value: e.target.value })}
                  >
                    <option value="">Choose…</option>
                    {field.choices.map((choice) => (
                      <option key={choice} value={choice}>{choice}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`cond-value-${i}`}
                    className="ui-input w-full"
                    type={field?.kind === 'number' ? 'number' : 'text'}
                    value={c.value || ''}
                    onChange={(e) => update(i, { value: e.target.value })}
                    placeholder={
                      c.operator === 'IN' || c.operator === 'NOT_IN' ? 'Sales, Support' : ''
                    }
                  />
                )
              ) : (
                <span className="ui-caption">Nothing to compare against.</span>
              )}
            </div>

            <button
              type="button"
              className="ui-icon-btn"
              onClick={() => remove(i)}
              aria-label={`Remove condition ${i + 1}`}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        );
      })}

      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={add}>
        <Plus size={14} aria-hidden="true" /> Add a condition
      </button>

      {conditions.length === 0 ? (
        <p className="ui-caption">
          A conditional component with no conditions pays nobody. To pay everybody, set
          <span className="ui-fg"> Reaches </span> to everybody instead.
        </p>
      ) : (
        <p className="ui-caption">Every condition has to hold. Somebody named below overrides all of them.</p>
      )}
    </div>
  );
};
