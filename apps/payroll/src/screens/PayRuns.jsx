import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Button,
} from "@ui/components/ui/Primitives";
import RecordTabs from "@ui/components/ui/RecordTabs";
import useUnsavedChanges from "@ui/components/ui/useUnsavedChanges";
import { Figures } from "../components/Figure";
import Notice from "../components/Notice";
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
import { rupees as money } from "@ui/utils/money";
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
  const [startKey, setStartKey] = useState(0);
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

  /* One request at a time: a second click while the first is on its way would start a second run (design audit, Batch 1). */
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const start = async (payload) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
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
    } finally {
      inFlight.current = false;
      setSaving(false);
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

  /* Opened again: a fresh form from the first open period, not last time's choice. */
  const begin = () => {
    setStartKey((k) => k + 1);
    setStarting(true);
  };

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
    >
      <StartRun key={startKey} open={starting} periods={periods} payGroups={payGroups} saving={saving} onCancel={() => setStarting(false)} onStart={start} />
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

/* Run payroll asks in a drawer, so the list page keeps one primary button (DESIGN.md "One primary action"). */
const StartRun = ({ open, periods, payGroups, saving, onCancel, onStart }) => {
  const firstPeriod = periods[0]?.id || "";
  const [form, setForm] = useState({ periodId: firstPeriod, payGroupId: "", kind: "REGULAR" });
  const extra = form.kind === "OFF_CYCLE";
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const dirty = form.kind !== "REGULAR" || Boolean(form.payGroupId) || form.periodId !== firstPeriod;

  return (
    <Drawer
      open={open}
      onClose={() => {
        if (!saving) onCancel();
      }}
      title="Run payroll"
      description="Pick the month and who it is for. Nobody is paid until the run is checked and approved."
      dirty={dirty && !saving}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (saving) return;
          onStart(
            extra
              ? { periodId: form.periodId, kind: "OFF_CYCLE", people: [] }
              : { periodId: form.periodId, payGroupId: form.payGroupId || null },
          );
        }}
      >
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
        <div className="flex justify-end gap-2">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <Button type="submit" variant="primary" icon={Play} loading={saving} disabled={!form.periodId}>
            {saving ? "Starting…" : "Start pay run"}
          </Button>
        </div>
      </form>
    </Drawer>
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
  /* A failed load says so with a way to try again, instead of a skeleton that never ends. */
  const [loadError, setLoadError] = useState("");
  /* Days typed and not saved yet: switching stage or going back asks first. */
  const [daysDirty, setDaysDirty] = useState(false);
  useUnsavedChanges(daysDirty);
  /* What the running step is doing, in words, on its button ("Checking 142 people…"). */
  const [step, setStep] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await getPayrollRun(runId));
      setLoadError("");
    } catch (e) {
      setLoadError(errorWords(e, "load that pay run"));
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const busyRef = useRef(false);
  const act = async (label, fn, after) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    try {
      const out = await fn(setStep);
      if (after) after(out);
      await load();
    } catch (e) {
      notify.error(errorWords(e, label));
    } finally {
      busyRef.current = false;
      setBusy("");
      setStep("");
    }
  };

  const leaveDays = async () => {
    if (!daysDirty) return true;
    const ok = await confirmDialog({
      title: "Leave without saving the days?",
      message: "The days typed on this stage are not saved yet. Leaving now drops them.",
      confirmLabel: "Leave without saving",
      tone: "danger",
    });
    if (ok) setDaysDirty(false);
    return ok;
  };
  const goStage = async (id) => {
    if (id === stage) return;
    if (stage === "inputs" && !(await leaveDays())) return;
    setStage(id);
  };
  const goBack = async () => {
    if (!(await leaveDays())) return;
    onBack();
  };

  const run = data?.run;
  const editable =
    run && ["DRAFT", "CALCULATED", "REVIEW"].includes(run.status);

  const byEmployee = useMemo(
    () => new Map((data?.employees || []).map((e) => [e.employeeId, e])),
    [data],
  );

  if (!data) {
    if (!loadError) return <SkeletonCard lines={6} />;
    return (
      <div className="space-y-3 ui-touch-44">
        <PageHeader
          entity="payRun"
          title="Pay run"
          actions={
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
          }
        />
        <div className="px-5 lg:px-7 pb-8">
          <LoadFailed message={loadError} onRetry={load} />
        </div>
      </div>
    );
  }

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
              onClick={goBack}
              disabled={Boolean(busy)}
            >
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            <RunPrimaryAction
              run={run}
              busy={busy}
              step={step}
              issues={issues}
              act={act}
              runId={runId}
              setIssues={setIssues}
              onLopMismatch={() => setStage("review")}
              onPostBlocked={() => setStage("books")}
              onDone={setDoneNote}
            />
          </>
        }
      />

      <div className="px-5 lg:px-7 pb-8 space-y-4">
      {/* Sent back: the reason first, as a plain note, since it is what the preparer has to act on. */}
      {run.rejectionReason ? (
        <Notice tone="warn" word="Sent back">{run.rejectionReason}</Notice>
      ) : null}
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
      {/* The run's totals as figures on the page, not four cards (DESIGN.md "figure"; design audit step 2). */}
      <Figures
        label="Pay run totals"
        items={[
          { label: "People", value: run.employeeCount, raw: run.employeeCount },
          { label: "Gross", value: moneyCell(run.grossTotal, { zero: true }), raw: run.grossTotal },
          { label: "Deductions", value: moneyCell(run.deductionTotal, { zero: true }), raw: run.deductionTotal },
          { label: "Net pay", value: moneyCell(run.netTotal, { zero: true }), raw: run.netTotal },
        ]}
      />
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

      {/* The shared tabs: arrow keys, Home and End, and a tab panel the tabs point at. */}
      <RecordTabs
        label="Payroll stage"
        value={stage}
        onChange={goStage}
        tabs={[
          { key: "people", label: "People" },
          { key: "inputs", label: "Days" },
          { key: "issues", label: "Checks" },
          { key: "review", label: "Review" },
          { key: "books", label: "Accounting" },
        ]}
      >
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
          onDirty={setDaysDirty}
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
        <BooksStage runId={runId} run={run} />
      )}
      </RecordTabs>
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

