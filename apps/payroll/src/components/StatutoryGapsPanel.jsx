import React, { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

import { notify } from "@ui/components/ui/notify";
import SuggestInput from "@ui/components/ui/SuggestInput";
import { requestOpenScreen } from "@platform/context";
import { recordStatutoryWaiver } from "../api/payrollRuns";

const warnStyle = { background: "rgb(var(--warn-soft))", color: "rgb(var(--warn-ink))" };
const infoStyle = { background: "rgb(var(--info-soft))", color: "rgb(var(--info))" };

const list = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "");

/** "Meera Shetty, Kiran Gowda and 3 others" */
const who = (people) => {
  const names = people.map((p) => p.name);
  return names.length > 3 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} others` : list(names);
};

/** Examples of why the law does not reach a company, by scheme. */
const REASON_HINT = {
  PF: "e.g. 12 people, under the PF threshold of 20",
  ESI: "e.g. 7 people, under the ESI threshold of 10",
  LWF: "e.g. under the state's LWF headcount",
};

/**
 * Statutory lines on these payslips that nothing worked out: a PF, ESI, PT,
 * LWF or TDS component whose scheme is switched off or has no rate (audit
 * 7 Nov 2026, #3). The payroll is not approved until they are set up, or, for
 * PF, ESI and LWF only, an owner or administrator records why the law does not reach the
 * company. Calculating again asks again.
 */
export default function StatutoryGapsPanel({ run, gaps, canWaive, onSaved }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  if (!gaps?.length || !["CALCULATED", "REVIEW"].includes(run?.status)) return null;

  const waiver = run.statutoryWaiver;
  const waived = (g) => g.mayStandWithout && waiver?.schemes?.includes(g.scheme);
  const open = gaps.filter((g) => !waived(g));
  const done = gaps.filter(waived);
  const waivable = open.length > 0 && open.every((g) => g.mayStandWithout);
  const why = reason.trim();

  const save = async () => {
    setSaving(true);
    try {
      await recordStatutoryWaiver(run.id, open.map((g) => g.scheme), why);
      notify.success("Recorded. The payroll can now be approved.");
      /* Keep the words on screen until the run reloads into its recorded state. */
      if (onSaved) await onSaved();
      setReason("");
    } catch (e) {
      notify.error(String(e?.message || "Could not record it."));
    } finally {
      setSaving(false);
    }
  };

  if (!open.length) {
    return (
      <section className="ui-card p-3 text-sm flex items-start gap-2" style={infoStyle} aria-labelledby="stat-gaps-h">
        <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h3 id="stat-gaps-h" className="font-medium">
            {list(done.map((g) => g.name))} recorded as not applying to this company
          </h3>
          <p>{waiver.reason}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ui-card p-3 space-y-2 text-sm" style={warnStyle} aria-labelledby="stat-gaps-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 max-w-3xl">
          <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <div className="min-w-0 space-y-1">
            <h3 id="stat-gaps-h" className="font-medium">Not ready to approve</h3>
            <ul className="space-y-0.5">
              {open.map((g) => (
                <li key={g.scheme}>
                  {g.reason === "OFF"
                    ? `${g.name} is switched off, so it shows as nil for ${who(g.people)}. Switch it on in Compliance.`
                    : `${g.name} is switched on, but no rate covers this pay month${["PT", "LWF"].includes(g.scheme) ? " in the state they work in" : ""}, so it shows as nil for ${who(g.people)}. Add this month's rate in Compliance.`}
                </li>
              ))}
            </ul>
            <p>
              Then calculate again.
              {waivable ? " If the law does not reach your company, an owner or administrator can record why instead." : ""}
            </p>
          </div>
        </div>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => requestOpenScreen("compliance")}>
          Open Compliance
        </button>
      </div>
      {waivable && canWaive ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[14rem] flex-1">
            <span className="ui-label">Why {list(open.map((g) => g.scheme))} {open.length === 1 ? "does" : "do"} not apply</span>
            <SuggestInput value={reason} onChange={setReason} maxLength={300} placeholder={REASON_HINT[open[0].scheme] || "Why it does not apply"} suggestions={[]} />
          </label>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={saving || why.length < 5} onClick={save}>
            {saving ? "Saving…" : "Record it does not apply"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
