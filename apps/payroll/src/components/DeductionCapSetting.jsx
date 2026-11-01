import React, { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

import { notify } from "@ui/components/ui/notify";
import SuggestInput from "@ui/components/ui/SuggestInput";
import { getDeductionCap, saveDeductionCap } from "../api/payrollSetup";
import { recordOverLimitReason } from "../api/payrollRuns";
import { rupees as inr } from "@ui/utils/money";

/**
 * How much of a payslip's wages deductions may take. Half is the law's limit;
 * a company may hold them lower. Whether PF, ESI, professional tax and income
 * tax count toward it is read differently, so it is the company's to set.
 */
export function DeductionCapSetting() {
  const [saved, setSaved] = useState(null);
  const [percent, setPercent] = useState("50");
  const [countsStatutory, setCountsStatutory] = useState(true);
  const [countsPenalties, setCountsPenalties] = useState(true);
  const [failed, setFailed] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDeductionCap()
      .then((s) => {
        setSaved(s);
        setPercent(String(s.percent));
        setCountsStatutory(Boolean(s.countsStatutory));
        setCountsPenalties(s.countsPenalties !== false);
      })
      .catch((e) => setFailed(String(e?.message || "Could not read this setting.")));
  }, []);

  if (failed) return <p className="ui-caption" role="alert">{failed}</p>;
  if (!saved) return null;

  const share = Number(percent);
  const shareOk = Number.isInteger(share) && share >= 10 && share <= 50;
  const dirty = (shareOk && share !== saved.percent) || countsStatutory !== Boolean(saved.countsStatutory) || countsPenalties !== (saved.countsPenalties !== false);

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveDeductionCap({ percent: share, countsStatutory, countsPenalties });
      setSaved(next);
      setPercent(String(next.percent));
      setCountsStatutory(Boolean(next.countsStatutory));
      setCountsPenalties(next.countsPenalties !== false);
      notify.success(`Deductions held to ${next.percent}% of wages.`);
    } catch (e) {
      notify.error(String(e?.message || "Could not save this setting."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 ui-touch-44" aria-labelledby="deduction-cap-title">
      <div>
        <h2 id="deduction-cap-title" className="ui-t-sec">Most that can come off wages</h2>
        <p className="ui-caption max-w-[65ch]">
          Total deductions in a pay period may not pass half of the wages for it (Code on Wages 2019, s.18(3)). Anything over that carries to later months (s.18(4)). When a payslip reaches this, loan and advance instalments move to next month and the payslip says so.
        </p>
      </div>
      <label className="block max-w-[12rem]">
        <span className="ui-label">Share of wages, in %</span>
        <input
          type="number"
          inputMode="numeric"
          min={10}
          max={50}
          className="ui-input w-full"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          aria-invalid={!shareOk}
        />
        <span className="ui-caption block">{shareOk ? "50% is the most the law allows." : "A whole number from 10 to 50."}</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="ui-checkbox mt-0.5" checked={countsStatutory} onChange={(e) => setCountsStatutory(e.target.checked)} />
        <span>
          Count PF, ESI, professional tax and income tax toward the limit
          <span className="ui-caption block max-w-[65ch]">
            The Code lists them among deductions, so counting them is the careful reading and the default. Some employers read the limit as applying only to what the employer chooses to recover. If you switch this off, check with your adviser.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="ui-checkbox mt-0.5" checked={countsPenalties} onChange={(e) => setCountsPenalties(e.target.checked)} />
        <span>
          Count late-mark penalties toward the limit
          <span className="ui-caption block max-w-[65ch]">
            A late-mark cut can only match the time actually missed (Code on Wages 2019, s.20). A bigger cut counts as a fine, which needs an approved notice and is limited to 3% of wages (s.19).
          </span>
        </span>
      </label>
      <div>
        <button type="button" className="ui-btn ui-btn-secondary" disabled={!dirty || !shareOk || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

const infoStyle = { background: "rgb(var(--info-soft))", color: "rgb(var(--info))" };

/** The run screen's line, in the server's words. Nothing when no deduction was held back. */
export function DeductionCapNotice({ run }) {
  const text = run?.deductionCapMessage;
  if (!text) return null;
  return (
    <div className="ui-card p-3 text-sm flex items-start gap-2" role="status" style={infoStyle}>
      <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

const warnStyle = { background: "rgb(var(--warn-soft))", color: "rgb(var(--warn-ink))" };

/**
 * Entered deductions past the share of wages, from the last calculation.
 * Nothing on the payslips was changed: the payroll waits until they are
 * reduced (and calculated again) or somebody records why they stand.
 */
export function OverLimitPanel({ run, onSaved }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const over = run?.overLimit;
  if (!over?.people?.length) return null;
  const open = ["CALCULATED", "REVIEW"].includes(run.status);
  const why = reason.trim();
  const save = async () => {
    setSaving(true);
    try {
      await recordOverLimitReason(run.id, why);
      notify.success("Reason recorded.");
      setReason("");
      if (onSaved) await onSaved();
    } catch (e) {
      notify.error(String(e?.message || "Could not record the reason."));
    } finally {
      setSaving(false);
    }
  };
  const percent = over.people[0].percent;
  return (
    <section className="ui-card p-3 space-y-2 text-sm" aria-labelledby="over-limit-h" style={over.reason ? infoStyle : warnStyle}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <h3 id="over-limit-h" className="font-medium">
            Deductions pass {percent}% of wages for {over.people.length} {over.people.length === 1 ? "person" : "people"}
          </h3>
          <ul className="space-y-0.5">
            {over.people.map((p) => (
              <li key={p.employeeId} className="flex flex-wrap justify-between gap-x-4">
                <span>{p.name}</span>
                <span className="ui-num tabular-nums text-right">{inr(p.counted)} of {inr(p.limit)} allowed</span>
              </li>
            ))}
          </ul>
          {over.reason ? (
            <p>Recorded why they stand: {over.reason}</p>
          ) : (
            <p>Nothing was changed on the payslips. Reduce these deductions and calculate again, or record why they stand before sending for review.</p>
          )}
        </div>
      </div>
      {!over.reason && open ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[14rem] flex-1">
            <span className="ui-label">Why do they stand?</span>
            <SuggestInput value={reason} onChange={setReason} maxLength={300} placeholder="e.g. Signed damage agreement, 12 Jun" suggestions={[]} />
          </label>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={saving || why.length < 5} onClick={save}>
            {saving ? "Saving…" : "Record reason"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
