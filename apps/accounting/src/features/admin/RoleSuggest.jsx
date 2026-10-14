import React, { useEffect, useState } from 'react';

import { getRoleSuggestionStatus, suggestRoleFor } from '../../api/admin';

/*
 * "Not sure which role?" — describe the job, get a suggestion.
 *
 * The server asks TypeSafe to pick from the roles this administrator may hand
 * out (see server/src/services/roleSuggestion.ts). Nothing is assigned here:
 * a confident answer is offered as one button, a hesitant one as the three
 * closest, and the administrator still chooses in the dropdown above.
 *
 * Renders nothing unless the server has a TypeSafe key.
 */

/** Above this, one suggestion; below, the three closest. A starting point to check against real invites. */
const CONFIDENT = 0.6;

export default function RoleSuggest({ orgId, onPick }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [jobTitle, setJobTitle] = useState('');
  const [duties, setDuties] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getRoleSuggestionStatus(orgId)
      .then((r) => !cancelled && setEnabled(Boolean(r?.enabled)))
      .catch(() => !cancelled && setEnabled(false));
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!enabled) return null;

  if (!open) {
    return (
      <button type="button" className="ui-link text-xs mt-1" onClick={() => setOpen(true)}>
        Not sure which role? Describe the job
      </button>
    );
  }

  const ask = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await suggestRoleFor(orgId, { jobTitle, duties }));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const confident = result && !result.noFit && result.confidence >= CONFIDENT;

  return (
    <div className="ui-sunken rounded-xl p-3 mt-2 space-y-2">
      <div>
        <label className="ui-label" htmlFor="rolesuggest-title">Job title</label>
        <input
          id="rolesuggest-title"
          className="ui-input w-full"
          maxLength={80}
          placeholder="e.g. Front desk billing"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
        />
      </div>
      <div>
        <label className="ui-label" htmlFor="rolesuggest-duties">What they do</label>
        <input
          id="rolesuggest-duties"
          className="ui-input w-full"
          maxLength={500}
          placeholder="e.g. Raises invoices and takes payments at the counter"
          value={duties}
          onChange={(e) => setDuties(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={ask} disabled={busy || jobTitle.trim().length < 2}>
          {busy ? 'Thinking…' : 'Suggest a role'}
        </button>
        <span className="ui-subtle text-xs">Only the two lines above and your role descriptions are sent, to TypeSafe.</span>
      </div>

      {error ? <div className="ui-subtle text-xs" role="alert">{error}</div> : null}

      {result ? (
        <div className="text-sm space-y-1" role="status">
          {result.noFit ? (
            <div className="ui-fg">None of your roles fits this job well. Consider building a custom role.</div>
          ) : null}
          {confident ? (
            <div className="flex items-center gap-2">
              <span className="ui-fg">Suggested: {result.alternatives[0]?.name}</span>
              <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => onPick(result.roleId)}>
                Use this role
              </button>
            </div>
          ) : (
            <div>
              {!result.noFit ? <div className="ui-muted text-xs mb-1">Closest matches:</div> : null}
              <div className="flex flex-wrap gap-2">
                {result.alternatives.map((a) => (
                  <button key={a.roleId} type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onPick(a.roleId)}>
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
