import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
import { listRules, retireRule, saveRule } from '../api/approvals';
import { orgUsers } from '../api/desk';
import { listEmployees, structure } from '../workforce/api';

/**
 * Approval rules (APR-01, APR-02, APR-03): who decides what, in which
 * order, by when. One rule per kind of request; saving writes a new version
 * and the old ones stay readable, so a request shows the rule as it was.
 * A condition names a real department, designation or person, never an id.
 */

const TYPE_WORDS = {
  PROFILE_CHANGE: ['Personal detail changes', 'A person changes their own details from the app, or HR changes them for them.'],
  JOB_CHANGE: ['Job changes', 'Department, designation, manager, work site, grade, type: a transfer or a promotion.'],
  LEAVING: ['Resignations and leaving', 'A resignation from the app, or a leaving HR records with a last day ahead.'],
  PROBATION: ['Probation decisions', 'Confirm, extend or end after probation.'],
  POLICY_PUBLISH: ['Publishing a policy', 'A new policy version going live.'],
  DOCUMENT_REQUEST: ['Document requests', 'A person asks for a document on their file.'],
  LETTER_REQUEST: ['Letter requests', 'A person asks for a letter.'],
  DESK_ESCALATION: ['Help desk escalations', 'A help desk request handed up.'],
  SEAT_REQUEST: ['Position requests', 'A new position on a team.'],
};
const APPROVERS = [['MANAGER', 'Their manager'], ['MANAGER_OF_MANAGER', 'Their manager’s manager'], ['HR', 'HR (anyone who may edit people)'], ['USER', 'A named person'], ['ROLE', 'Anyone holding a role']];
/* What a step can depend on; a field with a list says which list its value comes from. */
const FIELDS = [
  ['departmentId', 'Department', 'departments'], ['jobPositionId', 'Designation', 'job-positions'], ['reportingManagerId', 'Manager', 'people'],
  ['establishmentId', 'Work site', 'establishments'], ['gradeId', 'Grade', 'grades'], ['employeeTypeId', 'Employment type', 'employee-types'],
  ['phone', 'Phone', null], ['addressLine', 'Address', null], ['dateOfBirth', 'Date of birth', null],
];
const OPS = [['changed', 'changes'], ['eq', 'becomes'], ['ne', 'is not']];
const blankStep = (order) => ({ order, approver: { kind: 'MANAGER' }, condition: null, dueDays: 3, overdue: { action: 'REMIND' } });
const typeName = (t) => TYPE_WORDS[t]?.[0] || t;

const approverWords = (a, users, roles) => {
  if (!a) return '—';
  if (a.kind === 'USER') return users.find((u) => u.id === a.id)?.fullName || 'a named person';
  if (a.kind === 'ROLE') return `role ${roles.find((r) => r.id === a.id)?.name || ''}`.trim();
  return APPROVERS.find(([k]) => k === a.kind)?.[1] || a.kind;
};

