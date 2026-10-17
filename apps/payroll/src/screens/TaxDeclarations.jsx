import React, { useCallback, useEffect, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { formatDateIn } from '@ui/utils/dates';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { getTaxDeclaration, listTaxDeclarations, reopenTaxDeclaration, saveTaxDeclaration, verifyTaxDeclaration } from '../api/payrollTaxDeclarations';

const STATUS = {
  NONE: { label: 'Not declared', pill: 'ui-pill-neutral' },
  DRAFT: { label: 'Draft', pill: 'ui-pill-neutral' },
  SUBMITTED: { label: 'To verify', pill: 'ui-pill-warn' },
  VERIFIED: { label: 'Verified', pill: 'ui-pill-pos' },
};

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** "2026-27" for today, and the year before it. */
const yearOf = (d) => {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const thisYear = yearOf(new Date());
const lastYear = `${Number(thisYear.slice(0, 4)) - 1}-${thisYear.slice(2, 4)}`;

/**
 * Income tax declarations for the year: what people declared (from the
 * portal, or entered here), what their proofs support, and verification.
 * Until verified, tax is withheld on what was declared; after, on what was proved.
 */
export default function TaxDeclarations() {
  const [fy, setFy] = useState(thisYear);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    listTaxDeclarations(fy)
      .then((r) => {
        setData(r);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load declarations.')));
  }, [fy]);
  useEffect(() => {
    load();
  }, [load]);

  const people = data?.people || [];
  const waiting = people.filter((p) => p.status === 'SUBMITTED').length;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="payroll"
        title="Tax declarations"
        description="Regime and investments for income tax. Tax is withheld on what was declared until the proofs are verified."
        actions={
          <select className="ui-select" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
            <option value={thisYear}>FY {thisYear}</option>
            <option value={lastYear}>FY {lastYear}</option>
          </select>
        }
      />
      {error ? (
        <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" role="alert">
          <span style={{ color: 'rgb(var(--neg))' }}>{error}</span>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={load}>Try again</button>
        </div>
      ) : null}
      {!data ? (
        error ? null : <SkeletonCard lines={5} />
      ) : !people.length ? (
        <EmptyState title="Nobody in payroll yet" description="People paid through payroll appear here." />
      ) : (
        <div className="ui-card overflow-hidden">
          {waiting ? <div className="ui-caption px-4 pt-3">{waiting} waiting for proofs to be checked.</div> : null}
          <div className="overflow-x-auto">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Regime</th>
                  <th scope="col" className="ui-th ui-col-h-amount">Declared</th>
                  <th scope="col" className="ui-th ui-col-h-amount">Verified</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.employeeId} className="cursor-pointer" onClick={() => setOpen(p.employeeId)}>
                    <td className="ui-col-entity">
                      <button type="button" className="text-start" onClick={() => setOpen(p.employeeId)}>
                        {p.name}
                        {p.code ? <span className="ui-caption"> · {p.code}</span> : null}
                      </button>
                    </td>
                    <td className="text-sm">{p.regime === 'OLD' ? 'Old' : 'New'}</td>
                    <td className="ui-col-amount">{p.regime === 'OLD' && p.declared ? money(p.declared) : '—'}</td>
                    <td className="ui-col-amount">{p.verified != null && p.regime === 'OLD' ? money(p.verified) : '—'}</td>
                    <td className="ui-col-h-center">
                      <span className={`ui-pill ${STATUS[p.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[p.status]?.label || p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {open ? (
        <Declaration
          employeeId={open}
          fy={fy}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      ) : null}
    </div>
  );
}

function Declaration({ employeeId, fy, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const take = (row) => {
    setD(row);
    setForm({
      regime: row.regime,
      items: row.items.map((i) => ({ code: i.code, declared: i.declared || '', verified: i.verified ?? '', note: i.note || '' })),
      monthlyRent: row.monthlyRent || '',
      metroCity: row.metroCity,
      landlordPan: row.landlordPan || '',
      seniorSelf: row.seniorSelf,
      seniorParents: row.seniorParents,
    });
  };
  useEffect(() => {
    getTaxDeclaration(employeeId, fy)
      .then(take)
      .catch((e) => setError(String(e?.message || 'Could not load the declaration.')));
  }, [employeeId, fy]);

  const verified = d?.status === 'VERIFIED';
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setItem = (code, patch) => setForm((f) => ({ ...f, items: f.items.map((i) => (i.code === code ? { ...i, ...patch } : i)) }));

  const run = async (fn, done) => {
    setBusy(true);
    try {
      take(await fn());
      notify.success(done);
      onChanged();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const body = () => ({
    regime: form.regime,
    items: form.items.map((i) => ({ code: i.code, declared: Number(i.declared) || 0, verified: i.verified === '' ? null : Number(i.verified) || 0, note: i.note || null })),
    monthlyRent: Number(form.monthlyRent) || 0,
    metroCity: form.metroCity,
    landlordPan: form.landlordPan || null,
    seniorSelf: form.seniorSelf,
    seniorParents: form.seniorParents,
  });
  const save = () => run(() => saveTaxDeclaration(employeeId, fy, body()), 'Saved.');
  const verify = async () => {
    const ok = await confirmDialog({
      title: 'Mark the proofs verified?',
      message: 'Tax from the next pay run is worked out on the verified amounts. Blank verified amounts count as nothing proved.',
      confirmLabel: 'Verify',
      tone: 'default',
    });
    if (!ok) return;
    run(async () => {
      await saveTaxDeclaration(employeeId, fy, body());
      return verifyTaxDeclaration(employeeId, fy);
    }, 'Verified.');
  };

  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(48rem,96vw)]"
      title={d ? `${d.employeeName} · FY ${fy}` : 'Tax declaration'}
      description={d ? `${STATUS[d.status]?.label || d.status}${d.submittedAt ? ` · declared ${formatDateIn(String(d.submittedAt).slice(0, 10))}` : ''}` : ''}
      actions={
        !form ? null : verified ? (
          <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => run(() => reopenTaxDeclaration(employeeId, fy), 'Reopened.')}>
            <RotateCcw size={14} aria-hidden="true" /> Reopen
          </button>
        ) : (
          <>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={save}>Save</button>
            {form.regime === 'OLD' ? (
              <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={verify}>
                <Check size={14} aria-hidden="true" /> Verify proofs
              </button>
            ) : null}
          </>
        )
      }
    >
      {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      {!form ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <fieldset disabled={verified || busy} className="space-y-6">
          <div>
            <span className="ui-label">Tax regime</span>
            <div className="flex flex-wrap gap-4 text-sm">
              {[
                ['NEW', 'New regime — lower rates, no investment deductions'],
                ['OLD', 'Old regime — deductions for investments, rent and home loan'],
              ].map(([v, label]) => (
                <label key={v} className="inline-flex items-center gap-2">
                  <input type="radio" name="regime" value={v} checked={form.regime === v} onChange={() => set({ regime: v })} /> {label}
                </label>
              ))}
            </div>
          </div>

          {form.regime === 'OLD' ? (
            <>
              <div className="overflow-x-auto">
                <table className="ui-table w-full">
                  <thead>
                    <tr>
                      <th scope="col" className="ui-th">Section</th>
                      <th scope="col" className="ui-th ui-col-h-amount">Declared</th>
                      <th scope="col" className="ui-th ui-col-h-amount">Verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((meta) => {
                      const i = form.items.find((x) => x.code === meta.code);
                      const cap = (meta.code === '80D_SELF' && form.seniorSelf) || (meta.code === '80D_PARENTS' && form.seniorParents) ? meta.seniorCap : meta.cap;
                      return (
                        <tr key={meta.code}>
                          <td>
                            <span className="text-sm">{meta.label}</span>
                            <span className="ui-caption block">{meta.hint}{cap ? ` Up to ${money(cap)}.` : ''}</span>
                          </td>
                          <td className="ui-col-amount">
                            <input type="number" min="0" step="1" className="ui-input ui-num w-28" aria-label={`${meta.label} declared`} value={i.declared} onChange={(e) => setItem(meta.code, { declared: e.target.value })} />
                          </td>
                          <td className="ui-col-amount">
                            <input type="number" min="0" step="1" className="ui-input ui-num w-28" aria-label={`${meta.label} verified`} placeholder="—" value={i.verified} onChange={(e) => setItem(meta.code, { verified: e.target.value })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="ui-label" htmlFor="tx-rent">Rent a month</label>
                  <input id="tx-rent" type="number" min="0" className="ui-input ui-num w-full" value={form.monthlyRent} onChange={(e) => set({ monthlyRent: e.target.value })} />
                </div>
                <div>
                  <label className="ui-label" htmlFor="tx-pan">Landlord’s PAN</label>
                  <input id="tx-pan" className="ui-input w-full uppercase" maxLength={10} value={form.landlordPan} onChange={(e) => set({ landlordPan: e.target.value })} />
                  <span className="ui-caption">Needed when rent is over ₹1,00,000 a year.</span>
                </div>
                <div className="space-y-2 pt-6 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.metroCity} onChange={(e) => set({ metroCity: e.target.checked })} /> Lives in Delhi, Mumbai, Kolkata or Chennai</label>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.seniorSelf} onChange={(e) => set({ seniorSelf: e.target.checked })} /> They are 60 or older</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.seniorParents} onChange={(e) => set({ seniorParents: e.target.checked })} /> Their parents are 60 or older</label>
              </div>
              <p className="ui-caption">
                Their own PF from salary is added to 80C automatically. The HRA exemption is worked out from their Basic and HRA on each payslip. Enter verified amounts from the
                proofs, then verify.
              </p>
            </>
          ) : (
            <p className="ui-caption">Under the new regime only the standard deduction applies; nothing else needs declaring.</p>
          )}
        </fieldset>
      )}
    </Drawer>
  );
}
