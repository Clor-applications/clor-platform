import React, { useEffect, useMemo, useState } from 'react';
import { Check, Hash, Plus, Save } from 'lucide-react';

import { apiFetch } from '@platform/http';
import { EmptyState, Spinner, SkeletonCard } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from './SettingsScreenHeader';
import { orgId as platformOrgId } from '@platform/context';

const DOC_TYPES = [
  { key: 'INVOICE', label: 'Invoices' },
  { key: 'RECEIPT', label: 'Receipts' },
  { key: 'PAYMENT', label: 'Payments' },
  { key: 'BILL', label: 'Bills' },
  { key: 'ESTIMATE', label: 'Quotations' },
  { key: 'CREDIT_NOTE', label: 'Credit notes' },
  { key: 'DEBIT_NOTE', label: 'Debit notes' },
  { key: 'JOURNAL', label: 'Journals' },
];

const RESET_POLICIES = [
  { key: 'FISCAL_YEAR', label: 'Every financial year' },
  { key: 'MONTH', label: 'Every month' },
  { key: 'NEVER', label: 'Never' },
];

const orgId = () => String(platformOrgId() || '');
const opts = { skipWarehouseHeader: true };

const listSeries = () => apiFetch(`/orgs/${orgId()}/number-series`, opts);
const createSeries = (series) =>
  apiFetch(`/orgs/${orgId()}/number-series`, { method: 'POST', body: series, ...opts });
const updateSeries = (id, series) =>
  apiFetch(`/orgs/${orgId()}/number-series/${id}`, { method: 'PATCH', body: series, ...opts });

const blank = {
  docType: 'INVOICE',
  name: '',
  prefix: 'INV-',
  suffix: '',
  padding: 5,
  nextNumber: 1,
  resetPolicy: 'FISCAL_YEAR',
  allowManual: false,
  isDefault: false,
};

/**
 * Preview built the same way the server builds a number, so what is shown here
 * is what a document will actually carry.
 */
const preview = (s) => {
  const period =
    s.resetPolicy === 'NEVER' ? '' : s.resetPolicy === 'MONTH' ? '202608-' : '2627-';
  return `${s.prefix || ''}${period}${String(s.nextNumber || 1).padStart(Number(s.padding) || 1, '0')}${s.suffix || ''}`;
};

