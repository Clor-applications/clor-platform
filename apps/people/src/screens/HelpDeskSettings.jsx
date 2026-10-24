import React, { useEffect, useState } from 'react';
import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { deskCategories, deskTemplates, orgUsers, saveDeskCategory, saveDeskTemplate } from '../api/desk';
import { listPolicies } from '../api/policies';

/**
 * Help desk settings (DESK-03, DESK-06): each category's queue, lead,
 * reply-by hours and resolve-by working days; and the answer templates,
 * each of which may cite a policy — the version in force is named when
 * the answer is sent.
 */
export default function HelpDeskSettings() {
  const [cats, setCats] = useState(null);
  const [users, setUsers] = useState([]);
  const [templates, setTemplates] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [draft, setDraft] = useState(null);
  const load = () => {
    deskCategories().then(setCats).catch((e) => notify.error(String(e?.message || 'Could not load.')));
    deskTemplates().then(setTemplates).catch(() => setTemplates([]));
  };
  useEffect(() => {
    load();
    orgUsers().then(setUsers);
    listPolicies('', '').then((r) => setPolicies(r?.policies || [])).catch(() => setPolicies([]));
  }, []);
  const saveCat = async (c, patch) => {
    try {
      const r = await saveDeskCategory(c.key, patch);
      setCats((list) => list.map((x) => (x.key === c.key ? r.category : x)));
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
      load();
    }
  };
  const saveTpl = async (e) => {
    e.preventDefault();
    try {
      await saveDeskTemplate(draft);
      notify.success('Template saved.');
      setDraft(null);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  if (!cats || !templates) return <SkeletonCard lines={6} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Help desk" description="Each category sends a request to a queue with a reply-by and a resolve-by; overdue goes to the queue lead. Templates answer the common questions and cite the policy in force." />
      <section className="space-y-2" aria-label="Categories and times">
        <h3 className="ui-t-sec">Categories and times</h3>
        <table className="w-full text-sm">
          <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Category</th><th className="py-1.5 font-medium">Queue</th><th className="py-1.5 font-medium">Queue lead</th><th className="py-1.5 font-medium">Reply within (hours)</th><th className="py-1.5 font-medium">Resolve within (working days)</th><th className="py-1.5 font-medium">On</th></tr></thead>
          <tbody className="divide-y">
            {cats.map((c) => (
              <tr key={c.key}>
                <td className="py-1.5 pr-2"><input className="ui-input w-full" defaultValue={c.label} onBlur={(e) => e.target.value !== c.label && saveCat(c, { label: e.target.value })} aria-label={`${c.key} name`} /></td>
                <td className="py-1.5 pr-2"><input className="ui-input w-full" defaultValue={c.queue} onBlur={(e) => e.target.value !== c.queue && saveCat(c, { queue: e.target.value })} aria-label={`${c.key} queue`} /></td>
                <td className="py-1.5 pr-2">
                  {users.length ? (
                    <select className="ui-select w-full" value={c.leadUserId || ''} onChange={(e) => saveCat(c, { leadUserId: e.target.value || null })} aria-label={`${c.key} lead`}>
                      <option value="">Nobody</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.name || u.email}</option>)}
                    </select>
                  ) : <span className="ui-muted">Needs the Users grant</span>}
                </td>
                <td className="py-1.5 pr-2"><input type="number" min={1} max={720} className="ui-input w-24 tabular-nums" defaultValue={c.replyHours} onBlur={(e) => Number(e.target.value) !== c.replyHours && saveCat(c, { replyHours: Number(e.target.value) })} aria-label={`${c.key} reply hours`} /></td>
                <td className="py-1.5 pr-2"><input type="number" min={1} max={90} className="ui-input w-24 tabular-nums" defaultValue={c.resolveDays} onBlur={(e) => Number(e.target.value) !== c.resolveDays && saveCat(c, { resolveDays: Number(e.target.value) })} aria-label={`${c.key} resolve days`} /></td>
                <td className="py-1.5"><input type="checkbox" className="ui-checkbox" checked={c.isActive} onChange={(e) => saveCat(c, { isActive: e.target.checked })} aria-label={`${c.key} on`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="space-y-2" aria-label="Answer templates">
        <div className="flex items-center justify-between gap-2">
          <h3 className="ui-t-sec">Answer templates</h3>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setDraft({ title: '', body: '', category: '', policyId: '' })}>New template</button>
        </div>
        {!templates.length ? <p className="ui-muted text-sm">None yet. A template is inserted into a reply with one click; if it cites a policy, the version in force that day is named.</p> : (
          <ul className="divide-y text-sm">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <span><span className="font-medium">{t.title}</span>{t.policyTitle ? <span className="ui-caption"> · cites {t.policyTitle}</span> : null}{t.category ? <span className="ui-caption"> · {t.category}</span> : null}</span>
                <button type="button" className="ui-link" onClick={() => setDraft({ id: t.id, title: t.title, body: t.body, category: t.category || '', policyId: t.policyId || '' })}>Edit</button>
              </li>
            ))}
          </ul>
        )}
        {draft ? (
          <form onSubmit={saveTpl} className="ui-card p-3 grid gap-3">
            <label className="block"><span className="ui-label">Title *</span><input className="ui-input w-full" required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <label className="block"><span className="ui-label">Answer *</span><textarea className="ui-input w-full" rows={5} required value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="ui-label">For category</span>
                <select className="ui-select w-full" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}><option value="">Any</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
              </label>
              <label className="block"><span className="ui-label">Cites policy</span>
                <select className="ui-select w-full" value={draft.policyId} onChange={(e) => setDraft({ ...draft, policyId: e.target.value })}><option value="">None</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
              </label>
            </div>
            <div className="flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="ui-btn ui-btn-primary">Save</button></div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
