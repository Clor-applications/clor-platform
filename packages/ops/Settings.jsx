import React, { useEffect, useState } from 'react';

import { Err, ErrorSummary, Loading, errorWords } from './kit';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';
import { PageHead, Panel } from '../../apps/admin/src/screens/wsKit';
import { opsSaveTax, opsTax } from './api';
import { Button } from '@ui/components/ui/Primitives';

/**
 * Settings, Tax (server: routes/pricing.ts, PUT /ops/settings/tax): CLOR's
 * own GST registration as a seller. Off, no quote or invoice carries a tax
 * line. On, it needs the GSTIN, the legal name and the SAC code first; the
 * state comes from the GSTIN. A change asks for an authenticator code and
 * goes in the Staff audit log.
 */
const STATES = Object.entries(GST_STATE_BY_CODE)
  .filter(([, n]) => !/\(Old\)/.test(n))
  .sort((a, b) => a[1].localeCompare(b[1]));
const may = (role, ...roles) => role === 'SUPER_ADMIN' || roles.includes(role);

/**
 * The tax change in words, old against new, and where it applies, for the confirm before saving.
 * The server works GST out again when a draft is issued (billing/invoices.ts issueInvoice), so drafts
 * take the new settings too; invoices already issued keep theirs. Null when nothing changed.
 */
export function taxChangeWords(before, after) {
  const stateName = (c) => (c ? GST_STATE_BY_CODE[c] || c : 'none');
  const show = (v) => (v === '' || v == null ? 'none' : String(v));
  const changes = [];
  if (Boolean(before.registered) !== Boolean(after.registered)) changes.push(`GST registered: ${before.registered ? 'yes' : 'no'} → ${after.registered ? 'yes' : 'no'}`);
  if (Number(before.ratePercent) !== Number(after.ratePercent)) changes.push(`Rate: ${before.ratePercent}% → ${after.ratePercent}%`);
  if (show(before.gstin) !== show(after.gstin)) changes.push(`GSTIN: ${show(before.gstin)} → ${show(after.gstin)}`);
  if (show(before.legalName) !== show(after.legalName)) changes.push(`Legal name: ${show(before.legalName)} → ${show(after.legalName)}`);
  if (show(before.state) !== show(after.state)) changes.push(`State: ${stateName(before.state)} → ${stateName(after.state)}`);
  if (show(before.sac) !== show(after.sac)) changes.push(`SAC code: ${show(before.sac)} → ${show(after.sac)}`);
  if (!changes.length) return null;
  const effect = after.registered
    ? `From now on every quote and every invoice issued adds GST at ${after.ratePercent}%, drafts included: their tax is worked out again when they are issued.`
    : 'From now on no quote or invoice carries GST, drafts included: their tax is worked out again when they are issued.';
  return { changes, message: `${changes.join('. ')}. ${effect} Invoices already issued keep the GST they were issued with.` };
}