/** Document numbering: prefixes, padding, and when the counter restarts. */
export const NumberingSettings = () => {
  const [series, setSeries] = useState([]);
  const [draft, setDraft] = useState(null);
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => listSeries().then((d) => setSeries(d?.series || []));

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(load)
      .catch((e) => !cancelled && setError(String(e?.message || e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const byDocType = useMemo(() => {
    const map = new Map();
    for (const s of series) {
      if (!map.has(s.docType)) map.set(s.docType, []);
      map.get(s.docType).push(s);
    }
    return map;
  }, [series]);

  const run = async (key, fn, note) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      if (note) setNotice(note);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <SkeletonCard lines={4} />
    );
  }

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Document numbering"
        actions={
          <>
            {notice ? (
              <span className="ui-pill ui-pill-pos" role="status">
                <Check size={11} aria-hidden="true" /> {notice}
              </span>
            ) : null}
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setDraft({ ...blank })}>
              <Plus size={16} aria-hidden="true" /> New series
            </button>
          </>
        }
      />

      {error ? (
        <div
          className="ui-card p-3 text-sm"
          role="alert"
          style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}
        >
          {error}
        </div>
      ) : null}

      {draft ? (
        <div className="ui-card p-4 space-y-3">
          <div className="ui-title text-sm">New series</div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="ui-label" htmlFor="ns-doc">Document</label>
              <select
                id="ns-doc"
                className="ui-select"
                value={draft.docType}
                onChange={(e) => setDraft({ ...draft, docType: e.target.value })}
              >
                {DOC_TYPES.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="ns-name">Name</label>
              <input
                id="ns-name"
                className="ui-input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Export series"
              />
            </div>
            <div>
              <label className="ui-label" htmlFor="ns-prefix">Prefix</label>
              <input
                id="ns-prefix"
                className="ui-input ui-mono"
                value={draft.prefix}
                onChange={(e) => setDraft({ ...draft, prefix: e.target.value })}
              />
            </div>
            <div>
              <label className="ui-label" htmlFor="ns-reset">Restart</label>
              <select
                id="ns-reset"
                className="ui-select"
                value={draft.resetPolicy}
                onChange={(e) => setDraft({ ...draft, resetPolicy: e.target.value })}
              >
                {RESET_POLICIES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="ui-muted text-xs">Will look like</span>
            <span className="ui-mono ui-title text-sm">{preview(draft)}</span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={!draft.name || busy === 'new'}
              onClick={() =>
                run('new', async () => {
                  await createSeries(draft);
                  await load();
                  setDraft(null);
                }, 'Series created')
              }
            >
              {busy === 'new' ? <Spinner /> : <Save size={16} aria-hidden="true" />} Save
            </button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {series.length === 0 ? (
        <div className="ui-card">
          <EmptyState
            icon={Hash}
      title="No series yet"
            description="A default series is created automatically the first time a document of that type is raised."
          />
        </div>
      ) : (
        DOC_TYPES.filter((d) => byDocType.has(d.key)).map((d) => (
          <section key={d.key} className="ui-card overflow-hidden">
            <div className="px-4 py-3 ui-title text-sm" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
              {d.label}
            </div>
            <div className="overflow-x-auto">
              <table className="ui-table ui-table-wide">
                <thead>
                  <tr>
                    <th scope="col">Series</th>
                    <th scope="col">Prefix</th>
                    <th scope="col" className="ui-num">Pad</th>
                    <th scope="col" className="ui-num">Next</th>
                    <th scope="col">Restarts</th>
                    <th scope="col">Manual allowed</th>
                    <th scope="col">Looks like</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {byDocType.get(d.key).map((s) => {
                    const edited = { ...s, ...(edits[s.id] || {}) };
                    const dirty = Boolean(edits[s.id]);
                    const patch = (p) => setEdits((prev) => ({ ...prev, [s.id]: { ...(prev[s.id] || {}), ...p } }));

                    return (
                      <tr key={s.id}>
                        <td className="ui-col-entity">
                          {s.name}
                          {s.isDefault ? <span className="ui-pill ui-pill-neutral ml-2">Default</span> : null}
                        </td>
                        <td>
                          <input
                            className="ui-input ui-mono !w-24 !py-1 !min-h-0"
                            value={edited.prefix}
                            onChange={(e) => patch({ prefix: e.target.value })}
                            aria-label={`Prefix for ${s.name}`}
                          />
                        </td>
                        <td className="ui-col-amount">
                          <input
                            type="number"
                            min={1}
                            max={12}
                            className="ui-input !w-16 !py-1 !min-h-0"
                            value={edited.padding}
                            onChange={(e) => patch({ padding: Number(e.target.value) })}
                            aria-label={`Padding for ${s.name}`}
                          />
                        </td>
                        <td className="ui-col-amount">
                          <input
                            type="number"
                            min={1}
                            className="ui-input !w-24 !py-1 !min-h-0"
                            value={edited.nextNumber}
                            onChange={(e) => patch({ nextNumber: Number(e.target.value) })}
                            aria-label={`Next number for ${s.name}`}
                          />
                        </td>
                        <td>
                          <select
                            className="ui-select !w-44 !py-1 !min-h-0"
                            value={edited.resetPolicy}
                            onChange={(e) => patch({ resetPolicy: e.target.value })}
                            aria-label={`Restart policy for ${s.name}`}
                          >
                            {RESET_POLICIES.map((r) => (
                              <option key={r.key} value={r.key}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(edited.allowManual)}
                            onChange={(e) => patch({ allowManual: e.target.checked })}
                            aria-label={`Allow typing a number for ${s.name}`}
                          />
                        </td>
                        <td className="ui-col-meta ui-mono text-xs">{preview(edited)}</td>
                        <td>
                          <button
                            type="button"
                            className="ui-btn ui-btn-primary !py-1 !min-h-0"
                            disabled={!dirty || busy === s.id}
                            onClick={() =>
                              run(s.id, async () => {
                                await updateSeries(s.id, edits[s.id]);
                                setEdits((prev) => {
                                  const next = { ...prev };
                                  delete next[s.id];
                                  return next;
                                });
                                await load();
                              }, 'Saved')
                            }
                          >
                            Save
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <p className="ui-subtle text-xs">
        A series that restarts carries the period in the number, so this year&rsquo;s first invoice cannot collide
        with last year&rsquo;s. Changing the next number affects documents raised from now on; it does not renumber
        anything already issued.
      </p>
    </div>
  );
};

export default NumberingSettings;
