import React, { useEffect, useMemo, useState } from "react";
import { Plus } from "@ui/components/ui/lineIcons";
import { notify } from "@ui/components/ui/notify";
import { rupees as money } from "@ui/utils/money";
import { saveExtraPay, setRunEmployeeIncluded } from "../api/payrollRuns";
import { listEmployees } from "../api/payrollPeople";
import { listSalaryComponents } from "../api/payrollComponents";
import { errorWords } from "@ui/utils/errorWords";

/**
 * Who an extra pay run pays, and what (an OFF_CYCLE run).
 *
 * A second payroll in the same month: a late joiner's days, a bonus or arrears
 * paid between monthly payrolls. Each person is in it either for their salary
 * this month (worked out on their days, as on any payroll) or for an extra
 * only: the amounts entered here, as earnings. PF, ESI, professional tax and
 * income tax on an extra are worked out by the server on top of the month's
 * salary, never twice; the screen only collects who and how much.
 */

const PAYS_LABEL = { SALARY: "Salary for the month", EXTRA: "Extra only" };

const blankItem = (componentId = "") => ({ componentId, amount: "", reason: "" });

const PersonRow = ({ member, components, editable, runId, onChanged }) => {
  const [pays, setPays] = useState(member.pays || "EXTRA");
  const [items, setItems] = useState(() =>
    (member.extraPay || []).length
      ? member.extraPay.map((i) => ({ componentId: i.componentId, amount: String(i.amount), reason: i.reason || "" }))
      : [],
  );
  const [busy, setBusy] = useState(false);
  const name = member.employee?.name || "this person";
  const included = member.inclusion === "INCLUDED";
  const total = items.reduce((t, i) => t + (Number(i.amount) || 0), 0);

  const set = (n, patch) => setItems((list) => list.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true);
    try {
      await saveExtraPay(runId, {
        employeeId: member.employeeId,
        pays,
        items: items.filter((i) => i.componentId && Number(i.amount) > 0).map((i) => ({ componentId: i.componentId, amount: Number(i.amount), reason: i.reason || null })),
      });
      notify.success(`Saved for ${name}.`);
      onChanged();
    } catch (e) {
      notify.error(errorWords(e, "save the extra pay"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 min-w-0">
          <input
            type="checkbox"
            className="ui-checkbox"
            checked={included}
            disabled={!editable}
            aria-label={`Include ${name} in this payroll`}
            onChange={(e) =>
              setRunEmployeeIncluded(runId, member.employeeId, e.target.checked)
                .then(onChanged)
                .catch((err) => notify.error(errorWords(err, "change the extra pay")))
            }
          />
          <span className="truncate">{name}</span>
          {member.employee?.code ? <span className="ui-caption">{member.employee.code}</span> : null}
        </label>
        <div className="flex items-center gap-2">
          <label className="ui-caption" htmlFor={`pays-${member.employeeId}`}>
            Pays
          </label>
          <select
            id={`pays-${member.employeeId}`}
            className="ui-select"
            value={pays}
            disabled={!editable}
            onChange={(e) => setPays(e.target.value)}
          >
            <option value="EXTRA">{PAYS_LABEL.EXTRA}</option>
            <option value="SALARY">{PAYS_LABEL.SALARY}</option>
          </select>
        </div>
      </div>
      <p className="ui-caption">
        {pays === "SALARY"
          ? "Their days this month, worked out as on any payroll (a late joiner). Days are set under Days; anything below is paid on top."
          : "Only the amounts below. PF, ESI, professional tax and income tax are worked out on top of this month's salary, never taken twice."}
      </p>
      {items.map((item, n) => (
        <div key={n} className="grid grid-cols-1 sm:grid-cols-[1fr_9rem_1fr_auto] gap-2 items-end">
          <div>
            <label className="ui-label" htmlFor={`extra-${member.employeeId}-${n}-c`}>
              For
            </label>
            <select
              id={`extra-${member.employeeId}-${n}-c`}
              className="ui-select w-full"
              value={item.componentId}
              disabled={!editable}
              onChange={(e) => set(n, { componentId: e.target.value })}
            >
              <option value="">Choose a pay component</option>
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor={`extra-${member.employeeId}-${n}-a`}>
              Amount
            </label>
            <input
              id={`extra-${member.employeeId}-${n}-a`}
              className="ui-input w-full tabular-nums text-right"
              inputMode="decimal"
              value={item.amount}
              disabled={!editable}
              onChange={(e) => set(n, { amount: e.target.value.replace(/[^0-9.]/g, "") })}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor={`extra-${member.employeeId}-${n}-r`}>
              Note
            </label>
            <input
              id={`extra-${member.employeeId}-${n}-r`}
              className="ui-input w-full"
              value={item.reason}
              maxLength={200}
              placeholder="Arrears for April to June"
              disabled={!editable}
              onChange={(e) => set(n, { reason: e.target.value })}
            />
          </div>
          {editable ? (
            <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setItems((list) => list.filter((_, i) => i !== n))}>
              Remove
            </button>
          ) : null}
        </div>
      ))}
      {editable ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setItems((list) => [...list, blankItem()])}>
            <Plus size={14} aria-hidden="true" /> Add an amount
          </button>
          <div className="flex items-center gap-3">
            {total > 0 ? <span className="ui-caption tabular-nums">{money(total)} in all</span> : null}
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={save}>
              Save
            </button>
          </div>
        </div>
      ) : total > 0 ? (
        <p className="ui-caption tabular-nums">{money(total)} in all</p>
      ) : null}
    </li>
  );
};

