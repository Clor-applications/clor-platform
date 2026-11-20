import React from "react";
import { wholeRupees as money } from "@ui/utils/money";

/*
 * Round 32 picks (Payroll).
 *
 * payvariance A: before approving, the people whose take-home moved from last
 * period, each with the reason this month's inputs give for it.
 * payrecon C: once payroll is approved, one answer on the run: how many of the
 * payslips the bank has paid.
 */

/** What this month's inputs say about a change in take-home. */
export function payChangeReason(slip, input) {
  if (slip.previousNetPay == null) return "First payslip";
  const parts = [];
  const lwp = Number(input?.lwpDays) || 0;
  if (lwp > 0) parts.push(`${lwp} day${lwp === 1 ? "" : "s"} unpaid`);
  const overtime = Number(input?.overtimeAmount) || 0;
  if (overtime > 0) parts.push(`Overtime ${money(overtime)}`);
  const variable = Number(input?.variablePay) || 0;
  if (variable > 0) parts.push(`Variable pay ${money(variable)}`);
  const ahead = Number(input?.provisionalDays) || 0;
  if (ahead > 0) parts.push(`${ahead} day${ahead === 1 ? "" : "s"} paid ahead`);
  return parts.length ? parts.join(" · ") : "Salary or deductions changed";
}

/** The slips whose take-home differs from last period, biggest move first. */
export function payChanges(slips) {
  return (slips || [])
    .filter((s) => s.previousNetPay == null || Math.round(s.netPay) !== Math.round(s.previousNetPay))
    .map((s) => ({ slip: s, change: s.previousNetPay == null ? null : s.netPay - s.previousNetPay }))
    .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
}

export function PayChanges({ slips, byEmployee }) {
  const rows = payChanges(slips);
  if (!rows.length) {
    return <p className="ui-caption">Everyone is paid the same as last period.</p>;
  }
  return (
    <section className="ui-pay-changes" aria-label="Paid differently from last period">
      <h3 className="ui-sec-head">
        Paid differently from last period · {rows.length} {rows.length === 1 ? "person" : "people"}
      </h3>
      <ul>
        {rows.map(({ slip, change }) => {
          const entry = byEmployee?.get(slip.employeeId);
          return (
            <li key={slip.id}>
              <span className="ui-pay-changes-name">{entry?.employee?.name || "Name missing"}</span>
              <span className="ui-pay-changes-amt tabular-nums">
                {change == null ? money(slip.netPay) : `${change > 0 ? "+" : "−"}${money(Math.abs(change))}`}
              </span>
              <span className="ui-pay-changes-why">{payChangeReason(slip, entry?.input)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** How many payslips the bank has paid, and how many came back. */
export function paidCount(slips) {
  const list = slips || [];
  return {
    total: list.length,
    paid: list.filter((s) => s.paymentStatus === "PAID").length,
    failed: list.filter((s) => s.paymentStatus === "FAILED").length,
  };
}

const PAYING = ["APPROVED", "LOCKED", "PAID", "POSTED"];

export function PaidCount({ slips, status }) {
  if (!PAYING.includes(status)) return null;
  const { total, paid, failed } = paidCount(slips);
  if (!total) return null;
  let text;
  let tone;
  if (paid === total) {
    text = `All ${total} paid`;
    tone = "ui-pill-pos";
  } else if (paid === 0 && failed === 0) {
    text = "Not paid yet";
    tone = "ui-pill-neutral";
  } else {
    text = `${paid} of ${total} paid`;
    tone = "ui-pill-warn";
  }
  return (
    <p className="flex flex-wrap items-center gap-2" role="status">
      <span className={`ui-pill ${tone}`}>{text}</span>
      {failed ? <span className="ui-pill ui-pill-neg">{failed} came back from the bank</span> : null}
    </p>
  );
}
