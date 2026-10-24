import React, { useEffect, useState } from 'react';
import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
import { listRules, retireRule, saveRule } from '../api/approvals';
import { orgUsers } from '../api/desk';

/**
 * Approval rules (APR-01, APR-02, APR-03): who decides what, in which
 * order, by when. One rule per kind of request; saving writes a new version
 * and the old ones stay readable, so a request shows the rule as it was.
 */

const TYPE_WORDS = {
  PROFILE_CHANGE: ['Personal detail changes', 'A person changes their own details from the app, or HR changes them for them.'],
  JOB_CHANGE: ['Job changes', 'Department, designation, manager, establishment, grade, type: a transfer or a promotion.'],
  LEAVING: ['Resignations and leaving', 'A resignation from the app, or a leaving HR records with a last day ahead.'],
  PROBATION: ['Probation decisions', 'Confirm, extend or end after probation.'],
  POLICY_PUBLISH: ['Publishing a policy', 'A new policy version going live.'],
  DOCUMENT_REQUEST: ['Document requests', 'A person asks for a document on their file.'],
  LETTER_REQUEST: ['Letter requests', 'A person asks for a letter.'],
  DESK_ESCALATION: ['Help desk escalations', 'A help desk request handed up.'],
  SEAT_REQUEST: ['Seat requests', 'A new seat on a team.'],
};
const APPROVERS = [['MANAGER', 'Their manager'], ['MANAGER_OF_MANAGER', 'Their manager’s manager'], ['HR', 'HR (anyone who may edit people)'], ['USER', 'A named person'], ['ROLE', 'Anyone holding a role']];
const FIELDS = [['departmentId', 'Department'], ['jobPositionId', 'Designation'], ['reportingManagerId', 'Reports to'], ['establishmentId', 'Establishment'], ['gradeId', 'Grade'], ['employeeTypeId', 'Employee type'], ['phone', 'Phone'], ['addressLine', 'Address'], ['dateOfBirth', 'Date of birth']];
const blankStep = (order) => ({ order, approver: { kind: 'MANAGER' }, condition: null, dueDays: 3, overdue: { action: 'REMIND' } });

const approverWords = (a, users, roles) => {
  if (!a) return '—';
  if (a.kind === 'USER') return users.find((u) => u.id === a.id)?.fullName || 'a named person';
  if (a.kind === 'ROLE') return `role: ${roles.find((r) => r.id === a.id)?.name || a.id}`;
  return APPROVERS.find(([k]) => k === a.kind)?.[1] || a.kind;
};

