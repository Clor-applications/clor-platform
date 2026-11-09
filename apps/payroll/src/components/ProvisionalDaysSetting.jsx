import React, { useEffect, useState } from "react";
import { Info } from '@ui/components/ui/lineIcons';

import { notify } from "@ui/components/ui/notify";
import { getProvisionalDays, saveProvisionalDays } from "../api/payrollSetup";

/** 1st, 2nd, 3rd, 25th: the same words the server uses on the run screen. */
const ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
};

/**
 * Paying before the month ends (closure audit O-11). A company that runs
 * payroll on the 25th does not know the rest of the month yet: with this on,
 * the days after the cut-off are counted as present, and next month's
 * payroll corrects any that turned out absent. Off by default; the server
 * refuses it without Attendance, and this says so before anyone tries.
 */
export function ProvisionalDaysSetting() {
  const [saved, setSaved] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [cutoffDay, setCutoffDay] = useState("25");
  const [failed, setFailed] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProvisionalDays()
      .then((s) => {
        setSaved(s);
        setEnabled(Boolean(s.enabled));
        setCutoffDay(String(s.cutoffDay ?? 25));
      })
      .catch((e) => setFailed(String(e?.message || "Could not read this setting.")));
  }, []);

  if (failed) return <p className="ui-caption" role="alert">{failed}</p>;
  if (!saved) return null;

  const day = Number(cutoffDay);
  const dayOk = Number.isInteger(day) && day >= 1 && day <= 30;
  const dirty = enabled !== Boolean(saved.enabled) || (dayOk && day !== saved.cutoffDay);

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveProvisionalDays({ enabled, cutoffDay: day });
      setSaved(next);
      setEnabled(Boolean(next.enabled));
      setCutoffDay(String(next.cutoffDay));
      notify.success(next.enabled ? `Days after the ${ordinal(day)} are counted as present, and corrected next month.` : "Payroll counts only the days that have happened.");
    } catch (e) {
      notify.error(String(e?.message || "Could not save this setting."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="provisional-days-title">
      <div>
        <h2 id="provisional-days-title" className="ui-t-sec">Paying before the month ends</h2>
        <p className="ui-caption max-w-[65ch]">
          For a company that runs payroll before the month is over. The days after the cut-off are counted as present for everyone not on approved leave; unpaid leave already approved still costs pay. Next month’s payroll compares each of those days with what happened and adds a correction to the payslip.
        </p>
      </div>
      {!saved.attendance ? (
        <p className="ui-caption flex items-start gap-2" role="status">
          <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>Needs Attendance: the days after the cut-off are counted and corrected from it.</span>
        </p>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={enabled}
          disabled={!saved.attendance && !saved.enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>Count the days after the cut-off as present</span>
      </label>
      <label className="block max-w-[12rem]">
        <span className="ui-label">Cut-off day of the month</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          className="ui-input w-full"
          value={cutoffDay}
          disabled={!enabled}
          onChange={(e) => setCutoffDay(e.target.value)}
          aria-invalid={!dayOk}
        />
        <span className="ui-caption block">{dayOk ? `Attendance is read up to the ${ordinal(day)}; the rest of the month is counted as present.` : "A day from 1 to 30."}</span>
      </label>
      <div>
        <button type="button" className="ui-btn ui-btn-secondary" disabled={!dirty || !dayOk || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

const infoStyle = { background: "rgb(var(--info-soft))", color: "rgb(var(--info))" };

/**
 * The run screen's line: "Days after the 25th counted as present: 3 people,
 * 12 days; corrected next month." The sentence is the server's, from what the
 * run stored at the pull. Nothing when no day was assumed.
 */
export function ProvisionalDaysNotice({ run }) {
  const text = run?.provisionalMessage;
  if (!text) return null;
  return (
    <div className="ui-card p-3 text-sm flex items-start gap-2" role="status" style={infoStyle}>
      <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
