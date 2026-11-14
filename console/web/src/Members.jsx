import React, { useState } from 'react';

import { api } from './api';
import { Dialog, Loading, Notice, PageHead, Pill, ReasonDialog, When, useAction, useLoad } from './kit';

const ROLE = { OWNER: 'Owner', ENGINEER: 'Engineer', VIEWER: 'Viewer' };
const CAN = { OWNER: 'Everything, including release, merge and members', ENGINEER: 'Run tests, stage, roll back, close pull requests', VIEWER: 'Reads only' };

function AddMember({ onClose, onAdd, clor }) {
  const [form, setForm] = useState({ githubLogin: '', clorEmail: '', role: 'VIEWER', reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const githubLogin = form.githubLogin.trim().replace(/^@/, '');
      const clorEmail = form.clorEmail.trim();
      if (!githubLogin && !clorEmail) throw new Error(clor ? 'Give a GitHub username, a CLOR login address, or both.' : 'Give a GitHub username.');
      await onAdd({ role: form.role, reason: form.reason, ...(githubLogin ? { githubLogin } : {}), ...(clorEmail ? { clorEmail } : {}) });
      onClose();
    } catch (err) {
      if (!err.cancelled) setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Dialog title="Add a member" onClose={onClose}>
      <form onSubmit={submit} className="con-form">
        <label className="con-label" htmlFor="m-login">GitHub username</label>
        <input id="m-login" className="con-input" autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} value={form.githubLogin} onChange={set('githubLogin')} />
        {clor ? (
          <>
            <label className="con-label" htmlFor="m-clor">CLOR login address</label>
            <input id="m-clor" className="con-input" type="email" autoComplete="off" spellCheck={false} value={form.clorEmail} onChange={set('clorEmail')} aria-describedby="m-clor-help" />
            <p id="m-clor-help" className="con-quiet">They must be CLOR staff in Ops. Give one or both; someone with only a CLOR login can read, and connects GitHub to make changes.</p>
          </>
        ) : null}
        <label className="con-label" htmlFor="m-role">Role</label>
        <select id="m-role" className="con-input" value={form.role} onChange={set('role')}>
          {Object.keys(ROLE).reverse().map((r) => <option key={r} value={r}>{ROLE[r]}: {CAN[r]}</option>)}
        </select>
        <label className="con-label" htmlFor="m-reason">Reason</label>
        <input id="m-reason" className="con-input" required minLength={3} maxLength={500} value={form.reason} onChange={set('reason')} />
        {error ? <p className="con-error" role="alert">{error}</p> : null}
        <div className="con-dialog-foot">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="ui-btn con-btn-primary" disabled={busy}>Add member</button>
        </div>
      </form>
    </Dialog>
  );
}

export default function Members() {
  const { data, error, loading, reload } = useLoad(() => api.members());
  const act = useAction(reload);
  const [adding, setAdding] = useState(false);
  const [change, setChange] = useState(null);
  return (
    <>
      <PageHead title="Members">
        <button type="button" className="ui-btn con-btn-primary" onClick={() => setAdding(true)}>Add member</button>
      </PageHead>
      {error ? <Notice tone="bad">{error.message}</Notice> : null}
      {act.done ? <Notice tone="ok">{act.done}</Notice> : null}
      {!data && loading ? <Loading /> : null}
      {data ? (
        <ul className="con-list">
          {data.members.map((m) => (
            <li key={m.id} className="con-row con-row--split">
              <span>
                <strong>{m.name}</strong> <Pill tone={m.active ? 'ok' : 'none'}>{m.active ? ROLE[m.role] : 'Switched off'}</Pill>
                {!m.authenticator ? <> <Pill tone="warn">No authenticator yet</Pill></> : null}
                <span className="con-quiet"> {[m.githubLogin ? `GitHub ${m.githubLogin}` : null, m.clorEmail ? `CLOR ${m.clorEmail}${m.clorSignedIn ? '' : ' (not signed in yet)'}` : null].filter(Boolean).join(', ')}. Since <When at={m.since} />{m.bootstrap ? '. Set in the Console service; cannot be changed here.' : ''}</span>
              </span>
              {!m.bootstrap ? (
                <span className="con-row-actions">
                  {m.active ? Object.keys(ROLE).filter((r) => r !== m.role).map((r) => <button key={r} type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setChange({ m, body: { role: r }, title: `Make ${m.name} ${ROLE[r] === 'Owner' || ROLE[r] === 'Engineer' ? 'an' : 'a'} ${ROLE[r]}`, confirm: 'Change role' })}>Make {ROLE[r]}</button>) : null}
                  {m.authenticator ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setChange({ m, body: { resetAuthenticator: true }, title: `Reset ${m.name}'s authenticator`, confirm: 'Reset', lede: 'They set up an authenticator again at their next sign-in.' })}>Reset authenticator</button> : null}
                  <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setChange({ m, body: { active: !m.active }, title: m.active ? `Switch off ${m.name}` : `Switch ${m.name} back on`, confirm: m.active ? 'Switch off' : 'Switch on', danger: m.active, lede: m.active ? 'They lose access at once.' : '' })}>{m.active ? 'Switch off' : 'Switch on'}</button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? <AddMember clor={Boolean(data?.clor)} onClose={() => setAdding(false)} onAdd={(m) => act.through(() => api.addMember(m), `${m.githubLogin || m.clorEmail} is added.`)} /> : null}
      {change ? <ReasonDialog title={change.title} lede={change.lede} confirm={change.confirm} danger={change.danger} onClose={() => setChange(null)} onConfirm={(reason) => act.through(() => api.changeMember(change.m.id, { ...change.body, reason }), 'Saved.')} /> : null}
    </>
  );
}