export default function ApprovalRules() {
  const req = useRequest(() => Promise.all([
    listRules(),
    orgUsers(),
    apiFetch(`/orgs/${encodeURIComponent(orgId())}/roles`, { skipWarehouseHeader: true }).then((r) => r?.roles || []).catch(() => []),
  ]), []);
  const [data, users, roles] = req.data || [null, [], []];
  const [editing, setEditing] = useState(null);
  const active = (type) => data?.rules.find((r) => r.requestType === type && r.active) || null;
  const versions = (type) => (data?.rules || []).filter((r) => r.requestType === type);
  const open = (t) => {
    const rule = active(t);
    setEditing({ requestType: t, name: rule?.name || `${typeName(t)} rule`, steps: rule ? rule.steps.map((s, i) => ({ ...blankStep(i + 1), ...s, order: i + 1 })) : [blankStep(1)] });
  };
  const retire = async (type) => {
    if (!(await confirmDialog({ title: `Switch off the rule for ${typeName(type).toLowerCase()}?`, message: 'Requests of this kind then apply at once with no approval; earlier versions stay readable.', confirmLabel: 'Switch off' }))) return;
    try {
      await retireRule(type);
      notify.success('Switched off.');
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not changed.'));
    }
  };
  const steps = (rule) => (rule.steps || []).map((s) => `${approverWords(s.approver, users, roles)} (${s.dueDays} d)`).join(' → ');
  const columns = [
    { key: 'type', label: 'Kind of request', always: true, render: (t) => <span className="min-w-0"><span className="block font-medium">{typeName(t)}</span><span className="block ui-caption">{TYPE_WORDS[t]?.[1] || ''}</span></span> },
    { key: 'steps', label: 'Who decides', render: (t) => { const rule = active(t); return rule ? steps(rule) : <span className="ui-muted">Nobody: applies at once</span>; } },
    { key: 'version', label: 'Version', render: (t) => { const rule = active(t); const all = versions(t); return rule ? <span className="tabular-nums">v{rule.version}</span> : all.length ? <span className="ui-muted tabular-nums">Off (v{all[0].version} last)</span> : '—'; } },
  ];
  const rowActions = (t) => [
    { key: 'edit', label: active(t) ? 'Edit' : 'Set up', onSelect: () => open(t) },
    active(t) ? { key: 'off', label: 'Switch off', onSelect: () => retire(t) } : null,
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Approval Rules" />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable label="Approval rules" columns={columns} rows={data?.requestTypes || []} rowKey={(t) => t} loading={req.loading} refreshing={req.refreshing}
          total={data?.requestTypes?.length || 0} pageSize={Math.max(25, data?.requestTypes?.length || 0)} noun="kinds of request"
          onRowClick={open} rowActions={rowActions}
          card={(t) => { const rule = active(t); return <span className="min-w-0 flex-1"><span className="block truncate font-medium">{typeName(t)}</span><span className="block truncate ui-caption">{rule ? steps(rule) : 'Applies at once'}</span></span>; }}
          empty={<EmptyState title="No kinds of request" description="Reload; the kinds of request come with People." />} />
      )}
      {editing ? <RuleDrawer rule={editing} users={users} roles={roles} versions={versions(editing.requestType)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); req.reload(); }} /> : null}
    </div>
  );
}

