import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/**
 * Compliance (COMP-01..06): what the company owes, worked out from its
 * establishments and headcount, each with its source, proof and owner; and
 * the rule library behind it, every rule versioned and either checked by a
 * named person or marked "Check with your adviser". No score, anywhere.
 */

const base = () => `/orgs/${encodeURIComponent(orgId())}/people/compliance`;
const opts = { skipWarehouseHeader: true };
const STATUS = { UPCOMING: ['Upcoming', 'ui-pill-neutral'], DUE: ['Due', 'ui-pill-warn'], OVERDUE: ['Overdue', 'ui-pill-neg'], DONE: ['Done', 'ui-pill-pos'], CHECKED: ['Checked', 'ui-pill-pos'] };
const TABS = [['', 'All'], ['OVERDUE', 'Overdue'], ['DUE', 'Due'], ['UPCOMING', 'Upcoming'], ['DONE', 'Done']];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dueWords = (r) => ({ STANDING: 'Standing duty', MONTHLY: `Monthly, by day ${r.day}`, ANNUAL: `Yearly, by ${r.day} ${MONTHS[(r.month || 1) - 1]}`, HALF_YEARLY: `Half-yearly, by ${r.day} ${(r.months || []).map((m) => MONTHS[m - 1]).join(' and ')}`, ONCE: `Once, ${r.days} days after the establishment opens` }[r?.kind] || r?.kind || '');

