import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Check } from "@ui/components/ui/lineIcons";
import { rupees as money } from "@ui/utils/money";
import { getSalaryStructure, previewSalaryStructure } from "../api/payrollStructures";
import { errorWords } from "@ui/utils/errorWords";

/*
 * Round 59 picks (18 Nov 2026), Payroll side.
 *
 * lockexplain A: before a month is locked, what locking does in plain words.
 * monthflow C: the month's payroll as a short to-do list on Payroll's home.
 * ctcsplit A: one yearly CTC in, the structure's parts and the net pay out.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The month after a period's last day ("2026-10-31" gives "November"). */
export function nextMonthName(endDate) {
  const m = /^(\d{4})-(\d{2})/.exec(String(endDate || ""));
  if (!m) return "";
  return MONTHS[Number(m[2]) % 12];
}

/** The words the lock confirmation shows. */
export function lockWords(run) {
  const name = run?.period?.name || "this month";
  const next = nextMonthName(run?.period?.endDate);
  const people = Number(run?.employeeCount || 0);
  /* The amount and the head count being made final, named in the question (design audit, Batch 1). */
  const what = run?.netTotal != null ? `${money(run.netTotal)} net pay to ${people} ${people === 1 ? "person" : "people"}. ` : "";
  return {
    title: `Lock ${name}?`,
    message:
      `${what}After locking, nobody can change this pay run and its payslips are final. ` +
      `A mistake found later is put right in ${next ? `${next}'s` : "next month's"} payroll as an adjustment.`,
    confirmLabel: "Lock pay run",
  };
}

/* The run's order of statuses, so "done" is anything the run has passed. */
const ORDER = ["DRAFT", "CALCULATED", "REVIEW", "APPROVED", "LOCKED", "PAID", "POSTED"];

export const MONTH_STEPS = [
  { key: "start", label: "Start this month's payroll", doneAt: "DRAFT" },
  { key: "calc", label: "Check days and calculate", doneAt: "CALCULATED" },
  { key: "approve", label: "Review and approve", doneAt: "APPROVED" },
  { key: "lock", label: "Lock the month", doneAt: "LOCKED" },
  { key: "pay", label: "Pay staff", doneAt: "PAID" },
  { key: "post", label: "Post to accounts", doneAt: "POSTED" },
];

/** Each step with whether it is done, for a run's status (no run: nothing done). */
export function monthSteps(status) {
  const at = status ? ORDER.indexOf(status) : -1;
  return MONTH_STEPS.map((s) => ({ ...s, done: at >= 0 && at >= ORDER.indexOf(s.doneAt) }));
}

export function MonthTodo({ period, run, onOpen }) {
  if (!period || run?.status === "CANCELLED") return null;
  const steps = monthSteps(run?.status);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <section className="ui-month-todo" aria-labelledby="month-todo-h">
      <header className="ui-month-todo-head">
        <h2 id="month-todo-h" className="ui-sec-head">{period.name} to-do</h2>
        <span className="ui-caption tabular-nums">{done} of {steps.length} done</span>
      </header>
      <ol className="ui-month-todo-list">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? "is-done" : s === next ? "is-next" : undefined}>
            <span className="ui-month-todo-mark" aria-hidden="true">{s.done ? <Check size={14} /> : null}</span>
            {s === next && onOpen ? (
              <button type="button" className="ui-link" onClick={() => onOpen("runs", run?.id ? { runId: run.id } : { startPeriod: period.id })}>
                {s.label} <ArrowRight size={14} aria-hidden="true" className="inline" />
              </button>
            ) : (
              <span>{s.label}{s.done ? <span className="sr-only"> (done)</span> : null}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* A structure's lines in the shape the preview takes. */
const toLine = (c, i) => ({
  componentId: c.componentId,
  calculationMethod: c.calculationMethod ?? null,
  amount: c.amount == null ? null : Number(c.amount),
  percentage: c.percentage == null ? null : Number(c.percentage),
  formula: c.formula ?? null,
  calculationBase: c.calculationBase ?? null,
  isBalancing: Boolean(c.isBalancing),
  displayOrder: c.displayOrder ?? i + 1,
});

/** What a yearly CTC pays a month on a structure: earnings first, then gross and net. */
export function splitLines(preview) {
  if (!preview) return null;
  const earnings = (preview.lines || []).filter((l) => l.type === "EARNING" && Number(l.amount) > 0);
  return { earnings, gross: Number(preview.grossEarnings || 0), net: Number(preview.netPay || 0) };
}

/**
 * The parts one yearly CTC makes on the chosen structure, worked out by the
 * same engine a payroll run uses. Shown under the CTC field as it is typed.
 */
export function CtcSplit({ structureId, annualCtc }) {
  const [state, setState] = useState({ split: null, error: "" });
  const cache = useRef(new Map());
  const seq = useRef(0);
  const ctc = Number(annualCtc) || 0;
  useEffect(() => {
    if (!structureId || ctc <= 0) return undefined;
    const mine = (seq.current += 1);
    const t = setTimeout(async () => {
      try {
        let s = cache.current.get(structureId);
        if (!s) {
          s = await getSalaryStructure(structureId);
          cache.current.set(structureId, s);
        }
        const p = await previewSalaryStructure({ components: (s?.components || []).map(toLine), frequency: s?.frequency || "MONTHLY", annualCtc: ctc });
        if (seq.current === mine) setState({ split: splitLines(p), error: "", key: `${structureId}:${ctc}` });
      } catch (e) {
        if (seq.current === mine) setState({ split: null, error: errorWords(e, "split the salary into its parts"), key: `${structureId}:${ctc}` });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [structureId, ctc]);

  if (!structureId || ctc <= 0) return null;
  const current = state.key === `${structureId}:${ctc}`;
  if (current && state.error) return <p className="ui-caption">{state.error}</p>;
  if (!current || !state.split) return <p className="ui-caption">Working out the parts…</p>;
  const { earnings, gross, net } = state.split;
  return (
    <div className="ui-ctc-split" aria-label="Each month" role="group">
      <p className="ui-caption">Each month on this structure</p>
      <dl>
        {earnings.map((l) => (
          <div key={l.componentId || l.code}><dt>{l.name}</dt><dd className="tabular-nums">{money(l.amount)}</dd></div>
        ))}
        <div className="is-sum"><dt>Gross</dt><dd className="tabular-nums">{money(gross)}</dd></div>
        <div className="is-net"><dt>Net pay</dt><dd className="tabular-nums">{money(net)}</dd></div>
      </dl>
    </div>
  );
}
