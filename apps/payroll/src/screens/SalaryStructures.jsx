import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, GripVertical, Plus, Trash2 } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listSalaryComponents } from '../api/payrollComponents';
import {
  listSalaryStructures,
  getSalaryStructure,
  createSalaryStructure,
  updateSalaryStructure,
  deleteSalaryStructure,
  previewSalaryStructure,
} from '../api/payrollStructures';

/**
 * The shape of a salary, before anybody is on it.
 *
 * A structure is not a salary — it is Basic at half of CTC, HRA at two fifths
 * of Basic, an allowance taking the remainder. It becomes a salary when an
 * assignment gives it a person and a figure, which is what lets one structure
 * serve four hundred people on four hundred different packages.
 *
 * The preview beside the builder is the point of this screen. Payroll
 * configuration is the kind of work where a mistake is invisible until somebody
 * is underpaid, so the structure says what it pays at a real CTC while it is
 * still being typed — and it says it by asking the server to run the same
 * engine the payroll run will use, never by working it out again in the
 * browser.
 */

const FREQUENCIES = [
  { id: 'MONTHLY', label: 'Monthly', periods: 12 },
  { id: 'FORTNIGHTLY', label: 'Fortnightly', periods: 26 },
  { id: 'WEEKLY', label: 'Weekly', periods: 52 },
];

const STATUSES = [
  { id: 'DRAFT', label: 'Draft' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'ARCHIVED', label: 'Archived' },
];

const money = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;

