import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { notify } from "@ui/components/ui/notify";
import { getRunLopCheck, lockPayrollRun } from "../api/payrollRuns";
import { provisionalWarning } from "./runGuardText";

/**
 * Two things the run review says before a payroll is locked (closure audit
 * O-04, O-06). The server decides both; this only shows what it answered.
 *
 * - Days taken from an Attendance month that is still open can change after
 *   the pull. Said plainly, in the words the server uses.
 * - Loss of pay where approved leave, the day records and this run disagree,
 *   person by person with all three figures. Locking waits until that is
 *   corrected, or until somebody acknowledges it with a reason.
 */

const warnStyle = { background: "rgb(var(--warn-soft))", color: "rgb(var(--warn-ink))" };

/** A plain warning above the days. Nothing when every month was closed. */
export function ProvisionalNotice({ openMonths }) {
  const text = provisionalWarning(openMonths);
  if (!text) return null;
  return (
    <div className="ui-card p-3 text-sm flex items-start gap-2" role="status" style={warnStyle}>
      <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

const days = (n) => (n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const SOURCE = { ATTENDANCE: "From Attendance", LEAVE: "From leave", MANUAL: "Typed" };

/**
 * The loss-of-pay cross-check for one run. `refreshKey` reloads it when the
 * run changes; `onLocked` is called after a lock with a reason.
 */
export function LopCheckPanel({ runId, run, refreshKey, onLocked }) {
  const [check, setCheck] = useState(null);
  const [failed, setFailed] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [locking, setLocking] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailed("");
      setCheck(await getRunLopCheck(runId));
    } catch (e) {
      setFailed(String(e?.message || "Could not check loss of pay."));
    }
  }, [runId]);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (failed) return <p className="ui-caption" role="alert">{failed}</p>;
  if (!check) return null;

  const mismatches = check.mismatches || [];
  const canLock = run?.status === "APPROVED";
  const reasonOk = reason.trim().length >= 5;

  const lockWithReason = async () => {
    setLocking(true);
    try {
      await lockPayrollRun(runId, { acknowledge: true, reason: reason.trim() });
      notify.success("Payroll locked. The reason is in the audit log.");
      if (onLocked) onLocked();
    } catch (e) {
      notify.error(String(e?.message || "Could not lock this payroll."));
      load();
    } finally {
      setLocking(false);
    }
  };

  return (
    <section className="space-y-3" aria-label="Loss of pay check">
      {check.snapshotChanged ? (
        <div className="ui-card p-3 text-sm flex items-start gap-2" role="alert" style={warnStyle}>
          <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{check.snapshotChanged.message}</span>
        </div>
      ) : null}
      <ProvisionalNotice openMonths={check.openMonths || []} />

      {!mismatches.length ? (
        <p className="ui-caption">
          Loss of pay agrees for all {check.checked} {check.checked === 1 ? "person" : "people"}: approved unpaid leave, the days and this payroll.
        </p>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <span className="ui-pill ui-pill-warn">
              <AlertTriangle size={12} aria-hidden="true" /> {mismatches.length} to check
            </span>
            <p className="ui-caption max-w-[70ch]">
              Loss of pay does not agree for {mismatches.length} {mismatches.length === 1 ? "person" : "people"}. Correct the leave, the days or this payroll, or lock with a reason.
            </p>
          </div>
          <div className="ui-card overflow-hidden">
            <div className="ui-table-scroll">
              <table className="ui-table w-full">
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col" className="ui-col-h-right">Unpaid leave approved</th>
                    <th scope="col" className="ui-col-h-right">Loss of pay on the days</th>
                    <th scope="col" className="ui-col-h-right">Loss of pay on this payroll</th>
                    <th scope="col">What differs</th>
                  </tr>
                </thead>
                <tbody className="ui-rows">
                  {mismatches.map((m) => (
                    <tr key={m.employeeId}>
                      <td className="ui-col-entity">
                        {m.name || "Unknown"}
                        {m.code ? <span className="ui-caption block">{m.code}</span> : null}
                      </td>
                      <td className="ui-col-amount ui-num">{days(m.leaveDays)}</td>
                      <td className="ui-col-amount ui-num">{days(m.recordsLossOfPay)}</td>
                      <td className="ui-col-amount ui-num">
                        {days(m.inputLwpDays)}
                        {m.inputSource ? <span className="ui-caption block">{SOURCE[m.inputSource] || m.inputSource}</span> : null}
                      </td>
                      <td className="text-sm">{(m.problems || []).join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {canLock ? (
            <div className="space-y-3 max-w-2xl">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="ui-checkbox mt-0.5"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>I have seen these differences and want to lock this payroll as it is.</span>
              </label>
              {acknowledged ? (
                <>
                  <label className="block">
                    <span className="ui-label">Why</span>
                    <input
                      type="text"
                      className="ui-input w-full"
                      maxLength={300}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="For example: corrected in next month’s payroll"
                    />
                    <span className="ui-caption block">At least 5 characters. It goes in the audit log with the differences.</span>
                  </label>
                  <div className="flex justify-end">
                    <button type="button" className="ui-btn ui-btn-secondary" disabled={!reasonOk || locking} onClick={lockWithReason}>
                      {locking ? "Locking…" : "Lock with this reason"}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
