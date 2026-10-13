import React, { useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import {
  getEInvoiceSettingsApi,
  saveEInvoiceSettingsApi,
  testEInvoiceConnectionApi,
  hasEInvoiceApiSession,
} from '../../api/einvoice';

/**
 * e-Invoice (IRP) gateway settings.
 *
 * The GST network is reached through a GSP / API gateway (MasterGST,
 * ClearTax, Cygnet, or the NIC sandbox behind a REST proxy). Credentials are
 * stored server-side, encrypted; this form never sees them back — the
 * placeholders just say whether a secret is on file.
 */
export default function EInvoiceSettings() {
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [meta, setMeta] = useState({ hasPassword: false, hasClientSecret: false, verifiedAt: null, lastError: null });
  const [form, setForm] = useState({
    mode: 'SANDBOX',
    provider: 'GSP',
    baseUrl: '',
    gstin: '',
    username: '',
    password: '',
    clientId: '',
    clientSecret: '',
    publicKeyPem: '',
    headersJson: '',
    autoRegister: false,
  });

  useEffect(() => {
    if (!hasEInvoiceApiSession()) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await getEInvoiceSettingsApi();
        if (cancelled || !s) return;
        setForm((p) => ({
          ...p,
          mode: s.mode || 'SANDBOX',
          provider: s.provider || 'GSP',
          baseUrl: s.baseUrl || '',
          gstin: s.gstin || '',
          username: s.username || '',
          clientId: s.clientId || '',
          publicKeyPem: s.publicKeyPem || '',
          headersJson: s.headersJson || '',
          autoRegister: Boolean(s.autoRegister),
        }));
        setMeta({
          hasPassword: Boolean(s.hasPassword),
          hasClientSecret: Boolean(s.hasClientSecret),
          verifiedAt: s.verifiedAt,
          lastError: s.lastError,
        });
      } catch {
        /* no settings yet is fine */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      // Blank secrets mean "keep what is stored".
      if (!payload.password) delete payload.password;
      if (!payload.clientSecret) delete payload.clientSecret;
      const s = await saveEInvoiceSettingsApi(payload);
      setMeta((p) => ({ ...p, hasPassword: Boolean(s?.hasPassword), hasClientSecret: Boolean(s?.hasClientSecret) }));
      setForm((p) => ({ ...p, password: '', clientSecret: '' }));
      notify.success('e-Invoice gateway settings saved.');
    } catch (err) {
      notify.error(String(err?.message || 'Could not save e-Invoice settings.'));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await testEInvoiceConnectionApi();
      setMeta((p) => ({ ...p, verifiedAt: new Date().toISOString(), lastError: null }));
      notify.success('Gateway reachable.');
    } catch (err) {
      notify.error(String(err?.message || 'Gateway unreachable.'));
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="border rounded-xl p-5 shadow-sm ui-surface">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold ui-fg">e-Invoice (IRP)</div>
          <div className="text-xs ui-muted">
            Register invoices on the GST network and get an IRN + signed QR. Works with any GSP REST gateway
            (MasterGST, ClearTax, Cygnet) or the NIC sandbox. Enable the “einvoice” feature under Settings →
            Features to use it on invoices.
          </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${form.mode === 'PRODUCTION' ? 'ui-badge-warn' : 'ui-sunken ui-muted'}`}>
          {form.mode === 'PRODUCTION' ? 'Production' : 'Sandbox'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        <div>
          <label className="ui-label" htmlFor="einvoicesettings-provider">Provider</label>
          <select id="einvoicesettings-provider" value={form.provider} onChange={set('provider')} className="ui-select w-full ui-surface">
            <option value="GSP">GSP REST gateway (MasterGST / ClearTax style)</option>
            <option value="NIC">NIC direct API (einvoice1.gst.gov.in)</option>
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="einvoicesettings-mode">Mode</label>
          <select id="einvoicesettings-mode" value={form.mode} onChange={set('mode')} className="ui-select w-full ui-surface">
            <option value="SANDBOX">Sandbox (testing)</option>
            <option value="PRODUCTION">Production (live IRN)</option>
          </select>
        </div>
        <div>
          <label className="ui-label">{form.provider === 'NIC' ? 'NIC base URL' : 'Gateway base URL'}</label>
          <input
            value={form.baseUrl}
            onChange={set('baseUrl')}
            className="ui-input w-full"
            placeholder={form.provider === 'NIC' ? 'https://einv-apisandbox.nic.in' : 'https://api.mastergst.com/einvoice'}
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="einvoicesettings-gstin-used-at-the-gateway">GSTIN used at the gateway</label>
          <input id="einvoicesettings-gstin-used-at-the-gateway" value={form.gstin} onChange={set('gstin')} className="ui-input w-full" placeholder="29ABCDE1234F1Z5" />
        </div>
        <div>
          <label className="ui-label" htmlFor="einvoicesettings-api-username">API username</label>
          <input id="einvoicesettings-api-username" value={form.username} onChange={set('username')} className="ui-input w-full" autoComplete="off" />
        </div>
        <div>
          <label className="ui-label" htmlFor="einvoicesettings-api-password">API password</label>
          <input id="einvoicesettings-api-password"
            type="password"
            value={form.password}
            onChange={set('password')}
            className="ui-input w-full"
            placeholder={meta.hasPassword ? '••••••••  (stored — type to replace)' : ''}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="einvoicesettings-client-id">Client ID</label>
          <input id="einvoicesettings-client-id" value={form.clientId} onChange={set('clientId')} className="ui-input w-full" autoComplete="off" />
        </div>
        <div>
          <label className="ui-label" htmlFor="einvoicesettings-client-secret">Client secret</label>
          <input id="einvoicesettings-client-secret"
            type="password"
            value={form.clientSecret}
            onChange={set('clientSecret')}
            className="ui-input w-full"
            placeholder={meta.hasClientSecret ? '••••••••  (stored — type to replace)' : ''}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="einvoicesettings-extra-headers-json-optional">Extra headers (JSON, optional)</label>
          <input id="einvoicesettings-extra-headers-json-optional"
            value={form.headersJson}
            onChange={set('headersJson')}
            className="ui-input w-full"
            placeholder='{"ip_address": "203.0.113.7"}'
          />
        </div>
        {form.provider === 'NIC' ? (
          <div className="sm:col-span-2">
            <label className="ui-label" htmlFor="einvoicesettings-nic-e-invoice-public-key-pem">NIC e-Invoice public key (PEM)</label>
            <textarea id="einvoicesettings-nic-e-invoice-public-key-pem"
              value={form.publicKeyPem}
              onChange={set('publicKeyPem')}
              className="ui-input w-full font-mono text-xs"
              rows={4}
              placeholder={'-----BEGIN PUBLIC KEY-----\n…download from Help → API sandbox on einvoice1.gst.gov.in…\n-----END PUBLIC KEY-----'}
            />
            <div className="text-xs ui-muted mt-1">
              Used to encrypt the sign-in payload (RSA). Sandbox and production publish different keys.
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm ui-fg select-none">
          <input type="checkbox" checked={form.autoRegister} onChange={set('autoRegister')} className="ui-checkbox h-4 w-4" />
          <span>Auto-register new invoices on the IRP</span>
        </label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={test} disabled={testing || !form.baseUrl} className="ui-btn ui-btn-secondary">
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" onClick={save} disabled={saving} className="ui-btn ui-btn-primary">
            {saving ? 'Saving…' : 'Save gateway'}
          </button>
        </div>
      </div>

      {meta.lastError ? (
        <div className="mt-3 text-xs text-[rgb(var(--neg))]">Last gateway error: {meta.lastError}</div>
      ) : meta.verifiedAt ? (
        <div className="mt-3 text-xs ui-muted">Gateway last verified {new Date(meta.verifiedAt).toLocaleString()}.</div>
      ) : null}
    </div>
  );
}
