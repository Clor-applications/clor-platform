import React, { useEffect, useMemo, useState } from 'react';

import { ArrowRightLeft, CheckCheck } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { listContractors, listEmployees, listStructure, transferEmployees } from '@ui/personnel/api';
import LoadFailed from '../components/LoadFailed';

const FIELDS = {
  departmentId: { label: 'Department', list: 'departments', current: 'department' },
  areaId: { label: 'Area', list: 'areas', current: 'areaName' },
  jobPositionId: { label: 'Position', list: 'positions', current: 'designation' },
  contractorId: { label: 'Contractor', list: 'contractors', current: 'contractorName' },
};

/** Move many people to another department, area, position or contractor at once (ClorTime's Personnel transfer). */
export default function Transfer() {
  const [people, setPeople] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [lists, setLists] = useState({ departments: [], areas: [], positions: [], contractors: [] });
  const [field, setField] = useState('departmentId');
  const [from, setFrom] = useState('');
  const [target, setTarget] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  /* Employment history: from when the move counts, and why. */
  const [effectiveDate, setEffectiveDate] = useState(() => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  const [note, setNote] = useState('');

  const load = () =>
    listEmployees({ status: 'ACTIVE', limit: 2000 })
      .then((r) => {
        setPeople(r?.employees || []);
        setLoadError('');
      })
      .catch((e) => setLoadError(String(e?.message || 'Could not load people.')));
  useEffect(() => {
    load();
    Promise.all([listStructure('departments'), listStructure('areas'), listStructure('job-positions'), listContractors()])
      .then(([departments, areas, positions, contractors]) => setLists({ departments, areas, positions, contractors }))
      .catch(() => undefined);
  }, []);

  const cfg = FIELDS[field];
  const options = lists[cfg.list] || [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (people || []).filter((p) => (!from || (from === '__none' ? !p[field] : p[field] === from)) && (!needle || `${p.name} ${p.code || ''}`.toLowerCase().includes(needle)));
  }, [people, from, q, field]);

  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const move = async () => {
    setSaving(true);
    try {
      const r = await transferEmployees({ employeeIds: [...picked], field, targetId: target === '__none' ? null : target, effectiveDate, note: note || null });
      notify.success(`${r.moved} moved.`);
      setPicked(new Set());
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not moved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        entity="employee"
        title="Transfers"
        description="Move people to another department, area, position or contractor in one go."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" disabled={saving || !picked.size || !target} onClick={move}>
            <ArrowRightLeft size={16} aria-hidden="true" /> {saving ? 'Moving…' : `Move ${picked.size || ''}`}
          </button>
        }
      />
      <div className="pb-8 space-y-6">
        <section className="ui-card flex flex-wrap items-end gap-3 p-4" aria-label="Transfer options">
          <label className="block">
            <span className="ui-label">Change</span>
            <select className="ui-select" value={field} onChange={(e) => { setField(e.target.value); setFrom(''); setTarget(''); setPicked(new Set()); }}>
              {Object.entries(FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="ui-label">Show people in</span>
            <select className="ui-select" value={from} onChange={(e) => { setFrom(e.target.value); setPicked(new Set()); }}>
              <option value="">Any</option>
              <option value="__none">None set</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="ui-label">Move to *</span>
            <select className="ui-select" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose…</option>
              <option value="__none">None (clear it)</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="ui-label">Counts from</span>
            <input type="date" className="ui-input" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="ui-label">Reason (optional)</span>
            <input className="ui-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Reorganisation…" />
          </label>
        </section>
        <LoadFailed message={loadError} onRetry={load} />
        {!people ? (
          loadError ? null : <SkeletonCard lines={6} />
        ) : (
          <section className="ui-card" aria-label="People">
            <div className="ui-card-head flex flex-wrap items-center justify-between gap-2">
              <h2 className="ui-t-sec">People <span className="ui-caption tabular-nums">· {picked.size} of {shown.length} picked</span></h2>
              <div className="flex flex-wrap items-center gap-2">
                <input type="search" className="ui-input ui-ctl-compact !w-auto" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setPicked(new Set(shown.map((p) => p.id)))}><CheckCheck size={14} aria-hidden="true" /> Select {shown.length}</button>
                {picked.size ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setPicked(new Set())}>Clear</button> : null}
              </div>
            </div>
            <ul className="grid max-h-[28rem] gap-1 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="ui-checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                    <span className="truncate">{p.name}<span className="ui-caption"> · {p[cfg.current] || `no ${cfg.label.toLowerCase()}`}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