const peopleWord = (n) => `${n} ${n === 1 ? "person" : "people"}`;
const thingsToResolve = (n) => `${n} thing${n === 1 ? "" : "s"} to resolve first`;

/**
 * Check, then calculate, with each step named on the button and the result
 * said after ("Checked 142 people: 3 things to resolve first").
 */
const checkAndCalculate = (run, runId, setIssues, again) => async (step) => {
  const n = Number(run.employeeCount || 0);
  step?.(n ? `Checking ${peopleWord(n)}…` : "Checking…");
  const out = await validatePayrollRun(runId);
  setIssues(out);
  if (!out.canCalculate) {
    notify.error(`Checked ${n ? peopleWord(n) : "the pay run"}: ${thingsToResolve(out.errors)}.`);
    return out;
  }
  step?.("Calculating…");
  await calculatePayrollRun(runId);
  const warn = Number(out.warnings || 0);
  notify.success(
    `${again ? "Calculated again" : "Pay run calculated"}${n ? ` for ${peopleWord(n)}` : ""}.${warn ? ` ${warn} worth checking under Checks.` : ""}`,
  );
  return out;
};

/**
 * Post to accounts, asked first with the entry's debit total. One button for
 * it, at the top: the Accounting stage shows the entry and says where to post.
 * A preview that does not balance or has problems is not posted; the stage
 * that says why opens instead.
 */
const postToAccounts = (run, runId, onPostBlocked) => async (step) => {
  step?.("Preparing the entry…");
  const preview = await previewPayrollPosting(runId);
  if (preview?.alreadyPosted) return { replayed: true };
  if (!preview?.balanced || preview?.problems?.length) {
    notify.error("The accounting entry is not ready to post. The Accounting stage says why.");
    onPostBlocked?.();
    return null;
  }
  const ok = await confirmDialog({
    title: `Post ${run.number || "this pay run"} to accounts?`,
    message: `This writes a journal of ${money(preview.totalDebit)} debit and ${money(preview.totalCredit)} credit to the books for ${run.period?.name || "this period"}. A posted entry is corrected by a new entry, not by changing this one.`,
    confirmLabel: "Post to accounts",
  });
  if (!ok) return null;
  step?.("Posting…");
  return postPayrollRun(runId);
};
const posted = (out) => {
  if (out) notify.success(out.replayed ? "Already posted." : "Posted to accounts.");
};