function RuleDrawer({ rule, users, roles, versions, onClose, onSaved }) {
  const [form, setForm] = useState(rule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(rule);
  /* The values a condition can name: the company's own lists. */
  const lists = useRequest(async () => {
    const kinds = ['departments', 'job-positions', 'establishments', 'grades', 'employee-types'];
    const rows = await Promise.all(kinds.map((k) => structure(k).catch(() => [])));
    const people = await listEmployees({ limit: 500, status: 'CURRENT', sort: 'name' }).then((r) => r?.employees || []).catch(() => []);
    return { ...Object.fromEntries(kinds.map((k, i) => [k, rows[i].map((x) => ({ value: x.id, label: x.name }))])), people: people.map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name })) };
  }, []);
  const setStep = (i, patch) => setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const save = async () => {
    if (!form.name.trim()) { setError({ message: 'Give the rule a name.' }); return; }
    const bad = form.steps.findIndex((s) => (s.approver.kind === 'USER' || s.approver.kind === 'ROLE') && !s.approver.id);
    if (bad >= 0) { setError({ message: `Step ${bad + 1}: choose the ${form.steps[bad].approver.kind === 'USER' ? 'person' : 'role'}.` }); return; }
    const noValue = form.steps.findIndex((s) => s.condition?.field && s.condition.op !== 'changed' && !s.condition.value);
    if (noValue >= 0) { setError({ message: `Step ${noValue + 1}: choose what it becomes.` }); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await saveRule({ requestType: form.requestType, name: form.name.trim(), steps: form.steps.map((s, i) => ({ ...s, order: i + 1, dueDays: Number(s.dueDays) || 1, condition: s.condition?.field ? s.condition : null })) });
      notify.success(`${r.rule.name} saved as version ${r.rule.version}.`);
      onSaved();
    } catch (err) { setError(err); } finally { setSaving(false); }
  };
  const approverPicker = (value, onChange, label) => (
    <>
      <div><PopupSelect showValueSubtext={false} label={label} value={value?.kind || 'MANAGER'} onChange={(v) => onChange({ kind: v || 'MANAGER' })} options={APPROVERS.map(([k, l]) => ({ value: k, label: l }))} /></div>
      {value?.kind === 'USER' ? <div><PopupSelect showValueSubtext={false} label="Person" value={value.id || ''} placeholder="Choose…" alwaysSearch onChange={(v) => onChange({ kind: 'USER', id: v || '' })} options={users.map((u) => ({ value: u.id, label: u.fullName || u.email }))} /></div> : null}
      {value?.kind === 'ROLE' ? <div><PopupSelect showValueSubtext={false} label="Role" value={value.id || ''} placeholder="Choose…" onChange={(v) => onChange({ kind: 'ROLE', id: v || '' })} options={roles.map((r) => ({ value: r.id, label: r.name }))} /></div> : null}
    </>
  );
  return (
    <Drawer open onClose={onClose} title={`${typeName(form.requestType)}: who decides`} widthClass="w-[min(44rem,96vw)] ui-drawer-sheet" dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving…' : 'Save as new version'}</button></>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /> : null}
        <label className="block"><span className="ui-label">Rule name *</span><input className="ui-input w-full" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <ol className="divide-y border-t" aria-label="Steps">
          {form.steps.map((s, i) => {
            const field = FIELDS.find(([k]) => k === s.condition?.field);
            const ops = field?.[2] ? OPS : OPS.slice(0, 1);
            return (
              <li key={i} className="py-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="ui-t-sec">Step {i + 1}</h3>
                  {form.steps.length > 1 ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setForm((f) => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))}>Remove</button> : null}
                </div>
                <div className="ui-form-grid">
                  {approverPicker(s.approver, (a) => setStep(i, { approver: a }), 'Decides')}
                  <label className="block"><span className="ui-label">Within (working days)</span><input className="ui-input w-full tabular-nums" inputMode="numeric" value={s.dueDays} onChange={(e) => setStep(i, { dueDays: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></label>
                </div>
                <div className="ui-form-grid">
                  <div><PopupSelect showValueSubtext={false} label="Only when" value={s.condition?.field || ''} placeholder="Always" onChange={(v) => setStep(i, { condition: v ? { field: v, op: 'changed', value: null } : null })} options={[{ value: '', label: 'Always' }, ...FIELDS.map(([k, l]) => ({ value: k, label: `${l} changes` }))]} /></div>
                  {field ? <div><PopupSelect showValueSubtext={false} label="How" value={s.condition.op} onChange={(v) => setStep(i, { condition: { ...s.condition, op: v || 'changed', value: v === 'changed' ? null : s.condition.value } })} options={ops.map(([k, l]) => ({ value: k, label: `${field[1]} ${l}` }))} /></div> : null}
                  {field?.[2] && s.condition.op !== 'changed' ? <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label={s.condition.op === 'eq' ? 'Becomes' : 'Is not'} value={s.condition.value || ''} placeholder={lists.data ? 'Choose…' : 'Loading…'} alwaysSearch onChange={(v) => setStep(i, { condition: { ...s.condition, value: v || null } })} options={lists.data?.[field[2]] || []} /></div> : null}
                </div>
                <div className="ui-form-grid">
                  <div><PopupSelect showValueSubtext={false} label="If overdue" value={s.overdue?.action || 'REMIND'} onChange={(v) => setStep(i, { overdue: { action: v || 'REMIND', to: v === 'HAND_ON' ? s.overdue?.to || { kind: 'HR' } : undefined } })} options={[{ value: 'REMIND', label: 'Remind them' }, { value: 'HAND_ON', label: 'Hand it on' }]} /></div>
                  {s.overdue?.action === 'HAND_ON' ? approverPicker(s.overdue.to, (a) => setStep(i, { overdue: { action: 'HAND_ON', to: a } }), 'Hand on to') : null}
                </div>
              </li>
            );
          })}
        </ol>
        {form.steps.length < 8 ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setForm((f) => ({ ...f, steps: [...f.steps, blankStep(f.steps.length + 1)] }))}><Plus size={16} aria-hidden="true" /> Add a step</button> : null}
        {versions.length ? (
          <section className="space-y-2">
            <h3 className="ui-t-sec">Versions</h3>
            <ul className="divide-y border-t text-sm">{versions.map((v) => <li key={v.id} className="py-2 flex flex-wrap gap-x-2"><span className="tabular-nums font-medium">v{v.version}</span><span>{v.name}</span>{v.active ? <span className="ui-pill ui-pill-pos">In use</span> : null}<span className="ui-caption ms-auto tabular-nums">{formatDate(new Date(new Date(v.createdAt).getTime() + 330 * 60_000).toISOString().slice(0, 10))} · {(v.steps || []).length} {(v.steps || []).length === 1 ? 'step' : 'steps'}</span></li>)}</ul>
          </section>
        ) : null}
      </form>
    </Drawer>
  );
}

