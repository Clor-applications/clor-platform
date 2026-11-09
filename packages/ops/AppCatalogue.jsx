import React, { useCallback, useEffect, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { PageHead, productIcon } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading, ReasonDrawer, when } from './kit';
import { opsApps, opsSaveApp } from './api';

/**
 * The app catalogue (operator console, Product; server: routes/opsCatalogue.ts):
 * which apps clor.in and the app switcher show, and the one line under each.
 * The owner changes it; the site and the switcher pick a change up within
 * five minutes.
 */
export const LISTING = { AVAILABLE: 'Available', COMING_SOON: 'Coming soon', HIDDEN: 'Hidden' };
const LISTING_SAYS = {
  AVAILABLE: 'Listed, and customers can add it.',
  COMING_SOON: 'Listed with “coming soon”. Nobody can add it yet.',
  HIDDEN: 'Not listed on clor.in or in More apps. Customers who already have it keep it.',
};
const tone = (s) => (s === 'AVAILABLE' ? 'ws-pill ws-pill--ok' : s === 'COMING_SOON' ? 'ws-pill ws-pill--warn' : 'ws-pill ws-pill--off');

export function AppCatalogue({ role }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ status: 'AVAILABLE', blurb: '' });
  const load = useCallback(() => {
    opsApps()
      .then((r) => (setD(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);
  const owner = role === 'SUPER_ADMIN';

  const open = (a) => {
    setForm({ status: a.status, blurb: a.blurb });
    setEdit(a);
  };
  const save = async (reason) => {
    await opsSaveApp(edit.code, { ...form, reason });
    notify.success(`${edit.name} is now ${LISTING[form.status].toLowerCase()}. clor.in shows it within five minutes.`);
    setEdit(null);
    load();
  };

  return (
    <>
      <PageHead crumbs={['Product']} title="App catalogue" />
      <Err>{error}</Err>
      {!d ? (
        error ? null : <Loading />
      ) : (
        <ul className="ws-list">
          {d.apps.map((a) => {
            const Icon = productIcon(a.appId === 'people' ? 'people' : a.appId);
            return (
              <li key={a.code}>
                <div className="ws-item">
                  <span className="ws-tile ws-tile--sm" aria-hidden="true"><Icon size={14} /></span>
                  <span className="ws-item-text">
                    <span className="ws-item-title">{a.name}</span>
                    <span className="ws-item-sub">{a.blurb}</span>
                    {a.changed ? <span className="ws-item-sub">Changed {when(a.updatedAt)}</span> : null}
                  </span>
                  <span className={tone(a.status)}>{LISTING[a.status]}</span>
                  {owner ? <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => open(a)}>Edit</button> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!owner && d ? <p className="ws-card-blurb">Only the owner changes the catalogue.</p> : null}
      <ReasonDrawer
        open={Boolean(edit)}
        title={edit ? edit.name : ''}
        what="How clor.in and the app switcher list this app."
        confirmLabel="Save"
        ready={form.blurb.trim().length >= 3 && form.blurb.length <= 160}
        onClose={() => setEdit(null)}
        onConfirm={save}
      >
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>Status</legend>
          {Object.keys(LISTING).map((k) => (
            <label key={k} className="flex items-start gap-2">
              <input type="radio" name="ops-listing" value={k} checked={form.status === k} disabled={edit?.code === 'workspace' && k !== 'AVAILABLE'} onChange={() => setForm((f) => ({ ...f, status: k }))} style={{ marginTop: 4 }} />
              <span>
                <strong style={{ fontWeight: 600 }}>{LISTING[k]}</strong>
                <span className="ws-item-sub" style={{ display: 'block' }}>{LISTING_SAYS[k]}</span>
              </span>
            </label>
          ))}
          {edit?.code === 'workspace' ? <span className="ws-card-blurb">Workspace is where every customer runs their account, so it is always available.</span> : null}
        </fieldset>
        <div className="grid gap-1">
          <label className="grid gap-1">
            <span className="text-sm font-medium">One line</span>
            <input className="ui-input" maxLength={160} value={form.blurb} onChange={(e) => setForm((f) => ({ ...f, blurb: e.target.value }))} />
          </label>
          <span className="ws-card-blurb tabular-nums">{form.blurb.length} of 160 characters</span>
        </div>
      </ReasonDrawer>
    </>
  );
}