export default function ApprovalRules() {
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => listRules().then(setData).catch((e) => notify.error(String(e?.message || 'Could not load.')));
  useEffect(() => {
    load();
    orgUsers().then(setUsers);
    apiFetch(`/orgs/${encodeURIComponent(orgId())}/roles`, { skipWarehouseHeader: true }).then((r) => setRoles(r?.roles || [])).catch(() => setRoles([]));
  }, []);
  if (!data) return <SkeletonCard lines={6} />;
  const active = (type) => data.rules.find((r) => r.requestType === type && r.active) || null;
  const versions = (type) => data.rules.filter((r) => r.requestType === type);
  const retire = async (type) => {
    if (!(await confirmDialog({ title: `Switch off the rule for ${TYPE_WORDS[type]?.[0] || type}?`, message: 'Requests of this kind then apply at once with no approval; earlier versions stay readable.', confirmLabel: 'Switch off' }))) return;
    try {
      await retireRule(type);
      notify.success('Switched off.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not changed.'));
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Approval rules" subtitle="Who decides what, in which order, by when. Saving a rule writes a new version; a request shows the version that decided it." />
      <table className="w-full text-sm">
        <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Kind of request</th><th className="py-1.5 font-medium">Rule</th><th className="py-1.5 font-medium">Steps</th><th className="py-1.5 font-medium">Version</th><th className="py-1.5 font-medium" /></tr></thead>
        <tbody className="divide-y">
          {data.requestTypes.map((t) => {
            const rule = active(t);
            return (
              <tr key={t}>
                <td className="py-2 pr-2"><span className="font-medium">{TYPE_WORDS[t]?.[0] || t}</span><span className="ui-caption block">{TYPE_WORDS[t]?.[1] || ''}</span></td>
                <td className="py-2 pr-2">{rule ? rule.name : <span className="ui-muted">None: applies at once</span>}</td>
                <td className="py-2 pr-2">{rule ? (rule.steps || []).map((s) => `${approverWords(s.approver, users, roles)} (${s.dueDays}d)`).join(' → ') : '—'}</td>
                <td className="py-2 pr-2 tabular-nums">{rule ? `v${rule.version}` : versions(t).length ? <span className="ui-muted">off (v{versions(t)[0].version} last)</span> : '—'}</td>
                <td className="py-2 text-right">
                  <button type="button" className="ui-link" onClick={() => setEditing({ requestType: t, name: rule?.name || `${TYPE_WORDS[t]?.[0] || t} rule`, steps: rule ? rule.steps.map((s, i) => ({ ...blankStep(i + 1), ...s, order: i + 1 })) : [blankStep(1)] })}>{rule ? 'Edit' : 'Set up'}</button>
                  {rule ? <button type="button" className="ui-link ml-3" onClick={() => retire(t)}>Switch off</button> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing ? <RuleDrawer rule={editing} users={users} roles={roles} versions={versions(editing.requestType)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
  );
}

function RuleDrawer({ rule, users, roles, versions, onClose, onSaved }) {
  const [form, setForm] = useState(rule);
  const [saving, setSaving] = useState(false);
  const setStep = (i, patch) => setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await saveRule({ requestType: form.requestType, name: form.name, steps: form.steps.map((s, i) => ({ ...s, order: i + 1, dueDays: Number(s.dueDays) || 1, condition: s.condition?.field ? s.condition : null })) });
      notify.success(`${r.rule.name} saved as version ${r.rule.version}.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  const approverPicker = (value, onChange, label) => (
    <span className="flex flex-wrap gap-1.5 items-center">
      <select className="ui-select" value={value?.kind || 'MANAGER'} onChange={(e) => onChange({ kind: e.target.value })} aria-label={label}>{APPROVERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {value?.kind === 'USER' ? <select className="ui-select" value={value.id || ''} onChange={(e) => onChange({ kind: 'USER', id: e.target.value })} aria-label={`${label}: person`}><option value="">— pick —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.email}</option>)}</select> : null}
      {value?.kind === 'ROLE' ? <select className="ui-select" value={value.id || ''} onChange={(e) => onChange({ kind: 'ROLE', id: e.target.value })} aria-label={`${label}: role`}><option value="">— pick —</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select> : null}
    </span>
  );
  return (
    <Drawer open onClose={onClose} title={`${TYPE_WORDS[form.requestType]?.[0] || form.requestType}: who decides`} description="Steps run in order; a step whose condition does not hold is skipped, and the person who asked never decides their own request. Overdue: remind, or hand on to someone else." widthClass="w-[min(44rem,96vw)]"
      actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="rule-form" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save as new version'}</button></>}>
      <form id="rule-form" onSubmit={save} className="space-y-4">
        <label className="block"><span className="ui-label">Rule name *</span><input className="ui-input w-full sm:max-w-md" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <ol className="space-y-3">
          {form.steps.map((s, i) => (
            <li key={i} className="ui-card p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ui-pill ui-pill-info">Step {i + 1}</span>
                {approverPicker(s.approver, (a) => setStep(i, { approver: a }), `Step ${i + 1} decides`)}
                <label className="flex items-center gap-1.5 text-sm ml-auto">within <input type="number" min={1} max={60} className="ui-input w-16 tabular-nums" value={s.dueDays} onChange={(e) => setStep(i, { dueDays: e.target.value })} aria-label={`Step ${i + 1} due days`} /> working days</label>
                {form.steps.length > 1 ? <button type="button" className="ui-link text-sm" onClick={() => setForm((f) => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))}>Remove</button> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="ui-label">Only when</span>
                <select className="ui-select" value={s.condition?.field || ''} onChange={(e) => setStep(i, { condition: e.target.value ? { field: e.target.value, op: s.condition?.op || 'changed', value: s.condition?.value || null } : null })} aria-label={`Step ${i + 1} condition field`}>
                  <option value="">always</option>
                  {FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {s.condition?.field ? (
                  <>
                    <select className="ui-select" value={s.condition.op} onChange={(e) => setStep(i, { condition: { ...s.condition, op: e.target.value } })} aria-label={`Step ${i + 1} condition`}>
                      <option value="changed">changes</option><option value="eq">becomes</option><option value="ne">is not</option>
                    </select>
                    {s.condition.op !== 'changed' ? <input className="ui-input" placeholder="value (id)" value={s.condition.value || ''} onChange={(e) => setStep(i, { condition: { ...s.condition, value: e.target.value } })} aria-label={`Step ${i + 1} condition value`} /> : null}
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="ui-label">If overdue</span>
                <select className="ui-select" value={s.overdue?.action || 'REMIND'} onChange={(e) => setStep(i, { overdue: { action: e.target.value, to: e.target.value === 'HAND_ON' ? s.overdue?.to || { kind: 'HR' } : undefined } })} aria-label={`Step ${i + 1} overdue`}>
                  <option value="REMIND">remind them</option><option value="HAND_ON">hand on to</option>
                </select>
                {s.overdue?.action === 'HAND_ON' ? approverPicker(s.overdue.to, (a) => setStep(i, { overdue: { action: 'HAND_ON', to: a } }), `Step ${i + 1} hand on to`) : null}
              </div>
            </li>
          ))}
        </ol>
        {form.steps.length < 8 ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setForm((f) => ({ ...f, steps: [...f.steps, blankStep(f.steps.length + 1)] }))}>Add a step</button> : null}
        {versions.length ? (
          <section>
            <h3 className="ui-t-sec">Versions</h3>
            <ul className="divide-y text-sm">{versions.map((v) => <li key={v.id} className="py-1.5">v{v.version} · {v.name}{v.active ? ' · in use' : ''} · {new Date(v.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })} · {(v.steps || []).length} step{(v.steps || []).length === 1 ? '' : 's'}</li>)}</ul>
          </section>
        ) : null}
      </form>
    </Drawer>
  );
}
