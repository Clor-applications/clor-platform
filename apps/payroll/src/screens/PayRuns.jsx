import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExceptionTag } from '@ui/components/ui/ExceptionTag';
import { AlertTriangle, ArrowLeft, CalendarClock, Check, Info, Play } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from "@ui/components/ColumnFilters";
import { useListSearch } from "@ui/components/ListToolbar";
import DocumentListShell from "@ui/components/list/DocumentListShell";
import { exportFormatFromKey, exportMenuItem, runListExport } from "@ui/components/list/exportMenu";
import {
  PageHeader,
  SkeletonCard,
  EmptyState,
} from "@ui/components/ui/Primitives";
import { confirmDialog, notify } from "@ui/components/ui/notify";
import { hasApp, requestOpenScreen } from "@platform/context";
import { listPayrollPeriods, listPayGroups } from "../api/payrollCalendar";
import {
  listPayrollRuns,
  getPayrollRun,
  createPayrollRun,
  setRunEmployeeIncluded,
  saveRunInputs,
  takeDaysFromAttendance,
  takeDaysFromLeave,
  validatePayrollRun,
  calculatePayrollRun,
  submitRunForReview,
  approvePayrollRun,
  rejectPayrollRun,
  lockPayrollRun,
  payrollTallyXml,
  sendPayrollToTally,
  tallyConnectors,
  previewPayrollPosting,
  postPayrollRun,
} from "../api/payrollRuns";
import LoadFailed from "@ui/components/ui/LoadFailed";
import Drawer from "@ui/components/ui/Drawer";
import SuccessNote from "@ui/components/ui/SuccessNote";
import { LopCheckPanel, ProvisionalNotice } from "../components/RunGuards";
import { ProvisionalDaysNotice } from "../components/ProvisionalDaysSetting";
import { DeductionCapNotice, OverLimitPanel } from "../components/DeductionCapSetting";
import StatutoryGapsPanel from "../components/StatutoryGapsPanel";
import { RegistrationNotice } from "../components/StatutoryRegistrationsStep";
import { openMonthsOf } from "../components/runGuardText";
import { PaidCount, PayChanges } from "../components/round32";
import { lockWords } from "../components/round59";
import { wholeRupees as money } from "@ui/utils/money";
import { BANK_CUTOFF_NOTE, afterBankCutoff } from "@ui/picks/round54";
import { EarlierNote, NextMonthNote } from "../components/RunNotes";
import { HoldPayPanel, LatePayNote } from "../components/round66";
import ExtraPayStage from "../components/ExtraPayStage";
import { errorWords, monthText } from "@ui/utils/errorWords";
import { countItems } from "../components/countItems";
import { dateWords } from '@ui/utils/dates';
import { moneyCell } from '@ui/utils/money';

/**
 * Running payroll.
 *
 * The shape of the screen is the shape of the decision: who is being paid, for
 * how many days, what is wrong with that, and only then the money. Each stage
 * is a thing somebody chooses rather than a step a wizard walks them through,
 * so the stages stay visible and reachable instead of collapsing into one
 * button that produces payslips nobody picked.
 *
 * What the screen refuses to do is decide anything. Eligibility, validation,
 * the arithmetic and whether a status may change are all the server's, and the
 * screen shows what it is told — a second copy of "can this be approved" living
 * here is a copy that can disagree with the one that actually decides.
 */

const RUN_STEPS = ["DRAFT", "CALCULATED", "REVIEW", "APPROVED", "LOCKED"];

