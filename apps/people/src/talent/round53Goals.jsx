import React, { useState } from 'react';
import { Plus } from '@ui/components/ui/lineIcons';
import Drawer from '@ui/components/ui/Drawer';
import DatePicker from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createCompanyGoal, listCompanyGoals, updateCompanyGoal } from '../api/talent';
import { FormError, Footer, SHEET, day } from './shared';

/*
 * Round 53 picks that needed the server (goals): company goals shown over the Goals list, people's
 * goals linked to one; who sees a goal ("Only me and my manager"); a manager's goal for the team;
 * and the score the goals give beside a review's rating.
 */

export function useCompanyGoals() {
  const req = useRequest(() => listCompanyGoals().catch(() => ({ goals: [], canEdit: false })), []);
  return { goals: req.data?.goals || [], canEdit: Boolean(req.data?.canEdit), reload: req.reload, loaded: Boolean(req.data) };
}

/** The company goals over the Goals list: each with how far its linked goals have come. HR adds and closes them. */
export function CompanyGoals({ state }) {
  const { goals, canEdit, reload, loaded } = state;
  const [editing, setEditing] = useState(null);
  if (!loaded || (!goals.length && !canEdit)) return null;
  const close = async (g, status) => {
    if (!(await confirmDialog({ title: status === 'DONE' ? `Mark "${g.title}" done?` : `Drop "${g.title}"?`, message: 'It leaves the strip. Goals linked to it keep the link.', confirmLabel: status === 'DONE' ? 'Mark done' : 'Drop', tone: status === 'DONE' ? 'neutral' : 'danger' }))) return;
    try { await updateCompanyGoal(g.id, { status }); notify.success('Saved.'); reload(); } catch (e) { notify.error(String(e?.message || 'Not saved.')); }
  };
  return (
    <section aria-label="Company goals" className="ui-company-goals">
      <div className="flex items-center justify-between gap-2">
        <h2 className="ui-label">Company goals</h2>
        {canEdit ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setEditing({})}><Plus size={16} aria-hidden="true" /> Add</button> : null}
      </div>
      {!goals.length ? <p className="text-sm ui-muted">None set. Add the few things the company is working towards; people's goals can link to one.</p> : (
        <ul className="ui-company-goals-list">
          {goals.map((g) => (
            <li key={g.id} className="ui-company-goal">
              <span className="block font-medium">{g.title}</span>
              <span className="block ui-caption tabular-nums">
                {[g.dueDate ? `by ${day(g.dueDate)}` : null, g.linkedGoals ? `${g.linkedGoals} goal${g.linkedGoals === 1 ? '' : 's'} linked, ${g.progress}% on average` : 'No goals linked yet'].filter(Boolean).join(' · ')}
              </span>
              {g.linkedGoals ? <span className="ui-company-goal-bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, g.progress || 0))}%` }} /></span> : null}
              {canEdit ? (
                <span className="flex gap-2 pt-1">
                  <button type="button" className="ui-link text-xs" onClick={() => setEditing(g)}>Edit</button>
                  <button type="button" className="ui-link text-xs" onClick={() => close(g, 'DONE')}>Mark done</button>
                  <button type="button" className="ui-link text-xs" onClick={() => close(g, 'DROPPED')}>Drop</button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? <CompanyGoalForm value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
    </section>
  );
}

function CompanyGoalForm({ value, onClose, onSaved }) {
  const [form, setForm] = useState({ title: value.title || '', measure: value.measure || '', dueDate: value.dueDate || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    if (!form.title.trim()) { setError({ message: 'Say what the company goal is.' }); return; }
    setBusy(true);
    setError(null);
    const body = { title: form.title.trim(), measure: form.measure.trim() || null, dueDate: form.dueDate || null };
    try { if (value.id) await updateCompanyGoal(value.id, body); else await createCompanyGoal(body); notify.success('Company goal saved.'); onSaved(); } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={Boolean(form.title.trim()) && form.title !== (value.title || '')} title={value.id ? 'Edit company goal' : 'New company goal'}
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label="Save" />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (!busy) save(); }}>
        <FormError error={error} />
        <label className="block sm:col-span-2"><span className="ui-label">Company goal *</span><input className="ui-input w-full" autoFocus maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Grow revenue by 20%" /></label>
        <label className="block sm:col-span-2"><span className="ui-label">Measured by</span><input className="ui-input w-full" maxLength={300} value={form.measure} onChange={(e) => setForm({ ...form, measure: e.target.value })} /></label>
        <div><label className="ui-label" htmlFor="company-goal-due">By</label><DatePicker id="company-goal-due" value={form.dueDate} onChange={(d) => setForm({ ...form, dueDate: d || '' })} /></div>
      </form>
    </Drawer>
  );
}

/** The small marks after a goal's title: a team goal, one kept to the person and their manager, a teammate's (read only). */
export function GoalMarks({ goal }) {
  return (
    <>
      {goal.forTeam ? <span className="ui-pill ui-pill-info">Team goal</span> : null}
      {goal.visibility === 'PRIVATE' ? <span className="ui-pill ui-pill-neutral">Only them and their manager</span> : null}
      {goal.peer ? <span className="ui-pill ui-pill-neutral">Teammate</span> : null}
    </>
  );
}

/** "Goals say 3.8 (70% done, weighted)": a suggestion beside the rating, never the rating itself. */
export function GoalScore({ score }) {
  if (!score) return null;
  return (
    <p className="ui-caption tabular-nums" aria-label="Score from goals">
      Goals say <span className="font-medium">{score.score.toFixed(1)}</span> ({score.progress}% done across {score.goals} goal{score.goals === 1 ? '' : 's'}{score.weighted ? ', by weight' : ''})
    </p>
  );
}