export function Settings({ role }) {
  const [tax, setTax] = useState(null);
  const [rates, setRates] = useState([0, 5, 12, 18, 28]);
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () =>
    opsTax()
      .then((r) => {
        setTax(r.tax);
        setRates(r.rates || rates);
        setF({ registered: r.tax.registered, gstin: r.tax.gstin || '', legalName: r.tax.legalName || '', state: r.tax.stateCode || '', sac: r.tax.sac || '', ratePercent: r.tax.ratePercent });
      })
      .catch((e) => setError(errorWords(e, 'load the tax settings')));
  const saved = tax ? { registered: tax.registered, gstin: tax.gstin || '', legalName: tax.legalName || '', state: tax.stateCode || '', sac: tax.sac || '', ratePercent: tax.ratePercent } : null;
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return error ? <Err onRetry={() => (setError(''), load())}>{`${error} If it keeps failing, tell engineering.`}</Err> : <Loading />;
  const mayChange = may(role, 'BILLING');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  /* The state follows the GSTIN's first two digits as it is typed. */
  const onGstin = (e) => {
    const v = e.target.value.toUpperCase();
    setF((x) => ({ ...x, gstin: v, state: /^\d{2}/.test(v) && GST_STATE_BY_CODE[v.slice(0, 2)] ? v.slice(0, 2) : x.state }));
  };
  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    const change = taxChangeWords(saved, f);
    if (!change) {
      notify.info('Nothing changed.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Change CLOR’s GST settings?',
      message: change.message,
      confirmLabel: 'Save tax settings',
      tone: 'primary',
    });
    if (!ok) return;
    setBusy(true);
    setProblems([]);
    try {
      await opsSaveTax({ registered: f.registered, gstin: f.gstin || null, legalName: f.legalName || null, state: f.state || null, sac: f.sac || null, ratePercent: Number(f.ratePercent) });
      notify.success(f.registered ? `Saved. Quotes now add GST at ${f.ratePercent}%.` : 'Saved. No GST is charged.');
      load();
    } catch (err) {
      setProblems(err?.data?.problems || [errorWords(err, 'save the tax settings')]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        crumbs={['Billing and setup']}
        title="Tax"
        counts={tax.registered ? `GST registered · ${tax.gstin}` : 'Not GST registered'}
        actions={
          mayChange ? (
            <Button plain className="ws-btn ws-btn--primary" loading={busy} type="submit" form="ops-tax">
              Save tax settings
            </Button>
          ) : null
        }
      />
      <Panel title="Tax">
        <p className="ws-card-blurb">{tax.note}</p>
        <form id="ops-tax" className="grid gap-5" onSubmit={save} style={{ maxWidth: 560 }}>
          <label className="flex gap-2 items-start">
            <input type="checkbox" checked={f.registered} disabled={!mayChange} onChange={set('registered')} />
            <span>
              <span className="font-semibold">CLOR is GST registered</span>
              <span className="ws-card-blurb" style={{ display: 'block' }}>
                Off: prices are what customers pay, with no tax line. On: GST is added to every quote, CGST and SGST in CLOR’s state and IGST elsewhere.
              </span>
            </span>
          </label>
          <div className="grid gap-1">
            <label htmlFor="ops-tax-gstin" className="text-sm font-semibold">
              GSTIN
            </label>
            <input id="ops-tax-gstin" className="ui-input ui-mono" maxLength={15} value={f.gstin} disabled={!mayChange} onChange={onGstin} placeholder="29AAAAA0000A1Z5" />
            <span className="ws-card-blurb">The 15 characters on CLOR’s GST registration certificate (form GST REG-06).</span>
          </div>
          <div className="grid gap-1">
            <label htmlFor="ops-tax-name" className="text-sm font-semibold">
              Legal name
            </label>
            <input id="ops-tax-name" className="ui-input" maxLength={160} value={f.legalName} disabled={!mayChange} onChange={set('legalName')} placeholder="CLOR Applications Private Limited" />
            <span className="ws-card-blurb">Exactly as it is on the registration certificate. It is printed on CLOR’s invoices.</span>
          </div>
          <div className="grid gap-1">
            <label htmlFor="ops-tax-state" className="text-sm font-semibold">
              State
            </label>
            <select id="ops-tax-state" className="ui-select" value={f.state} disabled={!mayChange} onChange={set('state')}>
              <option value="">Choose</option>
              {STATES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <span className="ws-card-blurb">Filled in from the GSTIN’s first two digits. It decides CGST and SGST or IGST.</span>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <div className="grid gap-1">
              <label htmlFor="ops-tax-sac" className="text-sm font-semibold">
                SAC code
              </label>
              <input id="ops-tax-sac" className="ui-input tabular-nums" maxLength={8} inputMode="numeric" value={f.sac} disabled={!mayChange} onChange={set('sac')} placeholder="998314" />
              <span className="ws-card-blurb">The service code your accountant chose for CLOR’s subscriptions.</span>
            </div>
            <div className="grid gap-1">
              <label htmlFor="ops-tax-rate" className="text-sm font-semibold">
                Rate
              </label>
              <select id="ops-tax-rate" className="ui-select" value={f.ratePercent} disabled={!mayChange} onChange={set('ratePercent')}>
                {rates.map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </select>
              <span className="ws-card-blurb">18% for software subscriptions.</span>
            </div>
          </div>
          <ErrorSummary errors={Object.fromEntries(problems.map((p, i) => [`p${i}`, p]))} />
          {!mayChange ? <p className="ws-card-blurb">Only Finance can change this.</p> : <p className="ws-card-blurb">Saving asks for a code from your authenticator app.</p>}
        </form>
      </Panel>
    </>
  );
}
