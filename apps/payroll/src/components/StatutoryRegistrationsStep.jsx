import React, { useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from '@ui/components/ui/lineIcons';

import { notify } from "@ui/components/ui/notify";
import SuggestInput from "@ui/components/ui/SuggestInput";
import { requestOpenScreen } from "@platform/context";
import { getStatutoryRegistrations, saveStatutoryRegistrations } from "../api/payrollSetup";
import { WHERE, problemOf } from "./statutoryRegistrationText";

/**
 * The numbers each statutory return is filed under (roadmap 15).
 *
 * The first pay run can work out PF, ESI, professional tax and income tax to
 * the rupee and still produce nothing a portal will take, because the PF ECR
 * is filed under an establishment code, the ESI return under an employer code,
 * professional tax under a registration in each state and Form 24Q under a
 * TAN. These lived on the Compliance screen, where a first-time user had to
 * know to look. This step asks for them where setup happens and says, for each
 * one, where the number is found. It writes to the same fields Compliance
 * edits; there is one copy.
 *
 * It can be skipped. The checklist then keeps showing it, and the pay run
 * screen says which return cannot be filed until the number is added.
 */

const rupees = (n) => (n == null ? "" : `₹${Number(n).toLocaleString("en-IN")}`);

/**
 * Professional tax registration numbers, one per state. The states payroll
 * has people in are always listed; others can be added from the states that
 * levy the tax. `onCommit`, when given, is called with the rows after a
 * change is finished (a field left, a state added or removed), for a screen
 * that saves as it goes.
 */
export function PtRegistrationFields({ value, onChange, levyStates = [], disabled = false, onCommit }) {
  const [adding, setAdding] = useState("");
  const rows = Array.isArray(value) ? value : [];
  const listed = new Set(rows.map((r) => r.state));
  const choices = levyStates.filter((s) => !listed.has(s.state));

  const update = (state, registrationNumber) => onChange(rows.map((r) => (r.state === state ? { ...r, registrationNumber } : r)));
  const add = () => {
    const pick = levyStates.find((s) => s.state === adding);
    if (!pick) return;
    const next = [...rows, { state: pick.state, label: pick.label, registrationNumber: "", people: 0 }];
    onChange(next);
    setAdding("");
    if (onCommit) onCommit(next);
  };
  const remove = (state) => {
    const next = rows.filter((r) => r.state !== state);
    onChange(next);
    if (onCommit) onCommit(next);
  };

  return (
    <div className="space-y-3">
      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((r) => {
            const problem = problemOf("pt", r.registrationNumber);
            return (
              <li key={r.state} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[14rem] flex-1">
                  <label className="block">
                    <span className="ui-label">{r.label}</span>
                    <input
                      className="ui-input w-full uppercase"
                      value={r.registrationNumber}
                      maxLength={30}
                      disabled={disabled}
                      aria-invalid={Boolean(problem)}
                      placeholder="Registration number"
                      onChange={(e) => update(r.state, e.target.value.toUpperCase())}
                      onBlur={() => onCommit && onCommit(rows)}
                    />
                  </label>
                  {problem ? (
                    <span className="ui-caption block ui-text-neg">{problem}</span>
                  ) : r.people ? (
                    <span className="ui-caption block">{r.people} {r.people === 1 ? "person" : "people"} in payroll there</span>
                  ) : null}
                </div>
                {!r.people ? (
                  <button type="button" className="ui-icon-btn" aria-label={`Remove ${r.label}`} onClick={() => remove(r.state)} disabled={disabled}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ui-caption">Nobody in payroll has a state yet. Add the states you are registered in.</p>
      )}
      <p className="ui-caption max-w-[65ch]">{WHERE.pt}</p>
      {choices.length ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[14rem]">
            <span className="ui-label">Another state</span>
            <select className="ui-select w-full" value={adding} onChange={(e) => setAdding(e.target.value)} disabled={disabled}>
              <option value="">Choose a state</option>
              {choices.map((s) => (
                <option key={s.state} value={s.state}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={add} disabled={disabled || !adding}>
            <Plus size={16} aria-hidden="true" /> Add state
          </button>
        </div>
      ) : null}
    </div>
  );
}

const Field = ({ label, value, onChange, scheme, placeholder, where, disabled, maxLength = 40 }) => {
  const problem = problemOf(scheme, value);
  return (
    <div>
      <label className="block max-w-[22rem]">
        <span className="ui-label">{label}</span>
        <input
          className="ui-input w-full uppercase"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={Boolean(problem)}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
      </label>
      <span className={`ui-caption block max-w-[65ch] ${problem ? "ui-text-neg" : ""}`}>{problem || where}</span>
    </div>
  );
};

/**
 * The step itself, on the setup page. `onSaved` lets the checklist above it
 * re-read its state; `startOpen` opens the form at once (the checklist's
 * "Set up" button).
 */
export function StatutoryRegistrationsStep({ onSaved, startOpen = false }) {
  const [saved, setSaved] = useState(null);
  const [failed, setFailed] = useState("");
  const [open, setOpen] = useState(startOpen);
  const [skipped, setSkipped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  const fill = (s) => {
    setSaved(s);
    setForm({
      pf: { applies: s.pf.applies, code: s.pf.code, contributeOnFullWage: s.pf.contributeOnFullWage },
      esi: { applies: s.esi.applies, code: s.esi.code },
      pt: { applies: s.pt.applies, registrations: s.pt.registrations },
      tds: {
        applies: s.tds.applies,
        tan: s.tds.tan,
        deductorType: s.tds.deductorType || "",
        responsibleName: s.tds.responsibleName,
        responsibleDesignation: s.tds.responsibleDesignation,
      },
    });
  };

  useEffect(() => {
    getStatutoryRegistrations()
      .then(fill)
      .catch((e) => setFailed(String(e?.message || "Could not read the registrations.")));
  }, []);

  useEffect(() => {
    if (startOpen) {
      setOpen(true);
      setSkipped(false);
    }
  }, [startOpen]);

  if (failed) return <p className="ui-caption" role="alert">{failed}</p>;
  if (!saved || !form) return null;

  const set = (key, patch) => setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  const problems = [
    problemOf("pf", form.pf.code),
    problemOf("esi", form.esi.code),
    problemOf("tds", form.tds.tan),
    ...form.pt.registrations.map((r) => problemOf("pt", r.registrationNumber)),
  ].filter(Boolean);

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveStatutoryRegistrations({
        pf: { applies: form.pf.applies, code: form.pf.code || null, contributeOnFullWage: form.pf.contributeOnFullWage },
        esi: { applies: form.esi.applies, code: form.esi.code || null },
        pt: { applies: form.pt.applies, registrations: form.pt.registrations.map((r) => ({ state: r.state, registrationNumber: r.registrationNumber || null })) },
        tds: {
          applies: form.tds.applies,
          tan: form.tds.tan || null,
          deductorType: form.tds.deductorType || null,
          responsibleName: form.tds.responsibleName || null,
          responsibleDesignation: form.tds.responsibleDesignation || null,
        },
      });
      fill(next);
      /* Back to the one-line summary; Review reopens it. */
      setOpen(false);
      notify.success(next.missing.length ? `Saved. Still to add: ${next.missing.map((m) => m.short).join(", ")}.` : "Statutory registrations saved.");
      if (onSaved) onSaved();
    } catch (e) {
      notify.error(String(e?.message || "Could not save the registrations."));
    } finally {
      setSaving(false);
    }
  };

  const summary = saved.answeredAt
    ? saved.missing.length
      ? `Still to add: ${saved.missing.map((m) => m.short).join(", ")}.`
      : [saved.pf.applies && "PF", saved.esi.applies && "ESI", saved.pt.applies && "professional tax", saved.tds.applies && "income tax"].filter(Boolean).join(", ") + " registered."
    : "Not entered yet.";

  return (
    <section id="statutory-registrations" className="space-y-3 ui-touch-44" aria-labelledby="statutory-registrations-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="statutory-registrations-title" className="ui-t-sec">Statutory registrations</h2>
          <p className="ui-caption max-w-[65ch]">
            The numbers each return is filed under. Payroll can run without them, but the PF ECR, the ESI return, a state's professional tax return and Form 24Q cannot be made until they are here.
          </p>
        </div>
        {!open ? (
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setOpen(true); setSkipped(false); }}>
            {saved.answeredAt ? "Review" : "Enter them"}
          </button>
        ) : null}
      </div>

      {!open ? (
        <p className="ui-caption" role="status">
          {skipped ? "Skipped. You can add this later in Settings › Statutory › Compliance." : summary}
        </p>
      ) : (
        <div className="space-y-6">
          {/* Provident fund */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Provident fund</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="ui-checkbox mt-0.5" checked={form.pf.applies} onChange={(e) => set("pf", { applies: e.target.checked })} />
              <span>
                PF applies to this company
                <span className="ui-caption block max-w-[65ch]">Compulsory from 20 people; a smaller company may join of its own choice.</span>
              </span>
            </label>
            <Field label="PF establishment code" scheme="pf" value={form.pf.code} onChange={(code) => set("pf", { code })} placeholder="KNBNG0012345000" where={WHERE.pf} />
            <fieldset className="space-y-1">
              <legend className="ui-label">Contributions are worked out on</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="pf-ceiling" className="ui-radio mt-0.5" checked={!form.pf.contributeOnFullWage} onChange={() => set("pf", { contributeOnFullWage: false })} />
                <span>
                  PF wages up to {rupees(saved.pf.wageCeiling || 15000)} a month
                  <span className="ui-caption block max-w-[65ch]">The usual choice. Above the ceiling the contribution stops growing, so somebody on ₹60,000 and somebody on ₹1,50,000 both contribute ₹1,800.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="pf-ceiling" className="ui-radio mt-0.5" checked={form.pf.contributeOnFullWage} onChange={() => set("pf", { contributeOnFullWage: true })} />
                <span>
                  The full PF wage
                  <span className="ui-caption block max-w-[65ch]">Both shares follow the whole wage. Changing this later starts a new PF rate from that day; payslips already made keep theirs.</span>
                </span>
              </label>
            </fieldset>
          </fieldset>

          {/* ESI */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Employee State Insurance</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="ui-checkbox mt-0.5" checked={form.esi.applies} onChange={(e) => set("esi", { applies: e.target.checked })} />
              <span>
                ESI applies to this company
                <span className="ui-caption block max-w-[65ch]">
                  Compulsory from 10 people in a notified area. It covers anybody earning up to {rupees(saved.esi.eligibilityThreshold || 21000)} a month; that limit is set by law and is already in the rates.
                </span>
              </span>
            </label>
            <Field label="ESI employer code" scheme="esi" value={form.esi.code} onChange={(code) => set("esi", { code })} placeholder="31000123450001001" where={WHERE.esi} maxLength={20} />
          </fieldset>

          {/* Professional tax */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Professional tax</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="ui-checkbox mt-0.5" checked={form.pt.applies} onChange={(e) => set("pt", { applies: e.target.checked })} />
              <span>
                Professional tax applies to this company
                <span className="ui-caption block max-w-[65ch]">Levied by the state, so the company registers in each state it has people in.</span>
              </span>
            </label>
            <PtRegistrationFields value={form.pt.registrations} onChange={(registrations) => set("pt", { registrations })} levyStates={saved.pt.levyStates} />
          </fieldset>

          {/* Income tax */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Income tax on salaries (TDS)</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="ui-checkbox mt-0.5" checked={form.tds.applies} onChange={(e) => set("tds", { applies: e.target.checked })} />
              <span>
                Tax is deducted from salaries here
                <span className="ui-caption block max-w-[65ch]">Every employer paying a salary above the tax-free limit deducts it and files Form 24Q each quarter.</span>
              </span>
            </label>
            <Field label="TAN" scheme="tds" value={form.tds.tan} onChange={(tan) => set("tds", { tan })} placeholder="BLRA12345B" where={WHERE.tan} maxLength={12} />
            <div className="max-w-[22rem]">
              <label className="block">
                <span className="ui-label">Kind of deductor</span>
                <select className="ui-select w-full" value={form.tds.deductorType} onChange={(e) => set("tds", { deductorType: e.target.value })}>
                  <option value="">Choose one</option>
                  {(saved.deductorTypes || []).map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="ui-caption block max-w-[65ch]">As Form 24Q asks for it.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[46rem]">
              <label className="block">
                <span className="ui-label">Person responsible for deducting tax</span>
                <SuggestInput value={form.tds.responsibleName} onChange={(responsibleName) => set("tds", { responsibleName })} maxLength={120} placeholder="Name" suggestions={[]} />
              </label>
              <label className="block">
                <span className="ui-label">Their designation</span>
                <SuggestInput value={form.tds.responsibleDesignation} onChange={(responsibleDesignation) => set("tds", { responsibleDesignation })} maxLength={80} placeholder="e.g. Director" suggestions={[]} />
              </label>
            </div>
            <p className="ui-caption max-w-[65ch]">{WHERE.responsible}</p>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" disabled={saving || problems.length > 0} onClick={save}>
              {saving ? "Saving…" : "Save registrations"}
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-ghost"
              disabled={saving}
              onClick={() => {
                setSkipped(true);
                setOpen(false);
                fill(saved);
              }}
            >
              Skip for now
            </button>
            <span className="ui-caption">You can add this later in Settings › Statutory › Compliance.</span>
          </div>
        </div>
      )}
    </section>
  );
}

const warnStyle = { background: "rgb(var(--warn-soft))", color: "rgb(var(--warn-ink))" };

/**
 * The pay run screen's line: which returns cannot be filed yet, in the
 * server's words, and the way to the step. Nothing when every number is in.
 */
export function RegistrationNotice({ gaps }) {
  if (!Array.isArray(gaps) || !gaps.length) return null;
  return (
    <section className="ui-card p-3 text-sm flex flex-wrap items-start justify-between gap-3" role="status" style={warnStyle} aria-label="Registrations still to add">
      <div className="flex items-start gap-2 min-w-0 max-w-3xl">
        <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <ul className="space-y-0.5">
          {gaps.map((g) => (
            <li key={`${g.scheme}-${g.state || ""}`}>{g.message}</li>
          ))}
        </ul>
      </div>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => requestOpenScreen("setup", { step: "registrations" })}>
        Add it in Setup
      </button>
    </section>
  );
}
