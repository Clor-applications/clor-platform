import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, Minus } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { getMappingAudit, getPortalAccess, getReaderHealth, getRules, listDevices, listEmployees, listHolidays, listLeaveTypes, listShifts, todayIst } from '../api/attendance';

/**
 * Getting attendance running, as a checklist rather than a wizard (as Payroll
 * does it): people, reader IDs, a shift, holidays, a reader, the first punch,
 * leave and the employee portal. Every step is worked out from what is really
 * there, so it cannot say "done" about a company where it is not; each opens
 * the screen that does it. A company whose staff punch only from phones is not
 * asked for a reader: that step turns optional. A step this person cannot see is marked so, not
 * guessed.
 */
const settle = (p) => p.then((v) => ({ ok: true, v })).catch(() => ({ ok: false }));

export default function AttendanceSetup({ openScreen }) {
  const [steps, setSteps] = useState(null);
  const load = useCallback(async () => {
    const year = Number(todayIst().slice(0, 4));
    const [people, audit, shifts, rules, holidays, devices, health, leave, portal] = await Promise.all([
      settle(listEmployees()),
      settle(getMappingAudit()),
      settle(listShifts()),
      settle(getRules()),
      settle(listHolidays(year)),
      settle(listDevices()),
      settle(getReaderHealth()),
      settle(listLeaveTypes()),
      settle(getPortalAccess()),
    ]);
    const readers = devices.ok ? (devices.v?.devices || []).filter((d) => d.vendor !== 'MOBILE') : [];
    const heard = readers.filter((d) => d.lastSeenAt);
    const lastPunch = health.ok ? (health.v?.readers || []).map((r) => r.lastPunchAt).filter(Boolean).sort().at(-1) : null;
    const portalOn = portal.ok ? (portal.v?.employees || []).filter((e) => e.activated || e.mobilePunch).length : 0;
    /* Phone punches arrive through one "Phone punches" device, made by the first one (services/attendance/phonePunch.ts). */
    const phonePunched = devices.ok && (devices.v?.devices || []).some((d) => d.vendor === 'MOBILE');
    const phoneAllowed = portal.ok && (portal.v?.employees || []).some((e) => e.mobilePunch);
    /* A company that punches only from phones needs no reader (PRODUCT-VIEW §2 A5): the reader step is optional and the first punch may be a phone's. */
    const phoneOnly = !readers.length && (phonePunched || phoneAllowed);
    setSteps([
      { key: 'people', title: 'Add your people', blurb: 'Everyone whose attendance is kept, with an employee code.', can: people.ok, done: people.ok && people.v.length > 0, detail: people.ok ? `${people.v.length} people` : null, screen: people.ok && !people.v.length ? 'dataImport' : 'employees' },
      { key: 'ids', title: 'Give each person their reader ID', blurb: 'The number they are enrolled under on the readers, so punches find them.', can: audit.ok, done: audit.ok && audit.v.counts.noPin === 0 && people.ok && people.v.length > 0, detail: audit.ok ? (audit.v.counts.noPin ? `${audit.v.counts.noPin} without an ID` : 'Everyone has one') : null, screen: 'idMapping' },
      { key: 'shifts', title: 'Set the working hours', blurb: 'At least one shift, and the default for anyone without a schedule.', can: shifts.ok && rules.ok, done: shifts.ok && shifts.v.some((s) => s.isActive) && rules.ok && Boolean(rules.v?.defaultShiftId), detail: shifts.ok ? `${shifts.v.length} shift${shifts.v.length === 1 ? '' : 's'}${rules.ok && rules.v?.defaultShiftId ? ', default set' : ', no default yet'}` : null, screen: shifts.ok && shifts.v.length ? 'rules' : 'shifts' },
      { key: 'holidays', title: `Add ${year}'s holidays`, blurb: 'Paid days off; worked holidays count as overtime.', can: holidays.ok, done: holidays.ok && holidays.v.length > 0, detail: holidays.ok ? `${holidays.v.length} this year` : null, screen: 'holidays' },
      { key: 'reader', title: phoneOnly ? 'Connect a reader (optional)' : 'Connect a reader', blurb: phoneOnly ? 'Your staff punch from their phones, so a reader is not needed. Add one if you get a biometric device.' : 'Point the reader’s cloud server (ADMS) at Clor, or add a connector on site. Punching only from phones? Allow phone punches under Employee Portal Access and this step becomes optional.', can: devices.ok, done: heard.length > 0, optional: phoneOnly, detail: devices.ok ? (readers.length ? `${heard.length} of ${readers.length} reader${readers.length === 1 ? '' : 's'} connected` : 'No reader added') : null, screen: 'readers' },
      { key: 'punch', title: 'See the first punch arrive', blurb: phoneOnly ? 'One real punch from a phone, inside a punch area, proves the whole chain works.' : 'One real punch, matched to a person, proves the whole chain works.', can: health.ok || phoneOnly, done: Boolean(lastPunch) || phonePunched, detail: lastPunch ? `Last punch ${new Date(lastPunch).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : phonePunched ? 'Phone punches are arriving' : 'None yet', screen: phoneOnly ? 'phonePunches' : 'transactions' },
      { key: 'leave', title: 'Set up leave types', blurb: 'Casual, sick, earned: what people may take and how it accrues.', can: leave.ok, done: leave.ok && leave.v.length > 0, detail: leave.ok ? `${leave.v.length} type${leave.v.length === 1 ? '' : 's'}` : null, screen: 'leaveTypes' },
      { key: 'portal', title: 'Open the employee portal (optional)', blurb: 'People see their days, ask for corrections and leave, and punch from their phone where you allow it.', can: portal.ok, done: portalOn > 0, optional: true, detail: portal.ok ? `${portalOn} people using it` : null, screen: 'portalAccess' },
    ]);
  }, []);
  useEffect(() => {
    /* load() sets state only after its requests resolve. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!steps) return <div className="space-y-3"><PageHeader entity="settings" title="Attendance setup" /><div className="pb-8 max-w-3xl"><SkeletonCard lines={8} /></div></div>;
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && s.can);
  return (
    <div className="space-y-3">
      <PageHeader
        entity="settings"
        title="Attendance setup"
        description={done === required.length ? 'Everything needed is in place.' : `${done} of ${required.length} done. Do them in any order; each step checks what is really there.`}
        actions={next && openScreen ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => openScreen(next.screen)}>{next.title} <ArrowRight size={16} aria-hidden="true" /></button> : null}
      />
      <div className="pb-8 space-y-6 max-w-3xl">
      <ol className="ui-card overflow-hidden divide-y">
        {steps.map((s, i) => (
          <li key={s.key} className="ui-setup-step" data-done={s.done || undefined}>
            <span className="ui-setup-mark" aria-hidden="true">{s.done ? <Check size={13} /> : !s.can ? <Minus size={13} /> : i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{s.title}</span>
                <span className={`ui-pill ${s.done ? 'ui-pill-pos' : s.can ? 'ui-pill-neutral' : 'ui-pill-outline'}`}>{s.done ? 'Done' : !s.can ? 'Not visible to you' : s.optional ? 'Optional' : 'To do'}</span>
              </div>
              <p className="ui-caption">{s.blurb}</p>
              {s.detail ? <p className="ui-caption">{s.detail}</p> : null}
            </div>
            {openScreen && s.can ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm shrink-0" onClick={() => openScreen(s.screen)}>{s.done ? 'Review' : 'Set up'}</button> : null}
          </li>
        ))}
      </ol>
      </div>
    </div>
  );
}
