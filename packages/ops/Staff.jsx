import React, { useCallback, useEffect, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { PageHead, Panel, ago } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading, ROLE, ROLE_CAN, ROLE_ORDER, ReasonDrawer, day } from './kit';
import { opsAddOperator, opsChangeOperator, opsOperators, opsRemoveOperator, opsWithdrawInvite } from './api';

/**
 * Staff and roles (operator console, Team): who at CLOR works on the console,
 * with which role, and whether their authenticator is set up. The owner
 * invites by email, changes roles and removes people. The server enforces the
 * roles; this screen only shows what each one may do.
 */
export function Staff({ me }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [act, setAct] = useState(null); // { kind: 'invite' | 'role' | 'remove' | 'withdraw', row, role }
  const [form, setForm] = useState({ email: '', role: 'SUPPORT' });
  const load = useCallback(() => {
    opsOperators()
      .then((r) => (setD(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);

  const run = async (reason) => {
    if (act.kind === 'invite') {
      const r = await opsAddOperator({ email: form.email.trim(), role: form.role, reason });
      notify.success(r.invite ? `Invitation sent to ${form.email.trim()}. They become staff when they sign in with that address.` : `${form.email.trim()} is now ${ROLE[form.role]}. They set up an authenticator on first visit.`);
      setForm({ email: '', role: 'SUPPORT' });
    }
    if (act.kind === 'role') {
      await opsChangeOperator(act.row.userId, { role: act.role, reason });
      notify.success(`${act.row.name || act.row.email} is now ${ROLE[act.role]}.`);
    }
    if (act.kind === 'remove') {
      await opsRemoveOperator(act.row.userId, reason);
      notify.success(`${act.row.name || act.row.email} can no longer open the console.`);
    }
    if (act.kind === 'withdraw') {
      await opsWithdrawInvite(act.row.id, reason);
      notify.success(`Invitation to ${act.row.email} withdrawn.`);
    }
    setAct(null);
    load();
  };

  const rows = d ? [...d.bootstrap.map((b) => ({ ...b, bootstrap: true, active: true })), ...d.operators] : [];
  const name = act?.row ? act.row.name || act.row.email : '';
  return (
    <>
      <PageHead
        crumbs={['Team']}
        title="Staff and roles"
        meta={d ? `${rows.length} on the console${d.invites.length ? ` · ${d.invites.length} invited` : ''}` : null}
        actions={<button type="button" className="ws-btn ws-btn--primary" onClick={() => setAct({ kind: 'invite' })}>Invite staff</button>}
      />
      <Err>{error}</Err>
      {!d ? (
        error ? null : <Loading />
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">CLOR staff on the console</caption>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th className="hidden sm:table-cell">Authenticator</th>
                <th className="hidden md:table-cell">Last sign-in</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fixed = r.bootstrap || r.userId === me.user.id;
                return (
                  <tr key={r.userId}>
                    <td>
                      <strong style={{ fontWeight: 600 }}>{r.name || '—'}</strong>
                      {r.userId === me.user.id ? <span className="ws-item-sub"> (you)</span> : null}
                      <div className="ws-item-sub">{r.email}</div>
                    </td>
                    <td>
                      {fixed ? (
                        <>
                          {ROLE[r.role] || r.role}
                          {r.bootstrap ? <div className="ws-item-sub">set by engineering</div> : null}
                        </>
                      ) : (
                        <select
                          className="ui-select"
                          style={{ width: 'auto' }}
                          aria-label={`Role of ${r.email}`}
                          value={r.role}
                          onChange={(e) => setAct({ kind: 'role', row: r, role: e.target.value })}
                        >
                          {ROLE_ORDER.map((k) => (
                            <option key={k} value={k}>{ROLE[k]}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="hidden sm:table-cell">{r.authenticator ? <span className="ws-pill ws-pill--ok">Set up</span> : <span className="ws-pill ws-pill--warn">Not yet</span>}</td>
                    <td className="hidden md:table-cell">{r.lastLoginAt ? ago(r.lastLoginAt) : 'Never'}</td>
                    <td className="num">
                      {!fixed ? (
                        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAct({ kind: 'remove', row: r })}>Remove</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {d?.invites?.length ? (
        <Panel title="Invited, not signed in yet">
          <ul className="ws-list">
            {d.invites.map((i) => (
              <li key={i.id}>
                <div className="ws-item">
                  <span className="ws-item-text">
                    <span className="ws-item-title">{i.email}</span>
                    <span className="ws-item-sub">{ROLE[i.role] || i.role} · invited {day(i.since)}</span>
                  </span>
                  <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAct({ kind: 'withdraw', row: i })}>Withdraw</button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="What each role can do">
        <dl className="ops-facts">
          {ROLE_ORDER.map((k) => (
            <React.Fragment key={k}>
              <dt>{ROLE[k]}</dt>
              <dd>{ROLE_CAN[k]}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="ws-card-blurb" style={{ marginTop: 12 }}>Everybody signs in with an authenticator app, and is asked for a fresh code before any change.</p>
      </Panel>

      <ReasonDrawer
        open={Boolean(act)}
        title={{ invite: 'Invite staff', role: 'Change role', remove: 'Remove from the console', withdraw: 'Withdraw the invitation' }[act?.kind] || ''}
        what={
          act?.kind === 'invite'
            ? 'They get an email. With a CLOR login on this address they are staff at once; without one, they make a login first and confirm the address. Either way they set up an authenticator before the console opens.'
            : act?.kind === 'role'
              ? `${name} becomes ${ROLE[act.role]}: ${ROLE_CAN[act.role]}`
              : act?.kind === 'remove'
                ? `${name} can no longer open the console. Their CLOR login stays.`
                : act?.kind === 'withdraw'
                  ? `The invitation to ${act.row.email} stops working.`
                  : ''
        }
        confirmLabel={{ invite: 'Send invitation', role: 'Change role', remove: 'Remove', withdraw: 'Withdraw' }[act?.kind] || ''}
        tone={act?.kind === 'remove' || act?.kind === 'withdraw' ? 'danger' : 'primary'}
        ready={act?.kind !== 'invite' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())}
        onClose={() => setAct(null)}
        onConfirm={run}
      >
        {act?.kind === 'invite' ? (
          <>
            <label className="grid gap-1">
              <span className="text-sm font-medium">Email</span>
              <input className="ui-input" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>Role</legend>
              {ROLE_ORDER.map((k) => (
                <label key={k} className="flex items-start gap-2">
                  <input type="radio" name="ops-role" value={k} checked={form.role === k} onChange={() => setForm((f) => ({ ...f, role: k }))} style={{ marginTop: 4 }} />
                  <span>
                    <strong style={{ fontWeight: 600 }}>{ROLE[k]}</strong>
                    <span className="ws-item-sub" style={{ display: 'block' }}>{ROLE_CAN[k]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        ) : null}
      </ReasonDrawer>
    </>
  );
}
