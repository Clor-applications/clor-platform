import React, { useMemo, useRef, useState } from 'react';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import { SkeletonCard } from '@ui/components/ui/Primitives';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { rupees } from '@ui/referrals/words';
import { structure } from '../workforce/api';
import { listBranches } from '../organization/api';
import { getReferralSettings, saveReferralSettings } from '../api/talent';
import { FormError, Footer, SHEET } from './shared';

/**
 * An opening's referrals (A20): open to referrals or not, the bonus and when it is paid (after N
 * days, or when probation ends), who may refer (everyone, some departments, some branches), and
 * whether staff may apply themselves. Turning it on for an open job tells the staff who may refer.
 */
const AUDIENCE = [['ALL', 'Everyone'], ['DEPARTMENTS', 'Some departments'], ['BRANCHES', 'Some branches']];

/** The opening drawer's Referrals block: what is set, and Change. */
export function ReferralBlock({ opening, onChanged }) {
  const req = useRequest(() => getReferralSettings(opening.id), [opening.id]);
  const [editing, setEditing] = useState(false);
  const s = req.data;
  const words = !s ? '' : [
    s.referralOpen ? 'Open to referrals' : 'Not open to referrals',
    s.referralOpen && s.hasBonus ? `bonus ${s.referralBonus != null ? rupees(s.referralBonus) : 'set'} ${s.referralBonusDays ? `after ${s.referralBonusDays} days` : 'at the end of probation'}` : null,
    s.referralOpen ? (s.referAudience === 'ALL' ? 'everyone may refer' : s.referAudience === 'DEPARTMENTS' ? 'some departments may refer' : 'some branches may refer') : null,
    s.internalApply ? 'staff may apply' : null,
  ].filter(Boolean).join(' · ');
  return (
    <section className="space-y-2 border-t pt-3" style={{ borderColor: 'rgb(var(--border))' }} aria-label="Referrals">
      <p className="ui-label">Referrals</p>
      {req.error ? <ErrorState error={req.error} compact onRetry={req.reload} /> : !s ? <p className="text-sm ui-muted">Loading…</p> : (
        <>
          <p className="text-sm">{words}</p>
          {['FILLED', 'CLOSED'].includes(opening.status) ? null : (
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditing(true)}>{s.referralOpen || s.internalApply ? 'Change' : 'Open to referrals'}</button>
          )}
        </>
      )}
      {editing && s ? <ReferralSettings opening={opening} value={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); req.reload(); onChanged?.(); }} /> : null}
    </section>
  );
}