export default function Compliance() {
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const [view, setView] = useState('obligations');
  const [status, setStatus] = useState('');
  const [obligations, setObligations] = useState(null);
  const [rules, setRules] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => {
    apiFetch(`${base()}/obligations${status ? `?status=${status}` : ''}`, opts).then((r) => setObligations(r?.obligations || [])).catch((e) => notify.error(String(e?.message || 'Could not load.')));
    apiFetch(`${base()}/rules?all=1`, opts).then((r) => setRules(r?.rules || [])).catch(() => setRules([]));
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const act = async (o, body, ok) => {
    try {
      await apiFetch(`${base()}/obligations/${encodeURIComponent(o.id)}`, { ...opts, method: 'PATCH', body });
      notify.success(ok);
      setOpen(null);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const check = async (r) => {
    try {
      await apiFetch(`${base()}/rules/${encodeURIComponent(r.ruleId)}/versions/${r.version}/check`, { ...opts, method: 'POST', body: {} });
      notify.success('Marked as checked by you.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Compliance" subtitle="What the company owes, from its establishments and headcount: each item with its legal source, the proof it needs and who owns it. Rules are confirmed with your adviser, never guessed." />
      <div role="tablist" aria-label="View" className="flex gap-1">
        <button type="button" role="tab" aria-selected={view === 'obligations'} className={`ui-pill ${view === 'obligations' ? 'ui-pill-info' : ''}`} onClick={() => setView('obligations')}>What is owed</button>
        <button type="button" role="tab" aria-selected={view === 'rules'} className={`ui-pill ${view === 'rules' ? 'ui-pill-info' : ''}`} onClick={() => setView('rules')}>Rules</button>
      </div>
      {view === 'obligations' ? (
        <>
          <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1">
            {TABS.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={status === v} className={`ui-pill ${status === v ? 'ui-pill-info' : ''}`} onClick={() => setStatus(v)}>{l}</button>)}
          </div>
          {!obligations ? <SkeletonCard lines={6} /> : !obligations.length ? <EmptyState title="Nothing here" description="Add establishments under Settings → Establishments; what each state asks of them appears here." /> : (
            <table className="w-full text-sm">
              <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">What</th><th className="py-1.5 font-medium">Where</th><th className="py-1.5 font-medium">Due</th><th className="py-1.5 font-medium">Owner</th><th className="py-1.5 font-medium">Status</th></tr></thead>
              <tbody className="divide-y">
                {obligations.map((o) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => setOpen(o)}>
                    <td className="py-2 pr-2"><span className="font-medium">{o.title}</span>{!o.ruleChecked ? <span className="ui-caption block">Rule not yet checked with your adviser</span> : null}</td>
                    <td className="py-2 pr-2">{o.establishment ? `${o.establishment}${o.state ? ` (${o.state})` : ''}` : 'Whole company'}</td>
                    <td className="py-2 pr-2 tabular-nums">{o.period === 'STANDING' ? 'Standing' : o.dueOn}</td>
                    <td className="py-2 pr-2">{o.owner}</td>
                    <td className="py-2"><span className={`ui-pill ${STATUS[o.status]?.[1] || ''}`}>{STATUS[o.status]?.[0] || o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : !rules ? <SkeletonCard lines={6} /> : (
        <table className="w-full text-sm">
          <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Rule</th><th className="py-1.5 font-medium">Where</th><th className="py-1.5 font-medium">When</th><th className="py-1.5 font-medium">Version</th><th className="py-1.5 font-medium">Checked</th></tr></thead>
          <tbody className="divide-y">
            {rules.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'ui-muted'}>
                <td className="py-2 pr-2"><span className="font-medium">{r.title}</span><span className="ui-caption block">{r.legalSource}</span>{r.threshold?.minHeadcount ? <span className="ui-caption block">From {r.threshold.minHeadcount} people</span> : null}</td>
                <td className="py-2 pr-2">{r.jurisdiction === 'IN' ? 'All of India' : r.jurisdiction === 'IN-STATE' ? 'Every state' : r.jurisdiction.replace('IN-', '')}</td>
                <td className="py-2 pr-2">{dueWords(r.dueRule)}</td>
                <td className="py-2 pr-2 tabular-nums">v{r.version}{r.active ? '' : ` · until ${r.effectiveTo}`}</td>
                <td className="py-2">
                  <span className={r.reviewStatus === 'CHECKED' ? '' : 'ui-muted'}>{r.checkedLine}</span>
                  {r.active && r.reviewStatus !== 'CHECKED' && allowed('PEOPLE::Org Structure::EDIT') ? <button type="button" className="ui-link block text-sm" onClick={() => check(r)}>I have checked this</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open ? (
        <Drawer open onClose={() => setOpen(null)} title={open.title} description={`${open.establishment ? `${open.establishment}${open.state ? `, ${open.state}` : ''}` : 'Whole company'} · ${open.period === 'STANDING' ? 'standing duty' : `due ${open.dueOn}`}`}
          actions={allowed('PEOPLE::Employees::EDIT') && !['DONE', 'CHECKED'].includes(open.status) ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => act(open, { status: 'DONE' }, 'Marked done.')}>Mark done</button> : null}>
          <dl className="space-y-4 text-sm">
            <div><dt className="ui-t-label">Source</dt><dd>{open.legalSource} (rule {open.ruleId}, v{open.ruleVersion}){open.ruleChecked ? '' : <span className="ui-caption block">Check with your adviser: this rule has not been confirmed.</span>}</dd></div>
            <div><dt className="ui-t-label">Proof it needs</dt><dd>{open.requiredProof.length ? open.requiredProof.map((p) => p.replaceAll('_', ' ').toLowerCase()).join(', ') : 'None named'}{open.proofDocIds.length ? <span className="ui-caption block">{open.proofDocIds.length} document{open.proofDocIds.length === 1 ? '' : 's'} attached</span> : null}</dd></div>
            <div><dt className="ui-t-label">Owner</dt><dd>{open.owner}</dd></div>
            <div><dt className="ui-t-label">History</dt><dd>{open.doneAt ? `Done by ${open.doneBy} on ${new Date(open.doneAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : 'Not done yet'}{open.checkedAt ? ` · checked by ${open.checkedBy}` : ''}{open.note ? <span className="block">{open.note}</span> : null}</dd></div>
          </dl>
        </Drawer>
      ) : null}
    </div>
  );
}
