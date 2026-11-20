import React, { useCallback, useEffect, useState } from 'react';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { PageHead, Panel } from '../../apps/admin/src/screens/wsKit';
import { opsSetSwitch, opsSwitches } from './api';
import { Err, Loading, when, errorWords } from './kit';

/**
 * Forms on clor.in (server: routes/opsInsights.ts, services/platformSwitches.ts):
 * pause new free trials or demo requests for a while, with the words visitors
 * read meanwhile. The owner only; each change asks for the authenticator code
 * and is audited.
 */
function SwitchCard({ s, canChange, onSaved }) {
  const [message, setMessage] = useState(s.open ? '' : s.message);
  const [busy, setBusy] = useState(false);
  const flip = async (open) => {
    if (busy) return;
    /* Pausing takes a public form down: say exactly what visitors will read instead, and ask first. */
    if (!open) {
      const words = message.trim() || s.message;
      const ok = await confirmDialog({
        title: `Pause ${s.label}?`,
        message: `Visitors to clor.in can no longer send this form until you open it again. In its place they read: “${words}”`,
        confirmLabel: 'Pause form',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await opsSetSwitch(s.name, { open, message: open ? null : message.trim() || null });
      notify.success(open ? 'Open again.' : 'Paused. Visitors read your message.');
      onSaved(r.switches);
    } catch (e) {
      notify.error(errorWords(e, 'change the form'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={s.label}>
      <div className="grid gap-3" style={{ maxWidth: '40rem' }}>
        <p className="ws-card-blurb">{s.help}</p>
        <p className="text-sm">
          <span className={s.open ? 'ws-pill ws-pill--ok' : 'ws-pill ws-pill--warn'}>{s.open ? 'Open' : 'Paused'}</span>
          {s.updatedAt ? <span className="ws-item-sub"> · changed {when(s.updatedAt)}</span> : null}
        </p>
        {!s.open ? <p className="ws-item-sub" style={{ whiteSpace: 'normal' }}>Visitors read: “{s.message}”</p> : null}
        {canChange ? (
          s.open ? (
            <>
              <label className="grid gap-1">
                <span className="ui-label">Message while paused</span>
                <textarea className="ui-input" rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={s.message} />
                <span className="ui-caption">Leave empty for the words shown above as the example.</span>
              </label>
              <div>
                <button type="button" className="ws-btn ws-btn--danger" disabled={busy} onClick={() => flip(false)}>{busy ? 'Pausing…' : 'Pause'}</button>
              </div>
            </>
          ) : (
            <div>
              <button type="button" className="ws-btn ws-btn--primary" disabled={busy} onClick={() => flip(true)}>{busy ? 'Opening…' : 'Open again'}</button>
            </div>
          )
        ) : null}
      </div>
    </Panel>
  );
}

export function Switches({ me }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    opsSwitches().then((r) => (setRows(r.switches), setError(''))).catch((e) => setError(errorWords(e, 'load the forms')));
  }, []);
  useEffect(load, [load]);
  const canChange = me?.role === 'SUPER_ADMIN';
  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Billing and setup']}
          title="Forms on clor.in"
          description={canChange ? 'Pause a form on the website for a while, for example during a big release or when the team is away.' : 'Only the owner pauses or opens these.'}
        />
        <Err onRetry={load}>{error}</Err>
        {!rows ? (error ? null : <Loading />) : rows.map((s) => <SwitchCard key={`${s.name}-${s.open}`} s={s} canChange={canChange} onSaved={setRows} />)}
      </div>
    </div>
  );
}