const shownDate = (iso) => {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const blankStructure = () => ({
  name: '',
  code: '',
  frequency: 'MONTHLY',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: '',
  status: 'DRAFT',
  description: '',
  components: [],
});

export default function SalaryStructures() {
  const [rows, setRows] = useState([]);
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const [structures, comps] = await Promise.all([listSalaryStructures(), listSalaryComponents({ activeOnly: true })]);
      setRows(structures);
      setComponents(comps);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load salary structures.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (id) => {
    try {
      setEditing(await getSalaryStructure(id));
    } catch (e) {
      notify.error(String(e?.message || 'Could not open that structure.'));
    }
  };

  const remove = async (row) => {
    const ok = await confirmDialog({
      title: `Delete ${row.name}?`,
      message:
        'A structure nobody is on can be deleted. One with people assigned must be archived instead, so their payslips keep the structure they name.',
      confirmLabel: 'Yes, delete',
    });
    if (!ok) return;
    try {
      await deleteSalaryStructure(row.id);
      notify.success(`${row.name} deleted.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not delete that structure.'));
    }
  };

  if (loading) return <SkeletonCard lines={6} />;

  if (editing) {
    return (
      <StructureEditor
        initial={editing}
        components={components}
        onBack={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Salary structures"
        description="Reusable salary templates. A structure becomes a salary when somebody is assigned to it."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(blankStructure())}>
            <Plus size={16} aria-hidden="true" /> New structure
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {components.length === 0 ? (
        <EmptyState
          title="No salary components yet"
          description="A structure is a list of components. Add the earnings and deductions this company pays first, under Settings → Payroll → Salary components."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No salary structures yet"
          description="Build the salary shapes this company pays on. One structure can serve everybody on the same arrangement, whatever their individual package."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(blankStructure())}>
              <Plus size={16} aria-hidden="true" /> New structure
            </button>
          }
        />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Structure</th>
                  <th scope="col" className="ui-th">Cycle</th>
                  <th scope="col" className="ui-th ui-col-h-center">Effective from</th>
                  <th scope="col" className="ui-th ui-col-h-right">Components</th>
                  <th scope="col" className="ui-th ui-col-h-right">People on it</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th ui-col-h-center w-10">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="ui-row-click" onClick={() => open(s.id)}>
                    <td className="ui-col-entity">{s.name}</td>
                    <td className="ui-col-meta">{FREQUENCIES.find((f) => f.id === s.frequency)?.label || s.frequency}</td>
                    <td className="ui-col-date ui-col-h-center">{shownDate(s.effectiveFrom)}</td>
                    <td className="ui-col-amount">{s.components.length}</td>
                    <td className="ui-col-amount">{s.assignedCount}</td>
                    <td>
                      <span className={`ui-pill ${s.status === 'ACTIVE' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                        {STATUSES.find((x) => x.id === s.status)?.label || s.status}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {s.assignedCount === 0 ? (
                        <button type="button" className="ui-icon-btn" aria-label={`Delete ${s.name}`} onClick={() => remove(s)}>
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

const StructureEditor = ({ initial, components, onBack, onSaved }) => {
  const [form, setForm] = useState(() => ({ ...blankStructure(), ...initial }));
  const [saving, setSaving] = useState(false);
  /* A CTC to try the structure at. It is not part of the structure — an
     assignment carries the real one — so it lives only on this screen. */
  const [sampleCtc, setSampleCtc] = useState(1200000);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const seq = useRef(0);

  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const locked = Number(initial?.assignedCount || 0) > 0;
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  const lines = form.components;

  /* Asked of the server on every change, debounced, because the answer has to
     be the payroll engine's and not a second copy of it living here. */
  useEffect(() => {
    if (!lines.length) {
      setPreview(null);
      setPreviewError('');
      return undefined;
    }
    const mine = (seq.current += 1);
    const t = setTimeout(() => {
      previewSalaryStructure({
        components: lines.map((l, i) => ({ ...l, displayOrder: i + 1 })),
        frequency: form.frequency,
        annualCtc: Number(sampleCtc) || 0,
      })
        .then((p) => {
          if (seq.current === mine) {
            setPreview(p);
            setPreviewError('');
          }
        })
        .catch((e) => {
          if (seq.current === mine) {
            setPreview(null);
            setPreviewError(String(e?.message || 'Could not work this structure out.'));
          }
        });
    }, 300);
    return () => clearTimeout(t);
  }, [lines, form.frequency, sampleCtc]);

  const addComponent = (componentId) => {
    if (!componentId || lines.some((l) => l.componentId === componentId)) return;
    set({ components: [...lines, { componentId, isBalancing: false, displayOrder: lines.length + 1 }] });
  };

  const removeLine = (idx) => set({ components: lines.filter((_, i) => i !== idx) });

  const move = (idx, delta) => {
    const next = [...lines];
    const to = idx + delta;
    if (to < 0 || to >= next.length) return;
    [next[idx], next[to]] = [next[to], next[idx]];
    set({ components: next });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        code: form.code || null,
        frequency: form.frequency,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
        status: form.status,
        description: form.description || null,
        components: lines.map((l, i) => ({
          componentId: l.componentId,
          calculationMethod: l.calculationMethod || null,
          amount: l.amount ?? null,
          percentage: l.percentage ?? null,
          formula: l.formula || null,
          calculationBase: l.calculationBase || null,
          isBalancing: Boolean(l.isBalancing),
          displayOrder: i + 1,
        })),
      };
      if (initial.id) await updateSalaryStructure(initial.id, payload);
      else await createSalaryStructure(payload);
      notify.success(`${form.name} saved.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Could not save that structure.'));
    } finally {
      setSaving(false);
    }
  };

  const unused = components.filter((c) => !lines.some((l) => l.componentId === c.id));

  return (
    <form onSubmit={save} className="space-y-6">
      <PageHeader
        entity="settings"
        title={initial.id ? 'Edit salary structure' : 'New salary structure'}
        description="Which components somebody on this structure is paid, and how each one is worked out."
        actions={
          <>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save structure'}
            </button>
          </>
        }
      />

      {locked ? (
        <div
          className="flex items-start gap-2 rounded-lg p-3 text-sm"
          style={{ background: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))' }}
          role="status"
        >
          <span>
            {initial.assignedCount} {initial.assignedCount === 1 ? 'person is' : 'people are'} on this structure, so what it
            pays can no longer change. Raising pay means a new structure from the date the new pay applies. The name,
            description and status are still yours to edit.
          </span>
        </div>
      ) : null}

      <div className="ui-card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_9rem_10rem] gap-3">
          <div>
            <label className="ui-label" htmlFor="structure-name">Name</label>
            <input
              id="structure-name"
              className="ui-input w-full"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="structure-code">Code</label>
            <input
              id="structure-code"
              className="ui-input ui-mono w-full"
              value={form.code || ''}
              onChange={(e) => set({ code: e.target.value })}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="structure-status">Status</label>
            <select
              id="structure-status"
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

        <fieldset className="contents" disabled={locked}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="ui-label" htmlFor="structure-frequency">Cycle</label>
              <select
                id="structure-frequency"
                className="ui-select w-full"
                value={form.frequency}
                onChange={(e) => set({ frequency: e.target.value })}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="structure-from">Effective from</label>
              <input
                id="structure-from"
                type="date"
                className="ui-input w-full"
                value={form.effectiveFrom || ''}
                onChange={(e) => set({ effectiveFrom: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="ui-label" htmlFor="structure-to">Effective to</label>
              <input
                id="structure-to"
                type="date"
                className="ui-input w-full"
                value={form.effectiveTo || ''}
                onChange={(e) => set({ effectiveTo: e.target.value })}
              />
            </div>
          </div>
        </fieldset>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-6 items-start">
        {/* ---- the components ------------------------------------------- */}
        <div className="ui-card overflow-hidden">
          <div className="ui-sec-head px-4 py-3">Components</div>

          {lines.length === 0 ? (
            <div className="p-4">
              <p className="ui-caption">
                A structure is a list of components. Add the ones somebody on this structure is paid.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto ui-table-scroll">
              <table className="ui-table w-full">
                <thead>
                  <tr>
                    <th scope="col" className="ui-th w-10"><span className="sr-only">Order</span></th>
                    <th scope="col" className="ui-th">Component</th>
                    <th scope="col" className="ui-th">How it is worked out</th>
                    <th scope="col" className="ui-th ui-col-h-center">Balance of CTC</th>
                    <th scope="col" className="ui-th ui-col-h-right">This structure pays</th>
                    <th scope="col" className="ui-th ui-col-h-center w-10"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  <fieldset className="contents" disabled={locked}>
                    {lines.map((l, idx) => {
                      const c = byId.get(l.componentId);
                      const paid = preview?.lines?.find((x) => x.componentId === l.componentId);
                      return (
                        <tr key={l.componentId}>
                          <td>
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                className="ui-icon-btn !h-6 !w-6"
                                aria-label={`Move ${c?.name || 'component'} up`}
                                onClick={() => move(idx, -1)}
                              >
                                <GripVertical size={14} aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                          <td className="ui-col-entity">
                            {c?.name || 'Unknown component'}
                            <span className="ui-caption block">{c?.code}</span>
                          </td>
                          <td className="ui-col-meta">{describeLine(l, c)}</td>
                          <td className="ui-col-h-center">
                            <input
                              type="checkbox"
                              className="ui-checkbox"
                              aria-label={`${c?.name || 'Component'} takes the balance of CTC`}
                              checked={Boolean(l.isBalancing)}
                              onChange={(e) =>
                                set({
                                  components: lines.map((x, i) => ({
                                    ...x,
                                    /* Only one line can take the remainder, so
                                       ticking one unticks the others rather
                                       than letting the server refuse a save. */
                                    isBalancing: i === idx ? e.target.checked : false,
                                  })),
                                })
                              }
                            />
                          </td>
                          <td className="ui-col-amount">{paid ? money(paid.amount) : '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="ui-icon-btn"
                              aria-label={`Remove ${c?.name || 'component'}`}
                              onClick={() => removeLine(idx)}
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </fieldset>
                </tbody>
              </table>
            </div>
          )}

          {!locked && unused.length ? (
            <div className="p-4 flex items-center gap-2" style={{ borderTop: '1px solid rgb(var(--border))' }}>
              <label className="ui-label sr-only" htmlFor="structure-add">Add a component</label>
              <select
                id="structure-add"
                className="ui-select"
                style={{ width: '20rem' }}
                value=""
                onChange={(e) => addComponent(e.target.value)}
              >
                <option value="">Add a component…</option>
                {unused.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.type === 'EARNING' ? 'earning' : c.type === 'DEDUCTION' ? 'deduction' : 'employer cost'}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {/* ---- what it pays ---------------------------------------------- */}
        <div className="ui-card p-4 space-y-3 lg:sticky lg:top-4">
          <div className="ui-sec-head">What this pays</div>

          <div>
            <label className="ui-label" htmlFor="structure-sample-ctc">At an annual CTC of</label>
            <input
              id="structure-sample-ctc"
              type="number"
              min="0"
              step="1000"
              className="ui-input ui-num w-full"
              value={sampleCtc}
              onChange={(e) => setSampleCtc(e.target.value)}
            />
            <span className="ui-caption">
              Only to try the structure out. Each person&apos;s real CTC comes from their assignment.
            </span>
          </div>

          {previewError ? (
            <p className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>{previewError}</p>
          ) : null}

          {preview?.errors?.length ? (
            <ul className="space-y-1">
              {preview.errors.map((e, i) => (
                <li key={i} className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>{e.message}</li>
              ))}
            </ul>
          ) : null}

          {/* A nil the engine explains is worth showing. A statutory line reads
              as a deliberate zero until PF and ESI are configured, and somebody
              assembling a structure should learn that here rather than from a
              payslip. */}
          {preview?.warnings?.length ? (
            <ul className="space-y-1">
              {preview.warnings.map((w, i) => (
                <li key={i} className="ui-caption" style={{ color: 'rgb(var(--warn-ink))' }}>{w.message}</li>
              ))}
            </ul>
          ) : null}

          {preview ? (
            <dl className="space-y-1.5">
              <Figure label="Gross" value={preview.grossEarnings} />
              <Figure label="Deductions" value={preview.totalDeductions} />
              <Figure label="Net pay" value={preview.netPay} strong />
              <Figure label="Employer contributions" value={preview.employerContributions} />
              <Figure label="Monthly company cost" value={preview.employerCost} />
              <div style={{ borderTop: '1px solid rgb(var(--border))' }} className="pt-1.5">
                <Figure label="Annual company cost" value={preview.annual?.employerCost} />
              </div>
            </dl>
          ) : (
            <p className="ui-caption">Add a component to see what this structure pays.</p>
          )}
        </div>
      </div>
    </form>
  );
};

const Figure = ({ label, value, strong = false }) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className={strong ? 'text-sm font-medium' : 'ui-caption'}>{label}</dt>
    <dd className={`ui-num ${strong ? 'text-sm font-medium' : 'text-sm'}`}>{money(value)}</dd>
  </div>
);

/** How a line is worked out, taking the structure's override into account. */
const describeLine = (line, component) => {
  const method = line.calculationMethod || component?.calculationMethod;
  if (line.isBalancing || method === 'BALANCING') return 'Balance of CTC';
  if (method === 'PERCENTAGE') {
    const pct = line.percentage ?? component?.percentage;
    const base = line.calculationBase || component?.calculationBase || '—';
    return `${Number(pct || 0)}% of ${base}`;
  }
  if (method === 'FORMULA') return line.formula || component?.formula || 'Formula';
  if (method === 'VARIABLE') return 'Entered each month';
  if (method === 'STATUTORY') return `${component?.statutoryScheme || 'Statutory'} rule`;
  return 'Fixed amount';
};
