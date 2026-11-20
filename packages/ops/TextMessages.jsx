import React, { useEffect, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { PageHead, Panel } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading, when, errorWords } from './kit';
import { opsSaveSms, opsSms, opsTestSms } from './api';

/**
 * Settings, Text messages (server: routes/pricing.ts, /ops/settings/sms):
 * CLOR's own SMS sender, MSG91, used for one thing: two-step sign-in codes.
 * Until it is switched on with a key and an approved template, nobody is
 * offered codes by text message.
 *
 * Only the owner role changes it. Saving and testing ask for a code from the
 * authenticator app and go on the staff audit log. The key is never shown
 * again: only its last four characters come back.
 */
export function TextMessages({ role }) {
  const [sms, setSms] = useState(null);
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [testing, setTesting] = useState(false);

  const load = () =>
    opsSms()
      .then((r) => {
        setSms(r.sms);
        setF({ enabled: r.sms.enabled, templateId: r.sms.templateId || '', senderId: r.sms.senderId || '', authKey: '' });
        setError('');
      })
      .catch((e) => setError(errorWords(e, 'load the text message settings')));
  useEffect(() => {
    load();
  }, []);

  if (!f) return error ? <Err>{error}</Err> : <Loading />;
  const mayChange = role === 'SUPER_ADMIN';
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblems([]);
    try {
      await opsSaveSms({ enabled: f.enabled, templateId: f.templateId.trim() || null, senderId: f.senderId.trim() || null, authKey: f.authKey.trim() || null });
      notify.success(f.enabled ? 'Saved. People can now choose a code by text message.' : 'Saved. Codes by text message are off.');
      load();
    } catch (err) {
      setProblems(err?.data?.problems || [errorWords(err, 'save the text message settings')]);
    } finally {
      setBusy(false);
    }
  };

  const test = async (e) => {
    e.preventDefault();
    setTesting(true);
    try {
      const r = await opsTestSms(phone);
      notify.success(r.message);
    } catch (err) {
      notify.error(errorWords(err, 'send the test text'));
    } finally {
      setTesting(false);
      load();
    }
  };

  const status = sms.ready ? 'On' : sms.enabled ? 'Switched on, not complete' : 'Off';

  return (
    <>
      <PageHead
        crumbs={['Platform']}
        title="Text messages"
        meta={`Sign-in codes by SMS · ${status}`}
        actions={
          mayChange ? (
            <button type="submit" form="ops-sms" className="ws-btn ws-btn--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save text settings'}
            </button>
          ) : null
        }
      />
      <Panel title="MSG91 sender">
        <p className="ws-card-blurb">
          CLOR texts one kind of message: the six-digit code for two-step sign-in. India’s DLT rules need a registered business, a six-letter sender ID and an approved
          template with one blank for the code. Do those in MSG91 first, then paste the three values here.
        </p>
        <form id="ops-sms" className="grid gap-5" onSubmit={save} style={{ maxWidth: 560 }}>
          <label className="flex gap-2 items-start">
            <input type="checkbox" checked={f.enabled} disabled={!mayChange} onChange={set('enabled')} />
            <span>
              <span className="font-medium">Offer sign-in codes by text message</span>
              <span className="ws-card-blurb" style={{ display: 'block' }}>
                Off: only the authenticator app is offered to anyone setting up. On: people can choose a code texted to an Indian mobile number instead. People who
                already turned text messages on keep getting their codes while a key is saved.
              </span>
            </span>
          </label>
          <div className="grid gap-1">
            <label htmlFor="ops-sms-key" className="text-sm font-medium">
              Auth key
            </label>
            <input
              id="ops-sms-key"
              type="password"
              className="ui-input ui-mono"
              maxLength={100}
              autoComplete="off"
              value={f.authKey}
              disabled={!mayChange}
              onChange={set('authKey')}
              placeholder={sms.authKeySaved ? `Saved, ends in ${sms.authKeyHint || '••••'}. Paste a new one to replace it` : 'Paste the key from MSG91'}
            />
            <span className="ws-card-blurb">In MSG91: your name, then Authkey. It is stored encrypted and never shown again.</span>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div className="grid gap-1">
              <label htmlFor="ops-sms-template" className="text-sm font-medium">
                Template ID
              </label>
              <input id="ops-sms-template" className="ui-input ui-mono" maxLength={60} value={f.templateId} disabled={!mayChange} onChange={set('templateId')} />
              <span className="ws-card-blurb">The ID MSG91 shows beside the approved template. Name its blank “otp”.</span>
            </div>
            <div className="grid gap-1">
              <label htmlFor="ops-sms-sender" className="text-sm font-medium">
                Sender ID
              </label>
              <input id="ops-sms-sender" className="ui-input ui-mono" maxLength={6} value={f.senderId} disabled={!mayChange} onChange={(e) => setF((x) => ({ ...x, senderId: e.target.value.toUpperCase() }))} placeholder="CLORIN" />
              <span className="ws-card-blurb">Six capital letters, as registered on DLT.</span>
            </div>
          </div>
          {problems.length ? (
            <ul role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))', paddingLeft: 18, listStyle: 'disc' }}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {mayChange ? <p className="ws-card-blurb">Saving asks for a code from your authenticator app.</p> : <p className="ws-card-blurb">Only an owner of the console can change this.</p>}
        </form>
      </Panel>

      <Panel title="Send a test">
        <p className="ws-card-blurb">Texts one made-up code to a number, to check the key and the template work. Save first: the test uses what is saved.</p>
        {mayChange ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={test}>
            <label className="grid gap-1">
              <span className="text-sm font-medium">Indian mobile number</span>
              <input className="ui-input tabular-nums" inputMode="tel" autoComplete="off" maxLength={16} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
            </label>
            <button type="submit" className="ws-btn ws-btn--quiet" disabled={testing || phone.replace(/\D/g, '').length < 10 || !sms.authKeySaved || !sms.templateId}>
              {testing ? 'Sending…' : 'Send test text'}
            </button>
          </form>
        ) : null}
        {sms.lastTestAt ? (
          <p className="text-sm" role="status" style={{ marginTop: 12 }}>
            <span className={`ws-pill ${sms.lastTestOk ? 'ws-pill--ok' : 'ws-pill--danger'}`}>{sms.lastTestOk ? 'Sent' : 'Not sent'}</span> {sms.lastTestMessage} <span className="ws-card-blurb">{when(sms.lastTestAt)}</span>
          </p>
        ) : (
          <p className="ws-card-blurb" style={{ marginTop: 12 }}>No test sent yet.</p>
        )}
      </Panel>
    </>
  );
}