/** Where this payroll run stands, as steps across the top (owner's round 7 pick). */
function RunSteps({ status }) {
  const at = RUN_STEPS.indexOf(status === "PAID" || status === "POSTED" ? "LOCKED" : status);
  if (at < 0) return null;
  return (
    <ol className="ui-run-steps" aria-label="Pay run progress">
      {RUN_STEPS.map((s, i) => (
        <li
          key={s}
          className={i < at ? "is-done" : i === at ? "is-current" : undefined}
          aria-current={i === at ? "step" : undefined}
        >
          <span aria-hidden="true">{i < at ? "✓" : i + 1}</span>
          {STATUS_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

const STATUS_LABEL = {
  DRAFT: "Draft",
  CALCULATED: "Calculated",
  REVIEW: "In review",
  APPROVED: "Approved",
  LOCKED: "Locked",
  PAID: "Paid",
  POSTED: "Posted",
  CANCELLED: "Cancelled",
};



const TABS = [
  { value: "", label: "All", tone: "all" },
  { value: "OPEN", label: "In progress", tone: "outstanding" },
  { value: "APPROVED", label: "Approved", tone: "sent" },
  { value: "DONE", label: "Paid or posted", tone: "paid" },
  { value: "CANCELLED", label: "Cancelled", tone: "cancelled" },
];
/* One written title per tab: a title built from the tab label read "No pay runs paid or posted". */
const EMPTY_TITLES = {
  OPEN: "No pay runs in progress",
  APPROVED: "No approved pay runs waiting",
  DONE: "No pay runs paid or posted yet",
  CANCELLED: "No cancelled pay runs",
};
const inTabOf = (r, t) => {
  if (!t) return true;
  if (t === "OPEN") return ["DRAFT", "CALCULATED", "REVIEW"].includes(r.status);
  if (t === "APPROVED") return ["APPROVED", "LOCKED"].includes(r.status);
  if (t === "DONE") return ["PAID", "POSTED"].includes(r.status);
  return r.status === t;
};
const COLUMNS = {
  period: (r) => r.period?.name || "—",
  status: (r) => STATUS_LABEL[r.status] || r.status,
};
const EXPORT_COLUMNS = [
  { key: "number", label: "Pay run" },
  { key: "period", label: "Period", value: (r) => r.period?.name || "" },
  { key: "payrollDate", label: "Pay date" },
  { key: "employeeCount", label: "People" },
  { key: "grossTotal", label: "Gross", value: (r) => Number(r.grossTotal || 0) },
  { key: "netTotal", label: "Net pay", value: (r) => Number(r.netTotal || 0) },
  { key: "status", label: "Status", value: (r) => STATUS_LABEL[r.status] || r.status },
];

export default function PayRuns() {
  const [runs, setRuns] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [payGroups, setPayGroups] = useState([]);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState("");

  /* Periods refused or failed: the runs still list, and starting one waits (QA: one refused list failed the whole screen). */
  const [periodsFailed, setPeriodsFailed] = useState(false);

  const load = useCallback(() => {
    /* Each list on its own: the runs are the screen; periods and pay groups only feed "Run payroll". */
    listPayrollRuns()
      .then((runRows) => {
        setRuns(runRows);
        setError("");
      })
      .catch((e) => setError(errorWords(e, "load the pay runs")));
    listPayrollPeriods({ openOnly: true })
      .then((rows) => {
        setPeriods(rows);
        setPeriodsFailed(false);
      })
      .catch(() => {
        setPeriods([]);
        setPeriodsFailed(true);
      });
    /* No pay groups is a run for everyone, so a refused list costs nothing but the choice. */
    listPayGroups({ activeOnly: true })
      .then(setPayGroups)
      .catch(() => setPayGroups([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const start = async (payload) => {
    try {
      const made = await createPayrollRun(payload);
      notify.success(
        made.run.kind === "OFF_CYCLE"
          ? `${made.run.number} started. Add the people it is for and what to pay them.`
          : `${made.run.number} started with ${made.eligible} ${made.eligible === 1 ? "person" : "people"}.`,
      );
      setStarting(false);
      setOpenId(made.run.id);
      load();
    } catch (e) {
      notify.error(errorWords(e, "start that pay run"));
    }
  };

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.value, (runs || []).filter((r) => inTabOf(r, t.value)).length])),
    [runs],
  );
  const figures = useMemo(() => {
    const list = runs || [];
    const sum = (t) => list.filter((r) => inTabOf(r, t)).reduce((a, r) => a + Number(r.netTotal || 0), 0);
    return { open: sum("OPEN"), approved: sum("APPROVED"), done: sum("DONE") };
  }, [runs]);
  const inTab = useMemo(() => (runs || []).filter((r) => inTabOf(r, status)), [runs, status]);
  const search = useListSearch(inTab, ["number"]);
  const filters = useColumnFilters();
  const searched = useMemo(() => {
    const q = search.query.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter((r) => `${r.number} ${r.period?.name || ""}`.toLowerCase().includes(q));
  }, [inTab, search.query]);
  const rows = filters.applyFilters(searched, COLUMNS);

  if (openId) {
    return (
      <RunWorkflow
        runId={openId}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  const begin = () => setStarting(true);

  return (
    <div className="ui-touch-44">
    <DocumentListShell
      entity="payRun"
      title="Pay runs"
      description="Pay for one period and one group of people, checked and approved before anybody is paid."
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: "Search pay runs…", label: "Search pay runs" }}
      moreItems={runs?.length ? [exportMenuItem("Export pay runs")] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: "Pay runs", fileName: "Pay runs", label: "pay run/pay runs", columns: EXPORT_COLUMNS, rows });
      }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={begin} disabled={!periods.length || starting}>
          <Play size={16} aria-hidden="true" /> Run payroll
        </button>
      }
      countLine={countItems([
        { label: "In progress", value: counts.OPEN || 0, count: true, tone: "outstanding", onSelect: () => setStatus("OPEN") },
        { label: "Net pending", value: figures.open, tone: "partial" },
        { label: "Approved", value: figures.approved, tone: "sent", onSelect: () => setStatus("APPROVED") },
        { label: "Paid or posted", value: figures.done, tone: "paid", onSelect: () => setStatus("DONE") },
      ])}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Run status"
      above={starting ? <StartRun periods={periods} payGroups={payGroups} onCancel={() => setStarting(false)} onStart={start} /> : null}
    >
      <LoadFailed message={error} onRetry={load} />
      {periodsFailed && runs ? <p className="ui-caption mb-2">Could not load the payroll periods, so a new run cannot be started here.</p> : null}
      {!runs ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky ui-table-phone w-full">
            <thead>
              <tr>
                <th scope="col">Pay run</th>
                <ColumnHeader label="Period" col="period" state={filters} />
                <th scope="col" className="ui-col-h-center hidden md:table-cell">Pay date</th>
                <th scope="col" className="ui-col-h-right hidden md:table-cell">People</th>
                <th scope="col" className="ui-col-h-right hidden md:table-cell">Gross</th>
                <th scope="col" className="ui-col-h-right">Net pay</th>
                <ColumnHeader label="Status" col="status" state={filters} align="center" />
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={7}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No pay runs match" description="Nothing in this tab matches the search or the column filters." />
                    ) : !periods.length && !runs.length && !periodsFailed ? (
                      <EmptyState
                        icon={CalendarClock}
                        title="No open payroll period"
                        description="Payroll runs for a period. Add one under Settings → Pay calendar, and payroll has a month to run for."
                      />
                    ) : (
                      <EmptyState
                        icon={CalendarClock}
                        title={EMPTY_TITLES[status] || "No pay runs yet"}
                        description="Start a run for a period and payroll will gather everybody eligible, check them, and work out what each is owed."
                        routes={periods.length && !status ? [{ label: "Run payroll", description: "Pick the month and who it is for.", onSelect: begin }] : undefined}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="ui-row-click" onClick={() => setOpenId(r.id)}>
                    <td className="ui-col-id" data-phone="sub">{r.number}</td>
                    <td className="ui-col-entity" data-phone="name">
                      {r.period?.name || "—"}
                      {r.kind === "OFF_CYCLE" ? <span className="ui-caption block">Extra pay run</span> : null}
                    </td>
                    <td className="ui-col-date ui-col-h-center hidden md:table-cell">{dateWords(r.payrollDate)}</td>
                    <td className="ui-col-amount hidden md:table-cell">{r.employeeCount}</td>
                    <td className="ui-col-amount hidden md:table-cell">{moneyCell(r.grossTotal)}</td>
                    <td className="ui-col-amount" data-phone="key">{moneyCell(r.netTotal)}</td>
                    <td className="ui-col-h-center" data-phone="tag">
                      <ExceptionTag
                        label={["PAID", "POSTED"].includes(r.status) ? "" : STATUS_LABEL[r.status] || r.status}
                        normal={STATUS_LABEL[r.status]}
                        pill={["APPROVED", "LOCKED"].includes(r.status) ? "ui-pill-pos" : "ui-pill-neutral"}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </DocumentListShell>
    </div>
  );
}

const StartRun = ({ periods, payGroups, onCancel, onStart }) => {
  const [form, setForm] = useState({
    periodId: periods[0]?.id || "",
    payGroupId: "",
    kind: "REGULAR",
  });
  const extra = form.kind === "OFF_CYCLE";
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  return (
    <form
      className="ui-card p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(
          extra
            ? { periodId: form.periodId, kind: "OFF_CYCLE", people: [] }
            : { periodId: form.periodId, payGroupId: form.payGroupId || null },
        );
      }}
    >
      <div className="ui-sec-head">Run payroll</div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
        <div>
          <label className="ui-label" htmlFor="run-kind">
            Kind
          </label>
          <select id="run-kind" className="ui-select w-full" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
            <option value="REGULAR">Monthly payroll</option>
            <option value="OFF_CYCLE">Extra pay run</option>
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="run-period">
            Period
          </label>
          <select
            id="run-period"
            className="ui-select w-full"
            value={form.periodId}
            onChange={(e) => set({ periodId: e.target.value })}
            required
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {extra ? (
          <p className="ui-caption">A late joiner's days, a bonus or arrears, beside the month's payroll. You choose the people next.</p>
        ) : (
          <div>
            <label className="ui-label" htmlFor="run-group">
              Pay group
            </label>
            <select
              id="run-group"
              className="ui-select w-full"
              value={form.payGroupId}
              onChange={(e) => set({ payGroupId: e.target.value })}
            >
              <option value="">Everybody</option>
              {payGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" className="ui-btn ui-btn-primary">
            Start pay run
          </button>
        </div>
      </div>
    </form>
  );
};

/* ------------------------------------------------------------- the run */

const RunWorkflow = ({ runId, onBack }) => {
  const [data, setData] = useState(null);
  const [issues, setIssues] = useState(null);
  const [busy, setBusy] = useState("");
  const [stage, setStage] = useState("people");
  /* A big step done (locked, approved): a green note on the page, not a toast. */
  const [doneNote, setDoneNote] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await getPayrollRun(runId));
    } catch (e) {
      notify.error(errorWords(e, "load that pay run"));
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (label, fn, after) => {
    setBusy(label);
    try {
      const out = await fn();
      if (after) after(out);
      await load();
    } catch (e) {
      notify.error(errorWords(e, label));
    } finally {
      setBusy("");
    }
  };

  const run = data?.run;
  const editable =
    run && ["DRAFT", "CALCULATED", "REVIEW"].includes(run.status);

  const byEmployee = useMemo(
    () => new Map((data?.employees || []).map((e) => [e.employeeId, e])),
    [data],
  );

  if (!data) return <SkeletonCard lines={6} />;

  const errorCount = issues ? issues.errors : run.errorCount;
  const warningCount = issues ? issues.warnings : run.warningCount;

  return (
    <div className="space-y-3 ui-touch-44">
      <PageHeader
        entity="payRun"
        title={`${run.number} · ${run.period?.name || "pay run"}`}
        description={`${run.kind === "OFF_CYCLE" ? "Extra pay run: " : ""}${run.employeeCount} ${run.employeeCount === 1 ? "person" : "people"}, paid on ${dateWords(run.payrollDate)}.`}
        actions={
          <>
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={onBack}
            >
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            <RunPrimaryAction
              run={run}
              busy={busy}
              issues={issues}
              act={act}
              runId={runId}
              setIssues={setIssues}
              onLopMismatch={() => setStage("review")}
              onDone={setDoneNote}
            />
          </>
        }
      />

      <div className="px-5 lg:px-7 pb-8 space-y-4">
      {doneNote ? <SuccessNote title={doneNote.title} onClose={() => setDoneNote(null)}>{doneNote.next}</SuccessNote> : null}
      {/* What last month's payroll left for this one (picks round 32). */}
      <EarlierNote note={run.earlierNote} />
      {data.statutoryChecks?.length && ["CALCULATED", "REVIEW"].includes(run.status) ? (
        <StatutoryChecksBlocker checks={data.statutoryChecks} />
      ) : null}
      {/* Statutory lines nothing worked out: not approved until set up, or the owner records they do not apply. */}
      <StatutoryGapsPanel run={run} gaps={data.statutoryGaps} canWaive={data.canWaiveStatutory} onSaved={load} />
      {/* Returns this payroll cannot be filed under yet: the registration numbers setup asks for. */}
      <RegistrationNotice gaps={data.registrationGaps} />
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Tile label="People" value={run.employeeCount} />
        <Tile label="Gross" value={money(run.grossTotal)} />
        <Tile label="Deductions" value={money(run.deductionTotal)} />
        <Tile label="Net pay" value={money(run.netTotal)} strong />
      </div>
      {/* Round 32: how many payslips the bank has paid. */}
      <PaidCount slips={data.slips} status={run.status} />
      {/* Round 66: paid after the legal date, and one person's pay held with a reason. */}
      <LatePayNote run={run} />
      <HoldPayPanel run={run} slips={data.slips} byEmployee={byEmployee} onChanged={load} />

      {/* Days after the company's cut-off paid as present before they happened (O-11). */}
      <ProvisionalDaysNotice run={run} />
      {/* Instalments the legal share of wages moved to next month. */}
      <DeductionCapNotice run={run} />
      {/* Entered deductions past the limit: the payroll waits for them to be reduced or a reason. */}
      <OverLimitPanel run={run} onSaved={load} />
      {run.stale && run.status === "CALCULATED" ? <p role="status" className="ui-caption ui-text-warn">{run.stale}</p> : null}
      <NextMonthNote run={run} onSaved={load} />

      {errorCount > 0 || warningCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          {errorCount > 0 ? (
            <span className="ui-pill ui-pill-neg">
              <AlertTriangle size={12} aria-hidden="true" /> {errorCount} to
              resolve
            </span>
          ) : null}
          {warningCount > 0 ? (
            <span className="ui-pill ui-pill-warn">
              <Info size={12} aria-hidden="true" /> {warningCount} worth
              checking
            </span>
          ) : null}
        </div>
      ) : null}

      <RunSteps status={run.status} />

      <div className="ui-segmented" role="tablist" aria-label="Payroll stage">
        {[
          ["people", "People"],
          ["inputs", "Days"],
          ["issues", "Checks"],
          ["review", "Review"],
          ["books", "Accounting"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={stage === id}
            className="ui-segment"
            onClick={() => setStage(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {stage === "people" && run.kind === "OFF_CYCLE" ? (
        <ExtraPayStage data={data} editable={editable} runId={runId} onChanged={load} />
      ) : stage === "people" ? (
        <PeopleStage
          data={data}
          editable={editable}
          runId={runId}
          onChanged={load}
        />
      ) : stage === "inputs" ? (
        <DaysStage
          /* Rows are copied into the stage once; new figures (taken from Attendance, say) remount it. */
          key={data.employees
            .map(
              (m) =>
                `${m.employeeId}:${m.input?.payableDays ?? ""}:${m.input?.lwpDays ?? ""}:${m.input?.source ?? ""}`,
            )
            .join("|")}
          data={data}
          editable={editable}
          runId={runId}
          onSaved={load}
        />
      ) : stage === "issues" ? (
        <ChecksStage issues={issues} byEmployee={byEmployee} data={data} />
      ) : stage === "review" ? (
        <div className="space-y-3">
          <LopCheckPanel
            runId={runId}
            run={run}
            refreshKey={`${run.status}:${run.lockedAt || ""}:${JSON.stringify(run.attendanceSnapshots || null)}`}
            onLocked={load}
          />
          <ReviewStage data={data} byEmployee={byEmployee} />
        </div>
      ) : (
        <BooksStage runId={runId} run={run} onPosted={load} />
      )}

      {run.rejectionReason ? (
        <div
          className="ui-card p-3 text-sm"
          role="status"
          style={{
            background: "rgb(var(--warn-soft))",
            color: "rgb(var(--warn-ink))",
          }}
        >
          Sent back: {run.rejectionReason}
        </div>
      ) : null}
      </div>
    </div>
  );
};

/**
 * One primary action, and it is whatever the run's status says comes next.
 *
 * The status is the server's, so the button follows it rather than the screen
 * keeping its own idea of where the run has got to.
 */
/* Sending a pay run back asks why in the app's own drawer: the preparer reads the reason, so it is required. */
const SendBack = ({ run, busy, onSend }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const why = reason.trim();
  return (
    <>
      <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => setOpen(true)}>
        Send back
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={`Send ${run.number || "this pay run"} back?`}
        description="It goes back to the preparer to change and calculate again. Nothing is paid until it is approved."
        dirty={Boolean(why)}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!why) return;
            setOpen(false);
            setReason("");
            onSend(why);
          }}
        >
          <div>
            <label className="ui-label" htmlFor="send-back-reason">Reason (the preparer sees this)</label>
            <textarea id="send-back-reason" className="ui-input w-full" rows={4} required value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="ui-btn ui-btn-primary" disabled={!why}>Send back</button>
          </div>
        </form>
      </Drawer>
    </>
  );
};

export const RunPrimaryAction = ({ run, busy, act, runId, setIssues, onLopMismatch, onDone }) => {
  /* The run screen shows a green note; anywhere else falls back to the toast. */
  const done = (title, next) => (onDone ? onDone({ title, next }) : notify.success(`${title} ${next}`.trim()));
  if (
    run.status === "DRAFT" ||
    (run.status === "CALCULATED" && run.errorCount > 0)
  ) {
    return (
      <button
        type="button"
        className="ui-btn ui-btn-primary"
        disabled={Boolean(busy)}
        onClick={() =>
          act("check this pay run", async () => {
            const out = await validatePayrollRun(runId);
            setIssues(out);
            if (out.canCalculate) {
              await calculatePayrollRun(runId);
              notify.success("Pay run calculated.");
            } else {
              notify.error(
                `${out.errors} thing${out.errors === 1 ? "" : "s"} to resolve first.`,
              );
            }
            return out;
          })
        }
      >
        {busy ? "Working…" : "Check and calculate"}
      </button>
    );
  }
  const waitsForReason = Boolean(run.overLimit?.people?.length && !run.overLimit.reason);
  if (run.status === "CALCULATED") {
    /* Figures older than what they came from are not sent on (QA of #82, F4): calculated again first, from here. */
    const stale = run.stale || "";
    return (
      <>
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          disabled={Boolean(busy)}
          onClick={() =>
            act("calculate again", async () => {
              const out = await validatePayrollRun(runId);
              setIssues(out);
              if (!out.canCalculate) {
                notify.error(`${out.errors} thing${out.errors === 1 ? "" : "s"} to resolve first.`);
                return out;
              }
              await calculatePayrollRun(runId);
              notify.success("Calculated again.");
              return out;
            })
          }
        >
          Calculate again
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={Boolean(busy) || waitsForReason || Boolean(stale)}
          title={stale || (waitsForReason ? "Deductions pass the limit: reduce them or record why they stand" : undefined)}
          onClick={() =>
            act(
              "send for review",
              () => submitRunForReview(runId),
              () => notify.success("Sent for review."),
            )
          }
        >
          Send for review
        </button>
      </>
    );
  }
  if (run.status === "APPROVED") {
    return (
      <>
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          disabled={Boolean(busy)}
          onClick={async () => {
            /* Round 59 lockexplain A: what locking does, in plain words, before it happens. */
            if (!(await confirmDialog(lockWords(run)))) return;
            act(
              "lock",
              async () => {
                try {
                  return await lockPayrollRun(runId);
                } catch (e) {
                  /* Loss of pay that does not agree: the review lists who, with the way to lock with a reason. */
                  if (e?.code === "LOP_MISMATCH" && onLopMismatch) onLopMismatch();
                  throw e;
                }
              },
              () => done("Pay run locked.", "Nothing in it can change now."),
            );
          }}
        >
          Lock pay run
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={Boolean(busy)}
          onClick={() =>
            act(
              "post to accounts",
              () => postPayrollRun(runId),
              (out) =>
                notify.success(
                  out?.replayed ? "Already posted." : "Posted to accounts.",
                ),
            )
          }
        >
          Post to accounts
        </button>
      </>
    );
  }
  if (run.status === "REVIEW") {
    return (
      <>
        <SendBack
          run={run}
          busy={busy}
          onSend={(reason) =>
            act(
              "send it back",
              () => rejectPayrollRun(runId, { reason }),
              () => notify.success("Sent back. The preparer sees your reason."),
            )
          }
        />
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={Boolean(busy) || waitsForReason}
          title={waitsForReason ? "Deductions pass the limit: reduce them or record why they stand" : undefined}
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Approve ${run.number}?`,
              message: `Approving freezes these figures: ${money(run.netTotal)} to ${run.employeeCount} ${run.employeeCount === 1 ? "person" : "people"}. To change anything after this, the pay run has to be sent back.${afterBankCutoff() ? ` ${BANK_CUTOFF_NOTE}` : ""}`,
              confirmLabel: "Approve pay run",
            });
            if (ok)
              act(
                "approve",
                async () => {
                  try {
                    return await approvePayrollRun(runId);
                  } catch (e) {
                    /* Tax withheld without a PAN: approved only once the approver says so, naming each person. */
                    const people = e?.data?.people;
                    if (e?.code !== "NO_PAN_UNACKNOWLEDGED" || !Array.isArray(people)) throw e;
                    const sure = await confirmDialog({
                      title: "Approve with tax withheld without a PAN?",
                      message: `${people.map((p) => p.name).join(", ")} ${people.length === 1 ? "has" : "have"} no valid PAN, so income tax is withheld at 20% where that is more (section 206AA). Adding the PAN and calculating again lowers it. Approving now is recorded in the audit log.`,
                      confirmLabel: "Approve without PAN",
                    });
                    if (!sure) return null;
                    return approvePayrollRun(runId, { noPanAcknowledged: people.map((p) => p.employeeId) });
                  }
                },
                (out) => {
                  if (out) done("Pay run approved.", afterBankCutoff() ? `${BANK_CUTOFF_NOTE} Next: post it to accounts, or lock it.` : "Next: post it to accounts, or lock it.");
                },
              );
          }}
        >
          Approve pay run
        </button>
      </>
    );
  }
  if (run.status === "APPROVED" || run.status === "LOCKED") {
    return (
      <button
        type="button"
        className="ui-btn ui-btn-primary"
        disabled={Boolean(busy)}
        onClick={() =>
          act(
            "post to accounts",
            () => postPayrollRun(runId),
            (out) =>
              notify.success(
                out?.replayed ? "Already posted." : "Posted to accounts.",
              ),
          )
        }
      >
        Post to accounts
      </button>
    );
  }
  return null;
};

const Tile = ({ label, value, strong = false }) => (
  <div className="ui-card p-3">
    <div className="ui-card-label">{label}</div>
    <div className={`ui-num ${strong ? "text-lg font-medium" : "text-lg"}`}>
      {value}
    </div>
  </div>
);

const PeopleStage = ({ data, editable, runId, onChanged }) => (
  <div className="ui-card overflow-hidden">
    <div className="ui-table-scroll">
      <table className="ui-table ui-table-sticky w-full">
        <thead>
          <tr>
            <th scope="col" className="ui-col-h-center w-10">
              Include
            </th>
            <th scope="col">
              Employee
            </th>
            <th scope="col">
              Designation
            </th>
            <th scope="col" className="ui-col-h-center">
              State
            </th>
          </tr>
        </thead>
        <tbody className="ui-rows">
          {data.employees.map((m) => (
            <tr key={m.employeeId}>
              <td className="ui-col-h-center">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  aria-label={`Include ${m.employee?.name || "this person"} in this payroll`}
                  checked={m.inclusion === "INCLUDED"}
                  disabled={!editable}
                  onChange={(e) =>
                    setRunEmployeeIncluded(
                      runId,
                      m.employeeId,
                      e.target.checked,
                    )
                      .then(onChanged)
                      .catch((err) =>
                        notify.error(
                          errorWords(err, "change who is in this pay run"),
                        ),
                      )
                  }
                />
              </td>
              <td className="ui-col-entity">
                {m.employee?.name || "Name missing"}
                {m.employee?.code ? (
                  <span className="ui-caption block">{m.employee.code}</span>
                ) : null}
              </td>
              <td className="ui-col-meta">{m.employee?.designation || "—"}</td>
              <td>
                <span
                  className={`ui-pill ${m.state === "ERROR" ? "ui-pill-neg" : m.state === "WARNING" ? "ui-pill-warn" : "ui-pill-neutral"}`}
                >
                  {m.state === "CALCULATED"
                    ? "Calculated"
                    : m.state === "ERROR"
                      ? "Needs fixing"
                      : m.state === "WARNING"
                        ? "Check"
                        : m.state === "READY"
                          ? "Ready"
                          : "Pending"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const DaysStage = ({ data, editable, runId, onSaved }) => {
  const [rows, setRows] = useState(() =>
    data.employees
      .filter((m) => m.inclusion === "INCLUDED")
      .map((m) => ({
        employeeId: m.employeeId,
        name: m.employee?.name || "Name missing",
        workingDays: m.input?.workingDays ?? 30,
        payableDays: m.input?.payableDays ?? 30,
        lwpDays: m.input?.lwpDays ?? 0,
        variablePay: m.input?.variablePay ?? 0,
        overtimeHours: m.input?.overtimeHours ?? 0,
        source: m.input?.source || null,
        notes: m.input?.notes || "",
      })),
  );
  const [saving, setSaving] = useState(false);
  const [taking, setTaking] = useState(false);
  const fromAttendance = async () => {
    setTaking(true);
    try {
      let out = await takeDaysFromAttendance(runId);
      if (out.keptManual) {
        const replace = await confirmDialog({
          title: "Replace days typed by hand?",
          message: `${out.keptManual} ${out.keptManual === 1 ? "person has" : "people have"} days entered by hand. Replace them with Attendance's figures too?`,
          confirmLabel: "Replace",
          tone: "default",
        });
        if (replace) out = await takeDaysFromAttendance(runId, true);
      }
      const unresolved = (out.toResolve || []).length;
      notify.success(
        `Days taken from Attendance for ${out.saved} ${out.saved === 1 ? "person" : "people"}.` +
          (unresolved
            ? ` ${unresolved === 1 ? "1 person still has" : `${unresolved} people still have`} days with no check-out. Those count as loss of pay until corrected in Attendance.`
            : "") +
          (out.attendanceClosed
            ? (out.attendanceSnapshots || []).length
              ? ` Matches Attendance as closed for ${out.attendanceSnapshots.map((x) => monthText(x.month)).join(", ")}.`
              : ""
            : ` ${out.warning || "The month is not closed in Attendance; these figures can still change."}`) +
          (out.provisionalMessage ? ` ${out.provisionalMessage}` : "") +
          ((out.corrections || []).length
            ? ` ${out.corrections.length} ${out.corrections.length === 1 ? "correction" : "corrections"} for last month’s counted days added to this payroll.`
            : "") +
          /* Each in its own words: one with no payslip to price it on has to be added by hand, so it is never left unsaid. */
          (out.latePenalties || []).map((p) => ` ${p.name}: ${p.reason}.`).join(""),
      );
      onSaved();
    } catch (e) {
      notify.error(
        errorWords(e, "take days from Attendance"),
      );
    } finally {
      setTaking(false);
    }
  };
  const fromLeave = async () => {
    setTaking(true);
    try {
      let out = await takeDaysFromLeave(runId);
      if (out.keptManual) {
        const replace = await confirmDialog({
          title: "Replace days typed by hand?",
          message: `${out.keptManual} ${out.keptManual === 1 ? "person has" : "people have"} unpaid leave and days entered by hand. Replace them with the leave too?`,
          confirmLabel: "Replace",
          tone: "default",
        });
        if (replace) out = await takeDaysFromLeave(runId, true);
      }
      const paidOut = (out.encashments || []).reduce((a, e) => a + e.days, 0);
      notify.success(
        `Unpaid leave taken from People: ${out.unpaidLeaveDays} ${out.unpaidLeaveDays === 1 ? "day" : "days"} of loss of pay.` +
          (paidOut ? ` ${paidOut} leave ${paidOut === 1 ? "day was" : "days were"} reserved in People; link the payout under Payroll → Adjustments.` : ""),
      );
      onSaved();
    } catch (e) {
      notify.error(errorWords(e, "take leave from People"));
    } finally {
      setTaking(false);
    }
  };
  const patch = (idx, p) =>
    setRows((list) => list.map((r, i) => (i === idx ? { ...r, ...p } : r)));

  const save = async () => {
    setSaving(true);
    try {
      await saveRunInputs(
        runId,
        rows.map((r) => ({
          employeeId: r.employeeId,
          workingDays: Number(r.workingDays) || 0,
          payableDays: Number(r.payableDays) || 0,
          lwpDays: Number(r.lwpDays) || 0,
          variablePay: Number(r.variablePay) || 0,
          overtimeHours: Number(r.overtimeHours) || 0,
        })),
      );
      notify.success("Days saved.");
      onSaved();
    } catch (e) {
      notify.error(errorWords(e, "save those days"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Days taken from an Attendance month still open: said until the month is closed and the days taken again. */}
      <ProvisionalNotice openMonths={openMonthsOf(data.run)} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="ui-caption max-w-[60ch]">
          {hasApp("attendance")
            ? "Take payable days and loss of pay from Attendance, or type them. Without either, days come from the period and each person’s joining and leaving dates."
            : hasApp("people")
              ? "Days are worked out from the period and each person’s joining and leaving dates; take approved unpaid leave from People as loss of pay, or change them by hand."
              : "Days are worked out from the period and each person’s joining and leaving dates. Change them where somebody lost pay."}
        </p>
        {editable && hasApp("attendance") ? (
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={fromAttendance}
            disabled={taking}
          >
            {taking ? "Taking…" : "Take days from Attendance"}
          </button>
        ) : null}
        {editable && !hasApp("attendance") && hasApp("people") ? (
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={fromLeave}
            disabled={taking}
          >
            {taking ? "Taking…" : "Take unpaid leave from People"}
          </button>
        ) : null}
      </div>
      <div className="ui-card overflow-hidden">
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col">
                  Employee
                </th>
                <th scope="col" className="ui-col-h-right">
                  Working days
                </th>
                <th scope="col" className="ui-col-h-right">
                  Payable days
                </th>
                <th scope="col" className="ui-col-h-right">
                  Unpaid days (LOP)
                </th>
                <th
                  scope="col"
                  className="ui-col-h-right"
                  title="Approved overtime hours, paid by the overtime component of the salary structure."
                >
                  Overtime hours
                </th>
                <th scope="col" className="ui-col-h-right">
                  Variable pay
                </th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              <fieldset className="contents" disabled={!editable}>
                {rows.map((r, idx) => (
                  <tr key={r.employeeId}>
                    <td className="ui-col-entity">
                      {r.name}
                      {r.source === "ATTENDANCE" ? (
                        <span className="ui-caption block" title={r.notes}>
                          From Attendance
                        </span>
                      ) : r.source === "MANUAL" ? (
                        <span className="ui-caption block">Typed</span>
                      ) : null}
                    </td>
                    {[
                      "workingDays",
                      "payableDays",
                      "lwpDays",
                      "overtimeHours",
                      "variablePay",
                    ].map((field) => (
                      <td key={field} className="ui-col-amount">
                        <input
                          type="number"
                          min="0"
                          className="ui-input ui-num w-full min-w-0 px-2 py-1"
                          aria-label={`${field === "workingDays" ? "Working days" : field === "payableDays" ? "Payable days" : field === "lwpDays" ? "Unpaid days" : field === "overtimeHours" ? "Overtime hours" : "Variable pay"} for ${r.name}`}
                          value={r[field]}
                          onChange={(e) =>
                            patch(idx, { [field]: e.target.value })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </fieldset>
            </tbody>
          </table>
        </div>
      </div>
      {editable ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save days"}
          </button>
        </div>
      ) : null}
    </div>
  );
};

/**
 * State figures CLOR could not confirm, on this run's payslips: the run can
 * be previewed but not approved (the server refuses) until each is confirmed
 * or corrected on the Compliance screen.
 */
/** "Meghalaya professional tax and Kerala Labour Welfare Fund" — the server's words (statutory/resolve.ts checksSentence). */
const checksSentence = (checks) => {
  const parts = checks.map((c) => `${c.state} ${c.scheme === "LWF" ? "Labour Welfare Fund" : "professional tax"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
};

const StatutoryChecksBlocker = ({ checks }) => (
  <div
    className="ui-card p-3 text-sm flex flex-wrap items-start justify-between gap-3"
    role="status"
    style={{ background: "rgb(var(--warn-soft))", color: "rgb(var(--warn-ink))" }}
  >
    <div className="flex items-start gap-2 min-w-0 max-w-3xl">
      <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div>
        <div className="font-medium">Not ready to approve</div>
        <div>
          This payroll uses figures CLOR could not confirm from an official notice: {checksSentence(checks)}. Check each
          against the state’s notice, then confirm it, or correct it and calculate again.
        </div>
      </div>
    </div>
    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => requestOpenScreen("compliance")}>
      Confirm or correct
    </button>
  </div>
);

const ChecksStage = ({ issues, byEmployee, data }) => {
  const list = issues?.issues || data.employees.flatMap((m) => m.issues || []);
  if (!list.length) {
    return (
      <div className="ui-card p-4">
        <p className="ui-caption">
          Nothing to resolve. Run the check to see the latest.
        </p>
      </div>
    );
  }
  const order = { ERROR: 0, WARNING: 1, INFO: 2 };
  const sorted = [...list].sort(
    (a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3),
  );
  return (
    <div className="ui-card overflow-hidden">
      <ul>
        {sorted.map((i, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 px-4 py-2.5 text-sm"
            style={{ borderTop: idx ? "1px solid rgb(var(--border))" : "none" }}
          >
            {i.severity === "ERROR" ? (
              <AlertTriangle
                size={15}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
                style={{ color: "rgb(var(--neg))" }}
              />
            ) : i.severity === "WARNING" ? (
              <Info
                size={15}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
                style={{ color: "rgb(var(--warn-ink))" }}
              />
            ) : (
              <Check
                size={15}
                aria-hidden="true"
                className="mt-0.5 shrink-0 ui-subtle"
              />
            )}
            <span className="min-w-0">
              {i.message}
              {i.code === "RULE_NEEDS_CHECK" ? (
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm ml-1" onClick={() => requestOpenScreen("compliance")}>
                  Confirm or correct
                </button>
              ) : null}
              {/* Round 66: below minimum wage opens the person's salary (raise it) or details (skill level, state). */}
              {i.code === "BELOW_MINIMUM_WAGE" && i.employeeId ? (
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm ml-1" onClick={() => requestOpenScreen("assignments", { employeeId: i.employeeId, tab: "salary" })}>
                  Fix
                </button>
              ) : null}
              {i.employeeId && byEmployee.get(i.employeeId)?.employee?.name ? (
                <span className="ui-caption block">
                  {byEmployee.get(i.employeeId).employee.name}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const ReviewStage = ({ data, byEmployee }) => {
  if (!data.slips.length) {
    return (
      <div className="ui-card p-4">
        <p className="ui-caption">
          Nothing calculated yet. Check and calculate, and the payslips appear
          here.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
    {/* Round 32: who is paid differently from last period, and why. */}
    <PayChanges slips={data.slips} byEmployee={byEmployee} />
    <div className="ui-card overflow-hidden">
      <div className="ui-table-scroll">
        <table className="ui-table ui-table-sticky w-full">
          <thead>
            <tr>
              <th scope="col">
                Employee
              </th>
              <th scope="col" className="ui-col-h-right">
                Gross
              </th>
              <th scope="col" className="ui-col-h-right">
                Deductions
              </th>
              <th scope="col" className="ui-col-h-right">
                Employer cost
              </th>
              <th scope="col" className="ui-col-h-right">
                Net pay
              </th>
              <th scope="col" className="ui-col-h-right">
                Last period
              </th>
              <th scope="col" className="ui-col-h-right">
                Change
              </th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {data.slips.map((s) => {
              const person = byEmployee.get(s.employeeId)?.employee;
              /* A large move month on month is usually right and always worth
                 a second look, so it is marked rather than hidden. */
              const big =
                s.variancePercent != null && Math.abs(s.variancePercent) >= 20;
              return (
                <tr key={s.id}>
                  <td className="ui-col-entity">{person?.name || "Name missing"}</td>
                  <td className="ui-col-amount">{moneyCell(s.grossEarnings)}</td>
                  <td className="ui-col-amount">{moneyCell(s.totalDeductions)}</td>
                  <td className="ui-col-amount">{moneyCell(s.employerCost)}</td>
                  <td className="ui-col-amount font-medium">
                    {money(s.netPay)}
                  </td>
                  <td className="ui-col-amount">
                    {s.previousNetPay == null ? "—" : money(s.previousNetPay)}
                  </td>
                  <td
                    className="ui-col-amount"
                    style={big ? { color: "rgb(var(--warn-ink))" } : undefined}
                  >
                    {s.variancePercent == null
                      ? "—"
                      : `${s.variancePercent > 0 ? "+" : ""}${s.variancePercent.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
};

/**
 * What payroll will write to the books, shown before it writes it.
 *
 * The entry, in full, with whatever would stop it. Finance seeing payroll only
 * after it has been posted is how a misconfigured component becomes a
 * correcting journal next month.
 */
const BooksStage = ({ runId, run, onPosted }) => {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);
  const [connectors, setConnectors] = useState([]);
  useEffect(() => {
    let alive = true;
    tallyConnectors().then((c) => alive && setConnectors(c));
    return () => {
      alive = false;
    };
  }, []);
  const sendTally = async (agentId) => {
    try {
      const r = await sendPayrollToTally(runId, agentId);
      notify.success(
        `Sent to ${r.agent}. It reaches Tally within a few minutes; check the result under Attendance → Integrations.`,
      );
    } catch (e) {
      notify.error(errorWords(e, "send the entry to Tally"));
    }
  };

  useEffect(() => {
    let alive = true;
    previewPayrollPosting(runId)
      .then((p) => alive && setPreview(p))
      .catch(
        (e) =>
          alive &&
          setError(errorWords(e, "prepare the accounting entry")),
      );
    return () => {
      alive = false;
    };
  }, [runId, run.status]);

  if (error) {
    return (
      <div
        className="ui-card p-3 text-sm"
        role="alert"
        style={{ borderColor: "rgb(var(--neg))", color: "rgb(var(--neg))" }}
      >
        {error}
      </div>
    );
  }
  if (!preview) return <SkeletonCard lines={4} />;

  const tally = async () => {
    try {
      const r = await payrollTallyXml(runId);
      const url = URL.createObjectURL(
        new Blob([r.xml], { type: "application/xml" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      notify.success(
        "Tally XML downloaded. Import it under Gateway of Tally → Import Data → Vouchers; ledger names must match.",
      );
    } catch (e) {
      notify.error(errorWords(e, "make the Tally file"));
    }
  };
  const post = async () => {
    setPosting(true);
    try {
      const out = await postPayrollRun(runId);
      notify.success(
        out?.replayed ? "Already posted." : "Posted to accounts.",
      );
      onPosted();
    } catch (e) {
      notify.error(errorWords(e, "post that pay run"));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-3">
      {preview.alreadyPosted ? (
        <p className="ui-caption">
          Posted on{" "}
          {dateWords(String(preview.alreadyPosted.postedAt || "").slice(0, 10))}
          . This is the entry it made.
        </p>
      ) : null}

      {preview.problems.length ? (
        <ul className="ui-card overflow-hidden">
          {preview.problems.map((p, i) => (
            <li
              key={i}
              className="flex items-start gap-2 px-4 py-2.5 text-sm"
              style={{
                borderTop: i ? "1px solid rgb(var(--border))" : "none",
                color: "rgb(var(--neg))",
              }}
            >
              <AlertTriangle
                size={15}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              />
              <span>{p.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="ui-card overflow-hidden">
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col">
                  Ledger
                </th>
                <th scope="col" className="ui-col-h-right">
                  Debit
                </th>
                <th scope="col" className="ui-col-h-right">
                  Credit
                </th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {preview.lines.map((l, i) => (
                <tr key={`${l.ledgerAccountId}-${i}`}>
                  <td className="ui-col-entity">{l.ledgerName}</td>
                  <td className="ui-col-amount">
                    {l.debit > 0 ? money(l.debit) : ""}
                  </td>
                  <td className="ui-col-amount">
                    {l.credit > 0 ? money(l.credit) : ""}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="ui-col-entity font-medium">Total</td>
                <td className="ui-col-amount font-medium">
                  {money(preview.totalDebit)}
                </td>
                <td className="ui-col-amount font-medium">
                  {money(preview.totalCredit)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span
          className={`ui-pill ${preview.balanced ? "ui-pill-pos" : "ui-pill-neg"}`}
        >
          {preview.balanced ? "Balanced" : "Does not balance"}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {preview.balanced && !preview.problems.length ? (
            <>
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                onClick={tally}
                title="Tally Prime / ERP 9 import file"
              >
                Download Tally XML
              </button>
              {connectors.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="ui-btn ui-btn-secondary"
                  onClick={() => sendTally(c.id)}
                  title={`Posts into Tally at ${c.tally.host} through the connector`}
                >
                  Send to Tally via {c.name}
                </button>
              ))}
            </>
          ) : null}
          {!preview.alreadyPosted &&
          preview.balanced &&
          !preview.problems.length &&
          ["APPROVED", "LOCKED"].includes(run.status) ? (
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={post}
              disabled={posting}
            >
              {posting ? "Posting…" : "Post to accounts"}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
};