export default function ReferralSettings({ opening, value, onClose, onSaved }) {
  const lists = useRequest(() => Promise.all([structure('departments').catch(() => []), listBranches().catch(() => [])]), []);
  const [departments, branches] = lists.data || [[], []];
  const initial = useMemo(() => ({
    referralOpen: value.referralOpen || !value.internalApply,
    bonus: value.referralBonus != null ? String(value.referralBonus) : '',
    when: value.referralBonusDays ? 'DAYS' : 'PROBATION',
    days: value.referralBonusDays ? String(value.referralBonusDays) : '90',
    referAudience: value.referAudience || 'ALL',
    referDepartmentIds: value.referDepartmentIds || [],
    referBranchIds: value.referBranchIds || [],
    internalApply: Boolean(value.internalApply),
  }), [value]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const toggle = (key, id) => set({ [key]: form[key].includes(id) ? form[key].filter((x) => x !== id) : [...form[key], id] });
  const save = async () => {
    if (inFlight.current) return;
    if (form.referAudience === 'DEPARTMENTS' && !form.referDepartmentIds.length) { setError({ message: 'Pick the departments whose people may refer.' }); return; }
    if (form.referAudience === 'BRANCHES' && !form.referBranchIds.length) { setError({ message: 'Pick the branches whose people may refer.' }); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await saveReferralSettings(opening.id, {
        referralOpen: form.referralOpen, internalApply: form.internalApply,
        referralBonus: form.bonus.trim() ? Number(form.bonus) : null,
        referralBonusDays: form.when === 'DAYS' ? Number(form.days) || null : null,
        referAudience: form.referAudience, referDepartmentIds: form.referDepartmentIds, referBranchIds: form.referBranchIds,
      });
      const telling = opening.status === 'OPEN' && ((form.referralOpen && !value.referralOpen) || (form.internalApply && !value.internalApply));
      notify.success(telling ? 'Saved. The staff who may refer are told.' : 'Saved.');
      onSaved();
    } catch (e) { setError(e); } finally { inFlight.current = false; setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={dirty} title={`Referrals for ${opening.title}`}
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} busyLabel="Saving…" label="Save" disabled={!dirty} />}>
      {lists.loading && !lists.data ? <SkeletonCard lines={5} /> : (
        <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <FormError error={error} />
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="ui-checkbox" checked={form.referralOpen} onChange={(e) => set({ referralOpen: e.target.checked })} />Staff may refer people for this job</label>
          {form.referralOpen ? (
            <>
              <label className="block"><span className="ui-label">Referral bonus (₹)</span><input className="ui-input w-full tabular-nums" inputMode="decimal" placeholder="No bonus" value={form.bonus} onChange={(e) => set({ bonus: e.target.value.replace(/[^\d.]/g, '').slice(0, 9) })} /></label>
              <fieldset className="block">
                <legend className="ui-label">Paid when the hire</legend>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="bonus-when" checked={form.when === 'PROBATION'} onChange={() => set({ when: 'PROBATION' })} />finishes probation</label>
                  <label className="flex items-center gap-2"><input type="radio" name="bonus-when" checked={form.when === 'DAYS'} onChange={() => set({ when: 'DAYS' })} />has stayed</label>
                  {form.when === 'DAYS' ? <span className="flex items-center gap-2"><input className="ui-input w-20 tabular-nums" inputMode="numeric" aria-label="Days" value={form.days} onChange={(e) => set({ days: e.target.value.replace(/\D/g, '').slice(0, 3) })} />days</span> : null}
                </div>
              </fieldset>
              <fieldset className="block sm:col-span-2">
                <legend className="ui-label">Who may refer</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                  {AUDIENCE.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="radio" name="refer-audience" checked={form.referAudience === k} onChange={() => set({ referAudience: k })} />{l}</label>)}
                </div>
              </fieldset>
              {form.referAudience === 'DEPARTMENTS' ? (
                <fieldset className="block sm:col-span-2"><legend className="ui-label">Departments</legend>
                  {!departments.length ? <p className="text-sm ui-muted">No departments yet.</p> : <div className="grid gap-2 text-sm sm:grid-cols-2">{departments.map((d) => <label key={d.id} className="flex items-center gap-2"><input type="checkbox" className="ui-checkbox" checked={form.referDepartmentIds.includes(d.id)} onChange={() => toggle('referDepartmentIds', d.id)} />{d.name}</label>)}</div>}
                </fieldset>
              ) : null}
              {form.referAudience === 'BRANCHES' ? (
                <fieldset className="block sm:col-span-2"><legend className="ui-label">Branches</legend>
                  <div className="grid gap-2 text-sm sm:grid-cols-2">{branches.map((b) => <label key={b.id} className="flex items-center gap-2"><input type="checkbox" className="ui-checkbox" checked={form.referBranchIds.includes(b.id)} onChange={() => toggle('referBranchIds', b.id)} />{b.branchName}</label>)}</div>
                </fieldset>
              ) : null}
            </>
          ) : null}
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="ui-checkbox" checked={form.internalApply} onChange={(e) => set({ internalApply: e.target.checked })} />Staff may apply for it themselves</label>
          {opening.status !== 'OPEN' ? <p className="text-sm ui-muted sm:col-span-2">The staff hear of it when the job is open.</p> : null}
        </form>
      )}
    </Drawer>
  );
}