const ExtraPayStage = ({ data, editable, runId, onChanged }) => {
  const [people, setPeople] = useState([]);
  const [components, setComponents] = useState([]);
  const [adding, setAdding] = useState("");
  const [addPays, setAddPays] = useState("EXTRA");

  useEffect(() => {
    let alive = true;
    /* Everybody, leavers included: arrears often go to somebody who has left. */
    listEmployees({})
      .then((r) => alive && setPeople(r.employees))
      .catch(() => alive && setPeople([]));
    listSalaryComponents({ type: "EARNING", activeOnly: true })
      .then((rows) => alive && setComponents(rows.filter((c) => c.type === "EARNING")))
      .catch(() => alive && setComponents([]));
    return () => {
      alive = false;
    };
  }, []);

  const inRun = useMemo(() => new Set(data.employees.map((m) => m.employeeId)), [data]);
  const addable = people.filter((p) => !inRun.has(p.id));

  const add = async () => {
    if (!adding) return;
    try {
      await saveExtraPay(runId, { employeeId: adding, pays: addPays, items: [] });
      setAdding("");
      onChanged();
    } catch (e) {
      notify.error(errorWords(e, "add that person"));
    }
  };

  return (
    <div className="space-y-3">
      <p className="ui-caption">
        An extra pay run pays only the people chosen here, beside this month's regular payroll. Its payslips say “Extra pay run”; it is approved, paid and posted to the books like any payroll.
      </p>
      {data.employees.length ? (
        <ul className="divide-y" style={{ borderColor: "rgb(var(--border))" }}>
          {data.employees.map((m) => (
            <PersonRow
              /* A new figure from the server remounts the row with it. */
              key={`${m.employeeId}:${m.pays}:${(m.extraPay || []).map((i) => `${i.id}`).join(",")}`}
              member={m}
              components={components}
              editable={editable}
              runId={runId}
              onChanged={onChanged}
            />
          ))}
        </ul>
      ) : (
        <p className="ui-caption">Nobody yet. Add the people this run is for.</p>
      )}
      {editable ? (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
          <div>
            <label className="ui-label" htmlFor="extra-add-person">
              Add a person
            </label>
            <select id="extra-add-person" className="ui-select w-full" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Choose somebody</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.code ? ` · ${p.code}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor="extra-add-pays">
              Pays
            </label>
            <select id="extra-add-pays" className="ui-select w-full" value={addPays} onChange={(e) => setAddPays(e.target.value)}>
              <option value="EXTRA">{PAYS_LABEL.EXTRA}</option>
              <option value="SALARY">{PAYS_LABEL.SALARY}</option>
            </select>
          </div>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={!adding} onClick={add}>
            <Plus size={14} aria-hidden="true" /> Add
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default ExtraPayStage;