export const RunPrimaryAction = ({ run, busy, step = "", act, runId, setIssues, onLopMismatch, onPostBlocked, onDone }) => {
  /* The run screen shows a green note; anywhere else falls back to the toast. */
  const done = (title, next) => (onDone ? onDone({ title, next }) : notify.success(`${title} ${next}`.trim()));
  const working = Boolean(busy);
  /* The button that started the work names the step; its siblings wait, disabled. */
  const label = (what, idle) => (busy === what ? step || "Working…" : idle);
  if (
    run.status === "DRAFT" ||
    (run.status === "CALCULATED" && run.errorCount > 0)
  ) {
    return (
      <Button
        variant="primary"
        loading={busy === "check this pay run"}
        disabled={working && busy !== "check this pay run"}
        onClick={() => act("check this pay run", checkAndCalculate(run, runId, setIssues, false))}
      >
        {label("check this pay run", "Check and calculate")}
      </Button>
    );
  }
  const waitsForReason = Boolean(run.overLimit?.people?.length && !run.overLimit.reason);
  if (run.status === "CALCULATED") {
    /* Figures older than what they came from are not sent on (QA of #82, F4): calculated again first, from here. */
    const stale = run.stale || "";
    return (
      <>
        <Button
          loading={busy === "calculate again"}
          disabled={working && busy !== "calculate again"}
          onClick={() => act("calculate again", checkAndCalculate(run, runId, setIssues, true))}
        >
          {label("calculate again", "Calculate again")}
        </Button>
        <Button
          variant="primary"
          loading={busy === "send for review"}
          disabled={(working && busy !== "send for review") || waitsForReason || Boolean(stale)}
          title={stale || (waitsForReason ? "Deductions pass the limit: reduce them or record why they stand" : undefined)}
          onClick={() =>
            act(
              "send for review",
              () => submitRunForReview(runId),
              () => notify.success("Sent for review."),
            )
          }
        >
          {busy === "send for review" ? "Sending…" : "Send for review"}
        </Button>
      </>
    );
  }
  if (run.status === "APPROVED") {
    return (
      <>
        <Button
          loading={busy === "lock"}
          disabled={working && busy !== "lock"}
          onClick={async () => {
            if (working) return;
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
          {busy === "lock" ? "Locking…" : "Lock pay run"}
        </Button>
        <PostButton busy={busy} step={step} onClick={() => act("post to accounts", postToAccounts(run, runId, onPostBlocked), posted)} />
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
        <Button
          variant="primary"
          loading={busy === "approve"}
          disabled={(working && busy !== "approve") || waitsForReason}
          title={waitsForReason ? "Deductions pass the limit: reduce them or record why they stand" : undefined}
          onClick={async () => {
            if (working) return;
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
          {busy === "approve" ? "Approving…" : "Approve pay run"}
        </Button>
      </>
    );
  }
  if (run.status === "LOCKED") {
    return <PostButton busy={busy} step={step} onClick={() => act("post to accounts", postToAccounts(run, runId, onPostBlocked), posted)} />;
  }
  return null;
};

const PostButton = ({ busy, step, onClick }) => (
  <Button
    variant="primary"
    loading={busy === "post to accounts"}
    disabled={Boolean(busy) && busy !== "post to accounts"}
    onClick={onClick}
  >
    {busy === "post to accounts" ? step || "Posting…" : "Post to accounts"}
  </Button>
);

const STATE_WORDS = { CALCULATED: "Calculated", ERROR: "Needs fixing", WARNING: "Check", READY: "Ready" };

const PeopleStage = ({ data, editable, runId, onChanged }) => {
  /* The row being changed waits, disabled, until the server answers: a second click would undo the first. */
  const [saving, setSaving] = useState(() => new Set());
  const toggle = async (m, include) => {
    if (saving.has(m.employeeId)) return;
    setSaving((s) => new Set(s).add(m.employeeId));
    try {
      await setRunEmployeeIncluded(runId, m.employeeId, include);
      await onChanged();
    } catch (err) {
      notify.error(errorWords(err, "change who is in this pay run"));
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(m.employeeId);
        return next;
      });
    }
  };
  return (
    <div className="ui-list-surface overflow-hidden">
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
            {data.employees.map((m) => {
              const busyRow = saving.has(m.employeeId);
              return (
                <tr key={m.employeeId} aria-busy={busyRow || undefined}>
                  <td className="ui-col-h-center">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      aria-label={`Include ${m.employee?.name || "this person"} in this payroll`}
                      checked={m.inclusion === "INCLUDED"}
                      disabled={!editable || busyRow}
                      onChange={(e) => toggle(m, e.target.checked)}
                    />
                  </td>
                  <td className="ui-col-entity">
                    {m.employee?.name || "Name missing"}
                    {m.employee?.code ? (
                      <span className="ui-caption block">{m.employee.code}</span>
                    ) : null}
                  </td>
                  <td className="ui-col-meta">{m.employee?.designation || "—"}</td>
                  <td className="ui-col-h-center">
                    {/* Only a person who needs something carries a tag (DESIGN.md "Status tags"). */}
                    <ExceptionTag
                      label={m.state === "ERROR" || m.state === "WARNING" ? STATE_WORDS[m.state] : ""}
                      normal={STATE_WORDS[m.state] || "Pending"}
                      tone={m.state === "ERROR" ? "neg" : "warn"}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const DAY_FIELDS = ["workingDays", "payableDays", "lwpDays", "overtimeHours", "variablePay"];
const daysOf = (data) =>
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
    }));

const DaysStage = ({ data, editable, runId, onSaved, onDirty }) => {
  const [rows, setRows] = useState(() => daysOf(data));
  const [initial] = useState(() => daysOf(data));
  const dirty = useMemo(
    () => rows.some((r, i) => DAY_FIELDS.some((f) => String(r[f]) !== String(initial[i]?.[f]))),
    [rows, initial],
  );
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  /* Leaving the stage (or the run) clears the flag; the workflow already asked. */
  useEffect(() => () => onDirty?.(false), [onDirty]);
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
    if (saving) return;
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
      onDirty?.(false);
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
      <div className="ui-list-surface overflow-hidden">
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
                    {DAY_FIELDS.map((field) => (
                      <td key={field} className="ui-col-amount">
                        {/* Text, not a number field: a mouse wheel over a number field changes the days or the pay. */}
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={!editable}
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
  <Notice
    tone="warn"
    word="Not ready to approve"
    action={
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => requestOpenScreen("compliance")}>
        Confirm or correct
      </button>
    }
  >
    This payroll uses figures CLOR could not confirm from an official notice: {checksSentence(checks)}. Check each
    against the state’s notice, then confirm it, or correct it and calculate again.
  </Notice>
);

const ChecksStage = ({ issues, byEmployee, data }) => {
  const list = issues?.issues || data.employees.flatMap((m) => m.issues || []);
  if (!list.length) {
    return (
      <p className="ui-caption">
        Nothing to resolve. Run the check to see the latest.
      </p>
    );
  }
  const order = { ERROR: 0, WARNING: 1, INFO: 2 };
  const sorted = [...list].sort(
    (a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3),
  );
  return (
    <div className="ui-list-surface overflow-hidden">
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
      <p className="ui-caption">
        Nothing calculated yet. Check and calculate, and the payslips appear
        here.
      </p>
    );
  }
  return (
    <div className="space-y-3">
    {/* Round 32: who is paid differently from last period, and why. */}
    <PayChanges slips={data.slips} byEmployee={byEmployee} />
    <div className="ui-list-surface overflow-hidden">
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
                  <td className="ui-col-amount">
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
const BooksStage = ({ runId, run }) => {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [connectors, setConnectors] = useState([]);
  /* The connector a send is on its way through: one send at a time, and the button says so. */
  const [sending, setSending] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    tallyConnectors()
      .then((c) => alive && setConnectors(c || []))
      .catch(() => alive && setConnectors([]));
    return () => {
      alive = false;
    };
  }, []);
  const sendTally = async (agentId) => {
    if (sending) return;
    setSending(agentId);
    try {
      const r = await sendPayrollToTally(runId, agentId);
      notify.success(
        `Sent to ${r.agent}. It reaches Tally within a few minutes; check the result under Attendance → Integrations.`,
      );
    } catch (e) {
      notify.error(errorWords(e, "send the entry to Tally"));
    } finally {
      setSending("");
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
  }, [runId, run.status, attempt]);

  if (error) return <LoadFailed message={error} onRetry={() => {
    setError("");
    setAttempt((n) => n + 1);
  }} />;
  if (!preview) return <SkeletonCard lines={4} />;

  const tally = async () => {
    if (downloading) return;
    setDownloading(true);
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
    } finally {
      setDownloading(false);
    }
  };
  const ready = preview.balanced && !preview.problems.length;
  const canPost = !preview.alreadyPosted && ready && ["APPROVED", "LOCKED"].includes(run.status);

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
        <ul className="ui-list-surface overflow-hidden">
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

      <div className="ui-list-surface overflow-hidden">
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
                    {l.debit > 0 ? moneyCell(l.debit) : ""}
                  </td>
                  <td className="ui-col-amount">
                    {l.credit > 0 ? moneyCell(l.credit) : ""}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="ui-col-entity font-semibold">Total</td>
                <td className="ui-col-amount font-semibold">
                  {moneyCell(preview.totalDebit, { zero: true })}
                </td>
                <td className="ui-col-amount font-semibold">
                  {moneyCell(preview.totalCredit, { zero: true })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Balanced is what an entry should be, so only the exception carries a tag. */}
        {preview.balanced ? (
          <span className="ui-caption">
            {canPost ? "Debits and credits agree. Post it with Post to accounts at the top of the page." : "Debits and credits agree."}
          </span>
        ) : (
          <span className="ui-pill ui-pill-neg">Does not balance</span>
        )}
        {ready ? (
          <span className="flex flex-wrap items-center gap-2">
            <Button onClick={tally} loading={downloading} disabled={Boolean(sending)} title="Tally Prime / ERP 9 import file">
              {downloading ? "Making the file…" : "Download Tally XML"}
            </Button>
            {connectors.map((c) => (
              <Button
                key={c.id}
                onClick={() => sendTally(c.id)}
                loading={sending === c.id}
                disabled={Boolean(sending) && sending !== c.id}
                title={`Posts into Tally at ${c.tally.host} through the connector`}
              >
                {sending === c.id ? "Sending…" : `Send to Tally via ${c.name}`}
              </Button>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
};
