import React from 'react';

/** Who decides overtime and comp-off requests (AttendanceRule.overtimeApproval). */
export const CHAINS = {
  HR: 'HR decides',
  MANAGER: 'The manager decides (HR can still step in)',
  MANAGER_THEN_HR: 'The manager, then HR',
};

/**
 * The company's overtime and comp-off rules: one set of fields, shown in the
 * Overtime & Comp-Off screen's Rules drawer and on Overtime Policy, so both
 * edit the same settings the same way. Each change saves as it is made.
 */
export default function OvertimeRuleFields({ rules, types, save }) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={rules.overtimeRequests} onChange={(e) => save({ ...rules, overtimeRequests: e.target.checked })} />
        Employees can ask for their overtime to be approved
      </label>
      <label className="block">
        <span className="ui-label">Who decides overtime and comp-off</span>
        <select className="ui-input" value={rules.overtimeApproval} onChange={(e) => save({ ...rules, overtimeApproval: e.target.value })}>
          {Object.entries(CHAINS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={rules.compOffEnabled} disabled={!rules.compOffLeaveTypeId} onChange={(e) => save({ ...rules, compOffEnabled: e.target.checked })} />
        Give comp-off for work on a weekly off or holiday
      </label>
      <label className="block">
        <span className="ui-label">Comp-off days are added to</span>
        <select className="ui-input" value={rules.compOffLeaveTypeId || ''} onChange={(e) => save({ ...rules, compOffLeaveTypeId: e.target.value || null, compOffEnabled: e.target.value ? rules.compOffEnabled : false })}>
          <option value="">Choose a leave type</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="ui-caption">Use a leave type with no yearly days of its own (for example “Comp-off”), so its balance is only what was earned. A full day worked earns 1 day; a half day earns ½.</span>
      </label>
    </div>
  );
}
