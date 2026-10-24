import { formatMoney, round2 } from '@ui/utils/money';
import { GST_STATE_BY_CODE, computeGstForLine, getCompanyGstProfile, getGstStateFromGstin } from '@ui/utils/gst';
import { notify } from '@ui/components/ui/notify';
import { buildGstr1Json, buildGstr3bJson, downloadJson } from '@ui/utils/gstrExport';
import { lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, ChevronDown, Download, Plus, Search } from 'lucide-react';
import { exportGstr1Excel } from '@ui/utils/gstr1Excel';
import { exportListXlsx } from '@ui/utils/listXlsx';
import { formatDateIn, todayIso } from '@ui/utils/dates';
import { MSME_BANK_RATE, allocatedPaymentDate, daysAfter, estimateMsmeInterestWithRates, msmeDueDate } from '@ui/utils/msmeCompliance';
import { payableOutstanding } from '@ui/utils/onAccount';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import { MoreButton } from '@ui/components/list/ListPageParts';
import Drawer from '@ui/components/ui/Drawer';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import EInvoiceSettings from '../admin/EInvoiceSettings';
import { TDS_NATURES } from '../tds/ruleMaster';

const Gstr2bReco = lazy(() => import('../reports/Gstr2bReco'));

export const TaxCompliancesView = ({ db, setDb, currentCompany }) => {
  const [saving, setSaving] = useState(false);

  const savedProfile = (currentCompany?.profile && typeof currentCompany.profile === 'object') ? currentCompany.profile : {};
  const savedTax = (savedProfile?.taxCompliances && typeof savedProfile.taxCompliances === 'object') ? savedProfile.taxCompliances : {};

  const stateOptions = Array.from(
    new Set(Object.values(GST_STATE_BY_CODE || {}).map((s) => String(s || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const codeForStateName = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '';
    for (const [code, stateName] of Object.entries(GST_STATE_BY_CODE || {})) {
      if (String(stateName || '').trim().toLowerCase() === trimmed.toLowerCase()) return code;
    }
    return '';
  };

  const [gstEnabled, setGstEnabled] = useState(() => (savedTax?.gstEnabled ?? currentCompany?.gstEnabled ?? true) !== false);
  const [tdsEnabled, setTdsEnabled] = useState(() => Boolean(savedTax?.tds?.enabled ?? false));
  const [tcsEnabled, setTcsEnabled] = useState(() => Boolean(savedTax?.tcs?.enabled ?? false));

  const [gst, setGst] = useState(() => {
    const profile = getCompanyGstProfile(currentCompany);
    return {
      gstRegistration: profile.gstRegistration || 'Registered',
      gstin: profile.gstin || '',
      state: profile.state || '',
    };
  });

  const [tds, setTds] = useState(() => {
    const t = (savedTax?.tds && typeof savedTax.tds === 'object') ? savedTax.tds : {};
    return {
      registrationType: t.registrationType || 'Applicable',
      tan: t.tan || '',
      state: t.state || '',
      deductorName: t.deductorName || '',
      deductorType: t.deductorType || '',
      defaultNatureCode: t.defaultNatureCode || '',
    };
  });

  const [tcs, setTcs] = useState(() => {
    const t = (savedTax?.tcs && typeof savedTax.tcs === 'object') ? savedTax.tcs : {};
    return {
      registrationType: t.registrationType || 'Applicable',
      tan: t.tan || '',
      state: t.state || '',
    };
  });

  useEffect(() => {
    const profile = getCompanyGstProfile(currentCompany);
    const nextSavedProfile = (currentCompany?.profile && typeof currentCompany.profile === 'object') ? currentCompany.profile : {};
    const nextSavedTax = (nextSavedProfile?.taxCompliances && typeof nextSavedProfile.taxCompliances === 'object') ? nextSavedProfile.taxCompliances : {};
    setGst({
      gstRegistration: profile.gstRegistration || 'Registered',
      gstin: profile.gstin || '',
      state: profile.state || '',
    });
    setGstEnabled((nextSavedTax?.gstEnabled ?? currentCompany?.gstEnabled ?? true) !== false);
    setTdsEnabled(Boolean(nextSavedTax?.tds?.enabled ?? false));
    setTcsEnabled(Boolean(nextSavedTax?.tcs?.enabled ?? false));
    setTds({
      registrationType: nextSavedTax?.tds?.registrationType || 'Applicable',
      tan: nextSavedTax?.tds?.tan || '',
      state: nextSavedTax?.tds?.state || '',
    });
    setTcs({
      registrationType: nextSavedTax?.tcs?.registrationType || 'Applicable',
      tan: nextSavedTax?.tcs?.tan || '',
      state: nextSavedTax?.tcs?.state || '',
    });
  }, [currentCompany, db]);

  const saveAll = async () => {
    const gstReg = String(gst.gstRegistration || 'Registered').trim() || 'Registered';
    const gstinNormalized = String(gst.gstin || '').trim().toUpperCase();
    const stateFromGstin = getGstStateFromGstin(gstinNormalized);
    const nextGstState = stateFromGstin || String(gst.state || '').trim();

    const normalizedTdsTan = String(tds.tan || '').trim().toUpperCase();
    const normalizedTcsTan = String(tcs.tan || '').trim().toUpperCase();
    const nextTdsState = String(tds.state || '').trim();
    const nextTcsState = String(tcs.state || '').trim();

    if (gstEnabled) {
      if (!nextGstState) return notify.error('GST State is required when GST is enabled.');
      if (gstReg !== 'Unregistered' && !gstinNormalized) return notify.error('GSTIN is required for the selected GST Registration type.');
    }
    if (tdsEnabled) {
      if (!normalizedTdsTan) return notify.error('TDS TAN Number is required when TDS is enabled.');
      if (!nextTdsState) return notify.error('TDS State is required when TDS is enabled.');
    }
    if (tcsEnabled) {
      if (!normalizedTcsTan) return notify.error('TCS TAN Number is required when TCS is enabled.');
      if (!nextTcsState) return notify.error('TCS State is required when TCS is enabled.');
    }

    const nextTax = {
      ...(savedTax || {}),
      gstEnabled: Boolean(gstEnabled),
      tds: {
        enabled: Boolean(tdsEnabled),
        registrationType: String(tds.registrationType || 'Applicable').trim() || 'Applicable',
        tan: normalizedTdsTan,
        state: nextTdsState,
        /* The deductor, as the challan and the return need it named. */
        deductorName: String(tds.deductorName || '').trim(),
        deductorType: String(tds.deductorType || '').trim(),
        defaultNatureCode: String(tds.defaultNatureCode || '').trim().toUpperCase(),
      },
      tcs: {
        enabled: Boolean(tcsEnabled),
        registrationType: String(tcs.registrationType || 'Applicable').trim() || 'Applicable',
        tan: normalizedTcsTan,
        state: nextTcsState,
      },
    };

    setSaving(true);
    try {
      setDb({
        ...db,
        companies: (db.companies || []).map((c) =>
          c.id === currentCompany.id
            ? {
                ...c,
                gstEnabled: Boolean(gstEnabled),
                gstRegistration: gstReg,
                gstin: gstEnabled ? gstinNormalized : c.gstin,
                state: gstEnabled ? nextGstState : c.state,
                country: c.country || 'India',
                profile: {
                  ...(c?.profile && typeof c.profile === 'object' ? c.profile : {}),
                  taxCompliances: nextTax,
                },
              }
            : c
        ),
      });

      // NOTE: tax & compliance settings are stored locally only. The old
      // PUT /api/profile/company call was removed with the unused Sequelize
      // backend that served it; the live API has no such route, so the request
      // never reached a handler and its failure was never checked. A real
      // endpoint lands with the server-side company profile work.
      notify.success('Tax & compliances saved.');
      return;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <div className="ui-t-sec">Tax & Compliances</div>
          <div className="text-sm ui-muted">GST, TDS and TCS settings</div>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={saveAll}
          className={`px-4 py-2 rounded-lg ${saving ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="border rounded-xl p-5 shadow-sm ui-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold ui-fg">GST</div>
            <div className="text-xs ui-muted">Enable GST and keep registration details</div>
          </div>
          <label className="flex items-center gap-2 text-sm ui-fg select-none">
            <input
              type="checkbox"
              checked={gstEnabled}
              onChange={(e) => setGstEnabled(e.target.checked)}
              className="ui-checkbox"
            />
            <span>Enabled</span>
          </label>
        </div>

        {!gstEnabled ? (
          <div className="mt-4 text-sm ui-muted ui-sunken border rounded-lg px-3 py-3">
            GST is disabled.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="ui-label" htmlFor="app-gst-registration-type">GST Registration Type</label>
              <select id="app-gst-registration-type"
                value={gst.gstRegistration}
                onChange={(e) => setGst((p) => ({ ...p, gstRegistration: e.target.value }))}
                className="ui-select w-full ui-surface"
              >
                <option value="Registered">Registered</option>
                <option value="Unregistered">Unregistered</option>
                <option value="Composition">Composition</option>
                <option value="SEZ">SEZ</option>
              </select>
            </div>

            <div>
              <label className="ui-label" htmlFor="app-gst-number-gstin">GST Number (GSTIN)</label>
              <input id="app-gst-number-gstin"
                value={gst.gstin}
                onChange={(e) => {
                  const nextGstin = e.target.value;
                  const stateFromGstin = getGstStateFromGstin(nextGstin);
                  setGst((p) => ({
                    ...p,
                    gstin: nextGstin,
                    state: stateFromGstin ? stateFromGstin : p.state,
                  }));
                }}
                className="ui-input w-full"
                placeholder="e.g. 29ABCDE1234F1Z5"
              />
              <div className="text-xs ui-muted mt-1">State auto-fills from GSTIN (first 2 digits).</div>
            </div>

            <div>
              <label className="ui-label">State</label>
              <PopupSelect
                label={null}
      title="Select State"
                value={gst.state}
                onChange={(next) => setGst((p) => ({ ...p, state: next }))}
                options={stateOptions.map((s) => ({ value: s, label: s, code: codeForStateName(s) }))}
                placeholder="Select State"
              />
            </div>

            <div className="flex items-end">
              <div className="w-full text-sm ui-muted ui-sunken border rounded-lg px-3 py-2">
                Effective GST: {String(gst.state || '').trim() ? `${gst.state}` : 'Set state'}
              </div>
            </div>
          </div>
        )}
      </div>

      <EInvoiceSettings />

      <div className="border rounded-xl p-5 shadow-sm ui-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold ui-fg">TDS</div>
            <div className="text-xs ui-muted">Enable TDS and keep TAN details</div>
          </div>
          <label className="flex items-center gap-2 text-sm ui-fg select-none">
            <input
              type="checkbox"
              checked={tdsEnabled}
              onChange={(e) => setTdsEnabled(e.target.checked)}
              className="ui-checkbox"
            />
            <span>Enabled</span>
          </label>
        </div>

        {!tdsEnabled ? (
          <div className="mt-4 text-sm ui-muted ui-sunken border rounded-lg px-3 py-3">
            TDS is disabled.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="ui-label" htmlFor="app-registration-type">Registration Type</label>
              <select id="app-registration-type"
                value={tds.registrationType}
                onChange={(e) => setTds((p) => ({ ...p, registrationType: e.target.value }))}
                className="ui-select w-full ui-surface"
              >
                <option value="Applicable">Applicable</option>
                <option value="Not Applicable">Not Applicable</option>
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="app-tds-number-tan">TDS Number (TAN)</label>
              <input id="app-tds-number-tan"
                value={tds.tan}
                onChange={(e) => {
                  const next = e.target.value;
                  const maybeState = getGstStateFromGstin(next);
                  setTds((p) => ({ ...p, tan: next, state: maybeState ? maybeState : p.state }));
                }}
                className="ui-input w-full"
                placeholder="Enter TAN"
              />
            </div>
            <div>
              <label className="ui-label">State</label>
              <PopupSelect
                label={null}
      title="Select State"
                value={tds.state}
                onChange={(next) => setTds((p) => ({ ...p, state: next }))}
                options={stateOptions.map((s) => ({ value: s, label: s, code: codeForStateName(s) }))}
                placeholder="Select State"
              />
            </div>

            <div>
              <label className="ui-label" htmlFor="tds-deductor-name">Deductor name</label>
              <input
                id="tds-deductor-name"
                value={tds.deductorName}
                onChange={(e) => setTds((p) => ({ ...p, deductorName: e.target.value }))}
                className="ui-input w-full"
                placeholder={currentCompany?.name || 'As registered against the TAN'}
              />
              <div className="ui-caption mt-1">Printed on challans and carried into the quarterly return.</div>
            </div>

            <div>
              <label className="ui-label" htmlFor="tds-deductor-type">Deductor type</label>
              <select
                id="tds-deductor-type"
                value={tds.deductorType}
                onChange={(e) => setTds((p) => ({ ...p, deductorType: e.target.value }))}
                className="ui-select w-full ui-surface"
              >
                <option value="">Select</option>
                <option value="COMPANY">Company</option>
                <option value="FIRM">Firm / LLP</option>
                <option value="INDIVIDUAL_HUF">Individual or HUF</option>
                <option value="GOVERNMENT">Government</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            {/*
              A default nature, for the ordinary case.
              Most companies deduct under one section far more often than the
              rest; naming it here means a bill against a vendor nobody has
              configured still knows what it is. A nature on the vendor, or on
              the document, still wins over it.
            */}
            <div className="sm:col-span-2">
              <label className="ui-label" htmlFor="tds-default-nature">Default TDS nature</label>
              <select
                id="tds-default-nature"
                value={tds.defaultNatureCode}
                onChange={(e) => setTds((p) => ({ ...p, defaultNatureCode: e.target.value }))}
                className="ui-select w-full ui-surface"
              >
                <option value="">— none —</option>
                {TDS_NATURES.filter((n) => n.active !== false).map((n) => (
                  <option key={n.code} value={n.code}>{n.name}</option>
                ))}
              </select>
              <div className="ui-caption mt-1">
                Used only where neither the document nor the party names one. The section, rate and threshold come from
                the rule in force on each document’s own date.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border rounded-xl p-5 shadow-sm ui-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold ui-fg">TCS</div>
            <div className="text-xs ui-muted">Enable TCS and keep TAN details</div>
          </div>
          <label className="flex items-center gap-2 text-sm ui-fg select-none">
            <input
              type="checkbox"
              checked={tcsEnabled}
              onChange={(e) => setTcsEnabled(e.target.checked)}
              className="ui-checkbox"
            />
            <span>Enabled</span>
          </label>
        </div>

        {!tcsEnabled ? (
          <div className="mt-4 text-sm ui-muted ui-sunken border rounded-lg px-3 py-3">
            TCS is disabled.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="ui-label" htmlFor="app-registration-type-2">Registration Type</label>
              <select id="app-registration-type-2"
                value={tcs.registrationType}
                onChange={(e) => setTcs((p) => ({ ...p, registrationType: e.target.value }))}
                className="ui-select w-full ui-surface"
              >
                <option value="Applicable">Applicable</option>
                <option value="Not Applicable">Not Applicable</option>
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="app-tcs-number-tan">TCS Number (TAN)</label>
              <input id="app-tcs-number-tan"
                value={tcs.tan}
                onChange={(e) => {
                  const next = e.target.value;
                  const maybeState = getGstStateFromGstin(next);
                  setTcs((p) => ({ ...p, tan: next, state: maybeState ? maybeState : p.state }));
                }}
                className="ui-input w-full"
                placeholder="Enter TAN"
              />
            </div>
            <div>
              <label className="ui-label">State</label>
              <PopupSelect
                label={null}
      title="Select State"
                value={tcs.state}
                onChange={(next) => setTcs((p) => ({ ...p, state: next }))}
                options={stateOptions.map((s) => ({ value: s, label: s, code: codeForStateName(s) }))}
                placeholder="Select State"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Month picker + download for the portal-schema JSON. Lives beside the report
 * heading; the JSON is what the GST offline tool / portal imports.
 */
const GstrExportControl = ({ label, onExport }) => {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)); // yyyy-mm
  return (
    <div className="flex items-center gap-2">
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="ui-input w-auto text-sm"
        aria-label="Return period"
      />
      <button
        type="button"
        onClick={() => {
          const period = `${month.slice(5, 7)}${month.slice(0, 4)}`; // MMYYYY
          onExport(period);
        }}
        className="ui-btn ui-btn-primary"
      >
        <Download size={16} aria-hidden="true" /> {label}
      </button>
    </div>
  );
};

export const LegacyGstr1Report = ({ db, currentCompany }) => {
  const invoices = db.invoices.filter((i) => i.companyId === currentCompany.id);
  const creditNotes = db.creditNotes.filter((c) => c.companyId === currentCompany.id);

  const normalizeLine = (line, isIntra) => {
    const gstRate = Number(line.gstRate ?? 0);
    const taxableAmount = Number.isFinite(Number(line.taxableAmount))
      ? Number(line.taxableAmount)
      : Number.isFinite(Number(line.amount))
        ? Number(line.amount)
        : Number(line.quantity ?? 0) * Number(line.rate ?? 0);

    const hasSplit =
      Number.isFinite(Number(line.cgstAmount)) ||
      Number.isFinite(Number(line.sgstAmount)) ||
      Number.isFinite(Number(line.igstAmount)) ||
      Number.isFinite(Number(line.gstAmount));

    if (hasSplit) {
      return {
        gstRate,
        taxableAmount: round2(taxableAmount),
        cgstAmount: round2(Number(line.cgstAmount ?? 0)),
        sgstAmount: round2(Number(line.sgstAmount ?? 0)),
        igstAmount: round2(Number(line.igstAmount ?? 0)),
        gstAmount: round2(Number(line.gstAmount ?? 0)),
      };
    }

    const computed = computeGstForLine({
      quantity: Number(line.quantity ?? 1),
      rate: Number(line.rate ?? 0),
      gstRate,
      isIntra,
    });

    return {
      gstRate,
      taxableAmount: computed.taxableAmount,
      cgstAmount: computed.cgstAmount,
      sgstAmount: computed.sgstAmount,
      igstAmount: computed.igstAmount,
      gstAmount: computed.gstAmount,
    };
  };

  const addDocToSummary = (doc, sign, groups, totals) => {
    const isIntra = doc.taxType ? doc.taxType === 'CGST_SGST' : true;
    const lines = Array.isArray(doc.items) ? doc.items : [];

    lines.forEach((line) => {
      const nl = normalizeLine(line, isIntra);
      const gstRate = Number.isFinite(nl.gstRate) ? nl.gstRate : 0;
      const key = `${isIntra ? 'CGST_SGST' : 'IGST'}|${gstRate}`;

      const entry = groups.get(key) || {
        taxType: isIntra ? 'CGST/SGST' : 'IGST',
        gstRate,
        taxableAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        gstAmount: 0,
      };

      entry.taxableAmount = round2(entry.taxableAmount + sign * nl.taxableAmount);
      entry.cgstAmount = round2(entry.cgstAmount + sign * nl.cgstAmount);
      entry.sgstAmount = round2(entry.sgstAmount + sign * nl.sgstAmount);
      entry.igstAmount = round2(entry.igstAmount + sign * nl.igstAmount);
      entry.gstAmount = round2(entry.gstAmount + sign * nl.gstAmount);
      groups.set(key, entry);
    });

    totals.taxableAmount = round2(totals.taxableAmount + sign * Number(doc.subtotal ?? 0));
    totals.cgstAmount = round2(totals.cgstAmount + sign * Number(doc.cgstTotal ?? 0));
    totals.sgstAmount = round2(totals.sgstAmount + sign * Number(doc.sgstTotal ?? 0));
    totals.igstAmount = round2(totals.igstAmount + sign * Number(doc.igstTotal ?? 0));
    totals.gstAmount = round2(totals.gstAmount + sign * Number(doc.gstTotal ?? 0));
    totals.totalAmount = round2(totals.totalAmount + sign * Number(doc.total ?? 0));
  };

  const rateGroups = new Map();
  const totals = { taxableAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, gstAmount: 0, totalAmount: 0 };

  invoices.forEach((inv) => addDocToSummary(inv, +1, rateGroups, totals));
  creditNotes.forEach((cn) => addDocToSummary(cn, -1, rateGroups, totals));

  const rateRows = Array.from(rateGroups.values()).sort((a, b) => {
    if (a.taxType !== b.taxType) return a.taxType.localeCompare(b.taxType);
    return a.gstRate - b.gstRate;
  });

  const docRows = [
    ...invoices.map((inv) => ({
      type: 'Invoice',
      number: inv.number,
      date: inv.date,
      partyName: inv.customerName,
      partyGstin: inv.customerGstin || '',
      placeOfSupply: inv.placeOfSupplyState || '',
      taxable: Number(inv.subtotal ?? 0),
      cgst: Number(inv.cgstTotal ?? 0),
      sgst: Number(inv.sgstTotal ?? 0),
      igst: Number(inv.igstTotal ?? 0),
      total: Number(inv.total ?? 0),
    })),
    ...creditNotes.map((cn) => ({
      type: 'Credit Note',
      number: cn.number,
      date: cn.date,
      partyName: cn.customerName,
      partyGstin: cn.customerGstin || '',
      placeOfSupply: cn.placeOfSupplyState || '',
      taxable: -Number(cn.subtotal ?? 0),
      cgst: -Number(cn.cgstTotal ?? 0),
      sgst: -Number(cn.sgstTotal ?? 0),
      igst: -Number(cn.igstTotal ?? 0),
      total: -Number(cn.total ?? 0),
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="ui-t-sec">GST - GSTR-1 (Summary)</h3>
        <GstrExportControl
          label="Portal JSON"
          onExport={(period) => {
            if (!String(currentCompany?.gstin || '').trim()) {
              notify.error('Set the company GSTIN in Company Profile before exporting a return.');
              return;
            }
            const json = buildGstr1Json({ invoices, creditNotes, items: db.items || [], company: currentCompany, period });
            downloadJson(`GSTR1_${currentCompany.gstin}_${period}.json`, json);
            notify.success(`GSTR-1 JSON for ${period} downloaded.`);
          }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">Taxable Value (Net)</div>
          <div className="ui-money-lg">{formatMoney(totals.taxableAmount, currentCompany)}</div>
        </div>
        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">GST (Net)</div>
          <div className="ui-money-lg">{formatMoney(totals.gstAmount, currentCompany)}</div>
          <div className="text-xs ui-muted mt-1">
            CGST {formatMoney(totals.cgstAmount, currentCompany)} · SGST {formatMoney(totals.sgstAmount, currentCompany)} · IGST {formatMoney(totals.igstAmount, currentCompany)}
          </div>
        </div>
        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">Total (Net)</div>
          <div className="ui-money-lg">{formatMoney(totals.totalAmount, currentCompany)}</div>
        </div>
      </div>

      <div className="ui-surface rounded-xl shadow-sm overflow-hidden border ui-border-c">
        <div className="px-6 py-4 border-b ui-sunken">
          <h4 className="font-bold">Rate-wise Summary</h4>
        </div>
        <table className="ui-table w-full">
          <thead className="ui-sunken border-b">
            <tr>
              <th className="ui-th">Tax Type</th>
              <th className="ui-th ui-num">GST %</th>
              <th className="ui-th ui-num">Taxable</th>
              <th className="ui-th ui-num">CGST</th>
              <th className="ui-th ui-num">SGST</th>
              <th className="ui-th ui-num">IGST</th>
              <th className="ui-th ui-num">GST</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border))]">
            {rateRows.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-10 text-center ui-muted">
                  No GST transactions yet.
                </td>
              </tr>
            ) : (
              rateRows.map((r) => (
                <tr key={`${r.taxType}-${r.gstRate}`} className="ui-hover-sunken">
                  <td className="px-4 py-2.5 ui-col-meta">{r.taxType}</td>
                  <td className="ui-col-meta px-4 py-2.5 text-right">{Number(r.gstRate || 0).toFixed(2)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.taxableAmount || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.cgstAmount || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.sgstAmount || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.igstAmount || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.gstAmount || 0), currentCompany)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="ui-surface rounded-xl shadow-sm overflow-hidden border ui-border-c">
        <div className="px-6 py-4 border-b ui-sunken">
          <h4 className="font-bold">Document Summary (Invoices & Credit Notes)</h4>
        </div>
        <table className="ui-table w-full">
          <thead className="ui-sunken border-b">
            <tr>
              <th className="ui-th">Type</th>
              <th className="ui-th">Number</th>
              <th className="ui-th ui-col-h-center">Date</th>
              <th className="ui-th">Party</th>
              <th className="ui-th">GSTIN</th>
              <th className="ui-th">POS</th>
              <th className="ui-th ui-num">Taxable</th>
              <th className="ui-th ui-num">CGST</th>
              <th className="ui-th ui-num">SGST</th>
              <th className="ui-th ui-num">IGST</th>
              <th className="ui-th ui-num">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border))]">
            {docRows.length === 0 ? (
              <tr>
                <td colSpan="11" className="px-6 py-10 text-center ui-muted">
                  No invoices or credit notes found.
                </td>
              </tr>
            ) : (
              docRows.map((r, idx) => (
                <tr key={`${r.type}-${r.number}-${idx}`} className="ui-hover-sunken">
                  <td className="px-4 py-2.5 ui-col-meta">{r.type}</td>
                  <td className="px-4 py-2.5 ui-col-entity">{r.number}</td>
                  <td className="px-4 py-2.5 ui-col-meta">{r.date}</td>
                  <td className="px-4 py-2.5 ui-col-meta">{r.partyName}</td>
                  <td className="px-4 py-2.5 ui-col-meta">{r.partyGstin}</td>
                  <td className="px-4 py-2.5 ui-col-meta">{r.placeOfSupply}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.taxable || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.cgst || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.sgst || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.igst || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.total || 0), currentCompany)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const gstDocValues = (doc, sign = 1) => ({
  count: 1,
  taxable: sign * Number(doc?.subtotal ?? doc?.taxableTotal ?? 0),
  igst: sign * Number(doc?.igstTotal ?? 0),
  cgst: sign * Number(doc?.cgstTotal ?? 0),
  sgst: sign * Number(doc?.sgstTotal ?? 0),
  cess: sign * Number(doc?.cessTotal ?? 0),
  tax: sign * Number(doc?.gstTotal ?? 0),
  total: sign * Number(doc?.total ?? 0),
});

const addGstValues = (rows) => rows.reduce((sum, row) => ({
  count: sum.count + Number(row.values?.count || 0),
  taxable: sum.taxable + Number(row.values?.taxable || 0),
  igst: sum.igst + Number(row.values?.igst || 0),
  cgst: sum.cgst + Number(row.values?.cgst || 0),
  sgst: sum.sgst + Number(row.values?.sgst || 0),
  cess: sum.cess + Number(row.values?.cess || 0),
  tax: sum.tax + Number(row.values?.tax || 0),
  total: sum.total + Number(row.values?.total || 0),
}), { count: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tax: 0, total: 0 });

export const Gstr1Report = ({ db, currentCompany, search = '', onSearchChange, onDetailChange }) => {
  const [selectedSectionKey, setSelectedSectionKey] = useState('');
  useEffect(() => {
    onDetailChange?.(Boolean(selectedSectionKey));
  }, [onDetailChange, selectedSectionKey]);
  const companyId = currentCompany.id;
  const eligible = (row) => row?.companyId === companyId && !/draft|cancel/i.test(String(row?.status || ''));
  const invoices = (db.invoices || []).filter(eligible);
  const creditNotes = (db.creditNotes || []).filter(eligible);
  const receipts = (db.payments || []).filter((row) => row?.companyId === companyId && /receipt/i.test(String(row?.voucherType || row?.direction || row?.type || '')));
  const journals = (db.journalEntries || []).filter((row) => row?.companyId === companyId && !/draft|reversed|cancel/i.test(String(row?.status || '')));
  const gstinOf = (row) => String(row?.customerGstin || row?.partyGstin || row?.gstin || '').trim();
  const isExport = (row) => /export/i.test(String(row?.supplyType || row?.taxTreatment || row?.placeOfSupplyType || ''));
  const isNil = (row) => Number(row?.gstTotal || 0) === 0;
  const isInterstate = (row) => String(row?.taxType || '').toUpperCase() === 'IGST';
  const invoiceRow = (doc) => ({ doc, values: gstDocValues(doc, 1) });
  const noteRow = (doc) => ({ doc, values: gstDocValues(doc, -1) });

  const b2b = invoices.filter((row) => gstinOf(row) && !isExport(row) && !isNil(row)).map(invoiceRow);
  const exports = invoices.filter(isExport).map(invoiceRow);
  const nil = invoices.filter(isNil).map(invoiceRow);
  const b2cl = invoices.filter((row) => !gstinOf(row) && !isNil(row) && !isExport(row) && isInterstate(row) && Number(row.total || 0) > 250000).map(invoiceRow);
  const b2cs = invoices.filter((row) => !gstinOf(row) && !isNil(row) && !isExport(row) && !b2cl.some((candidate) => candidate.doc === row)).map(invoiceRow);
  const cdnr = creditNotes.filter((row) => gstinOf(row)).map(noteRow);
  const cdnur = creditNotes.filter((row) => !gstinOf(row)).map(noteRow);
  const advanceRows = receipts.filter((row) => Number(row.advanceAmount || 0) > 0).map((doc) => ({ doc, values: { count: 1, taxable: Number(doc.advanceAmount || 0), igst: 0, cgst: 0, sgst: 0, cess: 0, tax: Number(doc.gstTotal || 0), total: Number(doc.advanceAmount || 0) } }));
  const adjustmentRows = journals.filter((entry) => (entry.lines || []).some((line) => /output\s*(igst|cgst|sgst|gst)|gst\s*output/i.test(String(line.ledgerName || line.accountName || line.description || '')))).map((doc) => {
    const outputLines = (doc.lines || []).filter((line) => /output\s*(igst|cgst|sgst|gst)|gst\s*output/i.test(String(line.ledgerName || line.accountName || line.description || '')));
    const tax = outputLines.reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0);
    return { doc, values: { count: 1, taxable: Number(doc.taxableAmount || 0), igst: 0, cgst: 0, sgst: 0, cess: 0, tax, total: Number(doc.amount || tax) } };
  });
  const hsnDocs = [...invoices.map(invoiceRow), ...creditNotes.map(noteRow)];

  const sections = [
    ['b2b', '4A, 4B, 6B, 6C', 'B2B, SEZ and Deemed Export Invoices', b2b],
    ['b2cl', '5', 'B2C (Large) Invoices', b2cl],
    ['exports', '6A', 'Exports Invoices', exports],
    ['b2cs', '7', 'B2C (Others)', b2cs],
    ['nil', '8A, 8B, 8C, 8D', 'Nil Rated, Exempt and Non-GST Supplies', nil],
    ['cdnr', '9B', 'Credit / Debit Notes (Registered)', cdnr],
    ['cdnur', '9B', 'Credit / Debit Notes (Unregistered)', cdnur],
    ['advance', '11A(1), 11A(2)', 'Tax Liability on Advances Received', advanceRows],
    ['adjustments', '11B(1), 11B(2)', 'Adjustment of Advances / Journal Corrections', adjustmentRows],
    ['hsn', '12', 'HSN-wise Summary of Outward Supplies', hsnDocs],
    ['documents', '13', 'Documents Issued', [...invoices.map(invoiceRow), ...creditNotes.map(noteRow)]],
    ['eco', '14', 'Supplies made through E-Commerce Operators', invoices.filter((row) => row.ecommerceOperator || row.ecoGstin).map(invoiceRow)],
    ['section95', '15', 'Supplies under Section 9(5)', invoices.filter((row) => row.section9_5).map(invoiceRow)],
  ].map(([key, code, label, rows]) => ({ key, code, label, rows, values: addGstValues(rows) }));
  const selectedSection = sections.find((section) => section.key === selectedSectionKey) || null;
  const searchText = String(search || '').trim().toLowerCase();
  const displaySections = searchText ? sections.filter((section) => {
    if (`${section.code} ${section.label}`.toLowerCase().includes(searchText)) return true;
    return section.rows.some(({ doc }) => [doc.number, doc.receiptNo, doc.entryNo, doc.customerName, doc.partyName, doc.vendorName, gstinOf(doc)].some((value) => String(value || '').toLowerCase().includes(searchText)));
  }) : sections;

  const detailModel = (() => {
    if (!selectedSection) return { columns: [], rows: [] };
    if (selectedSection.key === 'hsn') {
      const itemById = new Map((db.items || []).map((item) => [String(item.id), item]));
      const grouped = new Map();
      for (const { doc, values } of selectedSection.rows) {
        const sign = values.total < 0 ? -1 : 1;
        for (const line of (doc.items || [])) {
          const item = itemById.get(String(line.itemId || '')) || {};
          const hsn = String(line.hsnSac || line.hsn || item.hsnSac || item.hsn || 'Unclassified');
          const rate = Number(line.gstRate ?? item.gstRate ?? 0);
          const key = `${hsn}|${rate}|${line.unit || item.unit || 'NOS'}`;
          const rawQuantity = Number(line.quantity || line.qty || 0);
          const quantity = sign * rawQuantity;
          const taxable = sign * Number(line.taxableAmount ?? line.amount ?? rawQuantity * Number(line.rate || 0));
          const current = grouped.get(key) || { hsn, description: line.description || line.name || item.name || '—', uqc: line.unit || item.unit || 'NOS', quantity: 0, rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
          current.quantity += quantity;
          current.taxable += taxable;
          current.igst += sign * Number(line.igstAmount || 0);
          current.cgst += sign * Number(line.cgstAmount || 0);
          current.sgst += sign * Number(line.sgstAmount || 0);
          current.cess += sign * Number(line.cessAmount || 0);
          grouped.set(key, current);
        }
      }
      return { columns: [['hsn','HSN/SAC'],['description','Description'],['uqc','UQC'],['quantity','Total Qty','number'],['rate','GST Rate','number'],['taxable','Taxable Value','money'],['igst','IGST','money'],['cgst','CGST','money'],['sgst','SGST/UTGST','money'],['cess','Cess','money']], rows: [...grouped.values()] };
    }
    if (selectedSection.key === 'documents') {
      const grouped = new Map();
      for (const { doc } of selectedSection.rows) {
        const type = creditNotes.includes(doc) ? 'Credit Notes' : 'Invoices';
        const current = grouped.get(type) || { type, from: doc.number || '', to: doc.number || '', total: 0, cancelled: 0, net: 0 };
        current.from = current.from || doc.number || '';
        current.to = doc.number || current.to;
        current.total += 1;
        if (/cancel/i.test(String(doc.status || ''))) current.cancelled += 1;
        current.net = current.total - current.cancelled;
        grouped.set(type, current);
      }
      return { columns: [['type','Document Type'],['from','Serial No. From'],['to','Serial No. To'],['total','Total Issued','number'],['cancelled','Cancelled','number'],['net','Net Issued','number']], rows: [...grouped.values()] };
    }
    if (['advance', 'adjustments'].includes(selectedSection.key)) return {
      columns: [['date','Date'],['number','Voucher No.'],['party','Party'],['place','Place of Supply'],['rate','GST Rate','number'],['taxable','Advance / Adjustment','money'],['igst','IGST','money'],['cgst','CGST','money'],['sgst','SGST/UTGST','money']],
      rows: selectedSection.rows.map(({ doc, values }) => ({ date: doc.date || '—', number: doc.number || doc.receiptNo || doc.entryNo || '—', party: doc.customerName || doc.partyName || '—', place: doc.placeOfSupplyState || '—', rate: Number(doc.gstRate || 0), ...values })),
    };
    return {
      columns: [['date','Date'],['number','Voucher No.'],['type','Type'],['party','Party'],['gstin','GSTIN'],['place','Place of Supply'],['taxable','Taxable Value','money'],['igst','IGST','money'],['cgst','CGST','money'],['sgst','SGST/UTGST','money'],['cess','Cess','money'],['total','Invoice Amount','money']],
      rows: selectedSection.rows.map(({ doc, values }) => ({ date: doc.date || '—', number: doc.number || doc.receiptNo || doc.entryNo || '—', type: doc.sourceDocType || (creditNotes.includes(doc) ? 'Credit Note' : 'Invoice'), party: doc.customerName || doc.partyName || doc.vendorName || '—', gstin: gstinOf(doc) || '—', place: doc.placeOfSupplyState || '—', ...values })),
    };
  })();

  if (selectedSection) return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3 border-b pb-3 ui-border-c">
      <div><h3 className="ui-t-sec whitespace-nowrap">{selectedSection.code} — {selectedSection.label}</h3><p className="ui-helper">GSTR-1 · {selectedSection.values.count} voucher{selectedSection.values.count === 1 ? '' : 's'}</p></div>
    </div>
    <div className="ui-table-shell overflow-auto" data-fill-viewport style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}><table className="ui-table w-max min-w-full table-auto"><thead><tr>{detailModel.columns.map(([key, label, kind]) => <th key={key} className={`whitespace-nowrap ${kind ? 'text-right' : ''}`}>{label}</th>)}</tr></thead><tbody>{detailModel.rows.length ? detailModel.rows.map((row, index) => <tr key={`${row.number || row.hsn || row.type || 'row'}-${index}`}>{detailModel.columns.map(([key,,kind]) => <td key={key} className={`whitespace-nowrap ${kind ? 'ui-num' : ''} ${kind === 'money' ? 'ui-money' : ''}`}>{kind === 'money' ? formatMoney(row[key], currentCompany) : row[key] ?? '—'}</td>)}</tr>) : <tr><td colSpan={Math.max(1, detailModel.columns.length)} className="py-12 text-center ui-muted">No entries in this section for the selected period.</td></tr>}</tbody></table></div>
  </div>;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="ui-t-sec">GSTR-1 Return View</h3><p className="ui-helper">Statutory sections calculated from posted vouchers for the selected period.</p></div><div className="relative"><Search size={15} className="ui-muted absolute start-3 top-1/2 -translate-y-1/2" /><input aria-label="Search GST report" className="ui-input w-64 ps-9" placeholder="Search section or voucher…" value={search} onChange={(event) => onSearchChange?.(event.target.value)} /></div></div>
    <div className="ui-table-shell overflow-auto" data-fill-viewport style={{ '--table-scroll-h': 'calc(100dvh - 15rem)' }}><table className="ui-table w-max min-w-full table-auto"><thead><tr><th className="whitespace-nowrap">Particulars</th><th className="whitespace-nowrap text-right">Vch Count</th><th className="whitespace-nowrap text-right">Taxable Amount</th><th className="whitespace-nowrap text-right">IGST</th><th className="whitespace-nowrap text-right">CGST</th><th className="whitespace-nowrap text-right">SGST/UTGST</th><th className="whitespace-nowrap text-right">Cess</th><th className="whitespace-nowrap text-right">Invoice Amount</th></tr></thead><tbody>{displaySections.map((section) => <tr key={section.key} className="cursor-pointer" onClick={() => setSelectedSectionKey(section.key)}><td className="whitespace-nowrap"><span className="ui-link font-semibold">{section.code} — {section.label}</span></td><td className="ui-num">{section.values.count}</td>{['taxable','igst','cgst','sgst','cess','total'].map((key) => <td key={key} className="ui-money ui-num whitespace-nowrap">{formatMoney(section.values[key], currentCompany)}</td>)}</tr>)}</tbody></table></div>
  </div>;
};

const Gstr3bReport = ({ db, currentCompany }) => {
  const invoices = db.invoices.filter((i) => i.companyId === currentCompany.id);
  const creditNotes = db.creditNotes.filter((c) => c.companyId === currentCompany.id);
  const bills = db.bills.filter((b) => b.companyId === currentCompany.id);
  const expenses = db.expenses.filter((e) => e.companyId === currentCompany.id);

  const sumDocs = (docs, sign) => {
    return docs.reduce(
      (acc, d) => {
        acc.taxable += sign * Number(d.subtotal ?? d.taxableTotal ?? 0);
        acc.cgst += sign * Number(d.cgstTotal ?? 0);
        acc.sgst += sign * Number(d.sgstTotal ?? 0);
        acc.igst += sign * Number(d.igstTotal ?? 0);
        acc.gst += sign * Number(d.gstTotal ?? 0);
        return acc;
      },
      { taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0 }
    );
  };

  const outward = sumDocs(invoices, +1);
  const outwardCredit = sumDocs(creditNotes, -1);
  const outwardNet = {
    taxable: round2(outward.taxable + outwardCredit.taxable),
    cgst: round2(outward.cgst + outwardCredit.cgst),
    sgst: round2(outward.sgst + outwardCredit.sgst),
    igst: round2(outward.igst + outwardCredit.igst),
    gst: round2(outward.gst + outwardCredit.gst),
  };

  const inwardBills = sumDocs(bills, +1);
  const inwardExpenses = sumDocs(expenses, +1);
  const inwardItc = {
    taxable: round2(inwardBills.taxable + inwardExpenses.taxable),
    cgst: round2(inwardBills.cgst + inwardExpenses.cgst),
    sgst: round2(inwardBills.sgst + inwardExpenses.sgst),
    igst: round2(inwardBills.igst + inwardExpenses.igst),
    gst: round2(inwardBills.gst + inwardExpenses.gst),
  };

  const netPayable = {
    cgst: round2(outwardNet.cgst - inwardItc.cgst),
    sgst: round2(outwardNet.sgst - inwardItc.sgst),
    igst: round2(outwardNet.igst - inwardItc.igst),
    gst: round2(outwardNet.gst - inwardItc.gst),
  };

  return (
    <div className="space-y-6">
      <h3 className="ui-t-sec">GST - GSTR-3B (Summary)</h3>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">Outward Supplies (Net)</div>
          <div className="ui-money-lg">{formatMoney(outwardNet.gst, currentCompany)}</div>
          <div className="text-xs ui-muted mt-1">
            Taxable {formatMoney(outwardNet.taxable, currentCompany)} · CGST {formatMoney(outwardNet.cgst, currentCompany)} · SGST {formatMoney(outwardNet.sgst, currentCompany)} · IGST {formatMoney(outwardNet.igst, currentCompany)}
          </div>
        </div>

        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">ITC (Bills + Expenses)</div>
          <div className="ui-money-lg">{formatMoney(inwardItc.gst, currentCompany)}</div>
          <div className="text-xs ui-muted mt-1">
            Taxable {formatMoney(inwardItc.taxable, currentCompany)} · CGST {formatMoney(inwardItc.cgst, currentCompany)} · SGST {formatMoney(inwardItc.sgst, currentCompany)} · IGST {formatMoney(inwardItc.igst, currentCompany)}
          </div>
        </div>

        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">Net Tax Payable (Proxy)</div>
          <div className="ui-money-lg">{formatMoney(netPayable.gst, currentCompany)}</div>
          <div className="text-xs ui-muted mt-1">
            CGST {formatMoney(netPayable.cgst, currentCompany)} · SGST {formatMoney(netPayable.sgst, currentCompany)} · IGST {formatMoney(netPayable.igst, currentCompany)}
          </div>
        </div>
      </div>

      <div className="ui-surface rounded-xl shadow-sm p-6 border">
        <h4 className="font-bold mb-3">What this report uses</h4>
        <div className="text-sm ui-muted space-y-1">
          <div>Outward: Invoices minus Credit Notes (based on saved GST totals).</div>
          <div>ITC: Bills and Expenses (based on saved GST totals).</div>
        </div>
      </div>
    </div>
  );
};

const GST_REPORT_OPTIONS = [
  ['gstr1', 'GSTR-1 (Outward Supplies)'],
  ['gstr3b', 'GSTR-3B'],
  ['itc', 'Input Tax Credit (ITC)'],
  ['reconciliation', 'GST Reconciliation'],
  ['einvoice', 'E-Invoice Register'],
  ['eway', 'E-Way Bill Register'],
];

export const GstComplianceWorkspace = ({ db, currentCompany, branches = [], initialReport = 'gstr1', onBack }) => {
  const today = new Date();
  const fyStart = today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
  const [report, setReport] = useState(initialReport);
  const financialYear = `${fyStart}-${String(fyStart + 1).slice(-2)}`;
  const [period, setPeriod] = useState('all');
  const gstinOptions = useMemo(() => {
    const found = [];
    const add = (gstin, label) => {
      const value = String(gstin || '').trim().toUpperCase();
      if (value && !found.some((item) => item.value === value)) found.push({ value, label: label ? `${value} · ${label}` : value });
    };
    add(currentCompany.gstin, currentCompany.name || 'Company');
    for (const branch of branches) add(branch.gstin || branch.gstIn || branch.registrationGstin, branch.name || branch.branchName);
    return found;
  }, [branches, currentCompany.gstin, currentCompany.name]);
  const [selectedGstin, setSelectedGstin] = useState(() => String(currentCompany.gstin || '').trim().toUpperCase());
  const [search, setSearch] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [gstr1DetailOpen, setGstr1DetailOpen] = useState(false);
  const [gstr1ReportKey, setGstr1ReportKey] = useState(0);

  const inScope = useCallback((row) => {
    if (!row || row.companyId !== currentCompany.id) return false;
    if (selectedGstin) {
      const documentGstin = String(row.sellerGstin || row.companyGstin || row.registrationGstin || '').trim().toUpperCase();
      if (documentGstin && documentGstin !== selectedGstin) return false;
      const matchingBranchIds = branches.filter((branch) => String(branch.gstin || branch.gstIn || branch.registrationGstin || '').trim().toUpperCase() === selectedGstin).map((branch) => String(branch.id));
      if (matchingBranchIds.length && row.branchId && !matchingBranchIds.includes(String(row.branchId))) return false;
    }
    const date = String(row.date || row.invoiceDate || row.billDate || '');
    if (!date) return true;
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    const fy = month >= 4 ? year : year - 1;
    if (fy !== Number(financialYear.slice(0, 4))) return false;
    return period === 'all' || String(month).padStart(2, '0') === period;
  }, [branches, currentCompany.id, financialYear, period, selectedGstin]);

  const scopedDb = useMemo(() => {
    const next = { ...db };
    for (const key of ['invoices', 'creditNotes', 'bills', 'debitNotes', 'expenses', 'payments', 'journalEntries']) {
      next[key] = (Array.isArray(db[key]) ? db[key] : []).filter(inScope);
    }
    return next;
  }, [db, inScope]);

  const outwardDocs = useMemo(() => [
    ...(scopedDb.invoices || []).map((row) => ({ ...row, complianceType: 'Invoice', sign: 1 })),
    ...(scopedDb.creditNotes || []).map((row) => ({ ...row, complianceType: 'Credit Note', sign: -1 })),
  ], [scopedDb]);
  const inwardDocs = useMemo(() => [
    ...(scopedDb.bills || []).map((row) => ({ ...row, complianceType: 'Purchase Bill', sign: 1 })),
    ...(scopedDb.expenses || []).map((row) => ({ ...row, complianceType: 'Expense', sign: 1 })),
    ...(scopedDb.debitNotes || []).map((row) => ({ ...row, complianceType: 'Debit Note', sign: -1 })),
  ], [scopedDb]);

  const rows = report === 'itc' || report === 'reconciliation' ? inwardDocs : outwardDocs;
  const visibleRows = rows.filter((row) => !search || [row.number, row.invoiceNumber, row.billNumber, row.customerName, row.vendorName, row.reference].some((v) => String(v || '').toLowerCase().includes(search.toLowerCase())));
  const selectedLabel = GST_REPORT_OPTIONS.find(([key]) => key === report)?.[1] || 'GST Report';
  const reportColumns = report === 'itc' ? [
    { key: 'party', label: 'Party name', value: (row) => row.vendorName || row.partyName || row.customerName || '—' },
    { key: 'gstin', label: 'GSTN', value: (row) => row.vendorGstin || row.partyGstin || row.gstin || '—' },
    { key: 'number', label: 'Invoice number', value: (row) => row.refNo || row.invoiceNumber || row.billNumber || row.number || '—' },
    { key: 'date', label: 'Inv date', value: (row) => row.refDate || row.invoiceDate || row.billDate || row.date || '—' },
    { key: 'total', label: 'Inv Value', money: true, value: (row) => Number(row.total || 0) * row.sign },
    { key: 'taxable', label: 'Taxable value', money: true, value: (row) => Number(row.subtotal || row.taxableTotal || 0) * row.sign },
    { key: 'cgst', label: 'CGST', money: true, value: (row) => Number(row.cgstTotal || 0) * row.sign },
    { key: 'sgst', label: 'SGST', money: true, value: (row) => Number(row.sgstTotal || 0) * row.sign },
    { key: 'igst', label: 'IGST', money: true, value: (row) => Number(row.igstTotal || 0) * row.sign },
  ] : [
    { key: 'type', label: 'Type', value: (row) => row.complianceType },
    { key: 'number', label: 'Document No.', value: (row) => row.number || row.invoiceNumber || row.billNumber || '—' },
    { key: 'date', label: 'Date', value: (row) => row.date || '—' },
    { key: 'party', label: 'Party', value: (row) => row.customerName || row.vendorName || '—' },
    { key: 'gstin', label: 'GSTIN', value: (row) => row.customerGstin || row.vendorGstin || row.gstin || '—' },
    { key: 'taxable', label: 'Taxable Value', money: true, value: (row) => Number(row.subtotal || row.taxableTotal || 0) * row.sign },
    { key: 'gst', label: 'GST', money: true, value: (row) => Number(row.gstTotal || 0) * row.sign },
    { key: 'total', label: 'Total Amount', money: true, value: (row) => Number(row.total || 0) * row.sign },
  ];

  const exportCurrent = async () => {
    if (report === 'gstr1') {
      if (!selectedGstin) {
        notify.error('Select a GSTIN before exporting the GSTR-1 workbook.');
        return;
      }
      if (period === 'all') {
        notify.error('Select a filing month before exporting the GSTR-1 workbook.');
        return;
      }
      const month = Number(period);
      const filingYear = month >= 4 ? fyStart : fyStart + 1;
      const portalPeriod = `${period}${filingYear}`;
      const monthName = new Date(filingYear, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      await exportGstr1Excel({ db: scopedDb, company: { ...currentCompany, gstin: selectedGstin }, gstin: selectedGstin, periodLabel: monthName, portalPeriod });
      return;
    }
    await exportListXlsx({
      fileName: selectedLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      sheetName: selectedLabel,
      subtitle: period === 'all' ? financialYear : period,
      columns: reportColumns.map((column) => ({ key: column.key, label: column.label, type: column.money ? 'number' : 'text', align: column.money ? 'right' : 'left', value: column.value })),
      rows: visibleRows,
    });
  };

  const exportPortalJson = () => {
    if (!selectedGstin) {
      notify.error('Select a GSTIN before exporting GST Portal JSON.');
      return;
    }
    if (period === 'all') {
      notify.error('Select a filing month before exporting GST Portal JSON.');
      return;
    }
    if (report !== 'gstr1' && report !== 'gstr3b') {
      notify.error('GST Portal JSON is available for GSTR-1 and GSTR-3B.');
      return;
    }

    const month = Number(period);
    const filingYear = month >= 4 ? fyStart : fyStart + 1;
    const portalPeriod = `${period}${filingYear}`;
    const exportCompany = { ...currentCompany, gstin: selectedGstin };
    const json = report === 'gstr1'
      ? buildGstr1Json({
          invoices: scopedDb.invoices || [],
          creditNotes: scopedDb.creditNotes || [],
          items: db.items || [],
          company: exportCompany,
          period: portalPeriod,
        })
      : buildGstr3bJson({
          invoices: scopedDb.invoices || [],
          creditNotes: scopedDb.creditNotes || [],
          bills: scopedDb.bills || [],
          expenses: scopedDb.expenses || [],
          debitNotes: scopedDb.debitNotes || [],
          company: exportCompany,
          period: portalPeriod,
        });
    const returnName = report === 'gstr1' ? 'GSTR1' : 'GSTR3B';
    downloadJson(`${returnName}_${selectedGstin}_${portalPeriod}.json`, json);
    notify.success(`${returnName} GST Portal JSON downloaded.`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-[rgb(var(--heading-bg))] px-3 py-2 ui-border-c">
        <div className="flex min-w-0 items-center gap-2"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { if (report === 'gstr1' && gstr1DetailOpen) setGstr1ReportKey((value) => value + 1); else onBack?.(); }}><ArrowLeft size={15} /> Back</button><h1 className="ui-t-page">GST</h1></div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select id="gst-report-select" aria-label="Select report" className="ui-select ui-ctl-compact w-64 font-semibold" value={report} onChange={(e) => { setGstr1DetailOpen(false); setReport(e.target.value); }}>{GST_REPORT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{`Select report · ${label}`}</option>)}</select>
          <select id="gst-period" aria-label="Period" className="ui-select ui-ctl-compact w-40" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">Period · All periods</option>
            {['April','May','June','July','August','September','October','November','December','January','February','March'].map((name, index) => {
              const month = ((index + 3) % 12) + 1;
              return <option key={name} value={String(month).padStart(2, '0')}>{`Period · ${name}`}</option>;
            })}
          </select>
          <select id="gst-gstin-select" aria-label="GSTIN" className="ui-select ui-ctl-compact ui-mono w-56" value={selectedGstin} onChange={(e) => setSelectedGstin(e.target.value)}>{gstinOptions.length ? gstinOptions.map((item) => <option key={item.value} value={item.value}>{`GSTIN · ${item.label}`}</option>) : <option value="">GSTIN · Not configured</option>}</select>
          <div className="relative">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((open) => !open)}><Download size={15} /> Export <ChevronDown size={14} /></button>
            {exportOpen ? <div role="menu" className="absolute end-0 top-[calc(100%+0.35rem)] z-40 w-56 overflow-hidden rounded-lg border bg-white p-1 shadow-lg ui-border-c">
              <button type="button" role="menuitem" className="w-full rounded-md px-3 py-2 text-start text-sm font-medium ui-hover-sunken" onClick={() => { setExportOpen(false); exportCurrent(); }}>
                <span className="block">Export Excel</span><span className="block text-xs font-normal ui-muted">{report === 'gstr1' ? 'Complete multi-sheet filing workbook' : 'Current report data'}</span>
              </button>
              <button type="button" role="menuitem" className="w-full rounded-md px-3 py-2 text-start text-sm font-medium ui-hover-sunken disabled:cursor-not-allowed disabled:opacity-45" disabled={report !== 'gstr1' && report !== 'gstr3b'} title={report !== 'gstr1' && report !== 'gstr3b' ? 'Available for GSTR-1 and GSTR-3B' : 'GST Portal compatible JSON'} onClick={() => { setExportOpen(false); exportPortalJson(); }}>
                <span className="block">GST Portal JSON</span><span className="block text-xs font-normal ui-muted">GSTR-1 / GSTR-3B upload file</span>
              </button>
            </div> : null}
          </div>
        </div>
      </div>

      <section className="ui-card overflow-hidden">
        {report !== 'gstr1' ? <div className="flex flex-wrap items-center justify-between gap-2 border-b ui-border-c px-3 py-2">
          <div><h2 className="ui-t-sec">{selectedLabel}</h2><p className="text-xs ui-muted">Selected GST report for the current compliance period</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative"><Search size={15} className="ui-muted absolute start-3 top-1/2 -translate-y-1/2" /><input aria-label="Search GST report" className="ui-input w-64 ps-9" placeholder="Search number, party, reference…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          </div>
        </div> : null}
        <div className="p-2">
          {report === 'gstr1' ? <Gstr1Report key={gstr1ReportKey} db={scopedDb} currentCompany={currentCompany} search={search} onSearchChange={setSearch} onDetailChange={setGstr1DetailOpen} /> : report === 'gstr3b' ? <Gstr3bReport db={scopedDb} currentCompany={currentCompany} /> : report === 'reconciliation' ? <Gstr2bReco db={scopedDb} currentCompany={currentCompany} /> : (
            <div className="ui-table-shell overflow-auto" data-fill-viewport style={{ '--table-scroll-h': 'calc(100dvh - 13rem)' }}><table className="ui-table w-max min-w-full table-auto"><thead><tr>{reportColumns.map((column) => <th key={column.key} className={`ui-th whitespace-nowrap ${column.money ? 'ui-num' : ''}`}>{column.label}</th>)}</tr></thead><tbody>{visibleRows.length ? visibleRows.map((row, index) => <tr key={`${row.id || row.number}-${index}`} className="ui-hover-sunken cursor-pointer">{reportColumns.map((column) => { const value = column.value(row); return <td key={column.key} className={`ui-td whitespace-nowrap ${column.money ? 'ui-num ui-money' : column.key === 'gstin' ? 'ui-mono' : ''}`}>{column.money ? formatMoney(value, currentCompany) : value}</td>; })}</tr>) : <tr><td colSpan={reportColumns.length} className="px-4 py-12 text-center ui-muted">No entries match this report and period.</td></tr>}</tbody></table></div>
          )}
        </div>
      </section>
    </div>
  );
};

export const MsmeComplianceWorkspace = ({ db, setDb, currentCompany }) => {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [showRateHistory, setShowRateHistory] = useState(false);
  const [showAddRate, setShowAddRate] = useState(false);
  const [rateForm, setRateForm] = useState({ effectiveFrom: todayIso(), bankRate: '' });
  const companyId = currentCompany.id;
  const today = todayIso();

  const rateHistory = useMemo(() => (db.msmeBankRates || [])
    .filter((row) => Number(row.companyId) === Number(companyId))
    .slice()
    .sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom))), [db.msmeBankRates, companyId]);

  const currentBankRate = rateHistory.reduce(
    (rate, row) => String(row.effectiveFrom || '') <= today ? Number(row.bankRate) : rate,
    MSME_BANK_RATE
  );

  const addBankRate = () => {
    const effectiveFrom = String(rateForm.effectiveFrom || '').slice(0, 10);
    const bankRate = Number(rateForm.bankRate);
    if (!effectiveFrom) {
      notify.error('Applicable date is required.');
      return;
    }
    if (!Number.isFinite(bankRate) || bankRate < 0 || bankRate > 100) {
      notify.error('Enter a valid RBI Bank Rate.');
      return;
    }
    if (rateHistory.some((row) => String(row.effectiveFrom).slice(0, 10) === effectiveFrom)) {
      notify.error('A Bank Rate already exists for this applicable date. Earlier rate records are not overwritten.');
      return;
    }
    const entry = {
      id: `msme-rate-${companyId}-${effectiveFrom}`,
      companyId,
      effectiveFrom,
      bankRate,
      createdAt: new Date().toISOString(),
    };
    setDb((previous) => ({ ...previous, msmeBankRates: [...(previous.msmeBankRates || []), entry] }));
    setRateForm({ effectiveFrom: todayIso(), bankRate: '' });
    notify.success(`Bank Rate ${bankRate.toFixed(2)}% added from ${formatDateIn(effectiveFrom)}.`);
    setShowAddRate(false);
    setShowRateHistory(true);
  };

  const registeredVendors = useMemo(
    () => (db.vendors || []).filter((vendor) =>
      Number(vendor.companyId) === Number(companyId)
      && (vendor.msmeRegistered || String(vendor.msmeNumber || '').trim())
    ),
    [db.vendors, companyId]
  );

  const vendorById = useMemo(
    () => new Map(registeredVendors.map((vendor) => [String(vendor.id), vendor])),
    [registeredVendors]
  );

  const rows = useMemo(() => (db.bills || [])
    .filter((bill) => Number(bill.companyId) === Number(companyId))
    .filter((bill) => vendorById.has(String(bill.vendorId)))
    .filter((bill) => !/draft|cancel/i.test(String(bill.status || '')))
    .map((bill) => {
      const vendor = vendorById.get(String(bill.vendorId));
      const due = msmeDueDate(bill);
      const outstanding = payableOutstanding(bill, db.debitNotes || []).outstanding;
      const paymentDate = outstanding <= 0.005 ? allocatedPaymentDate(db.payments, bill) : '';
      const calculationDate = paymentDate || today;
      const overdueDays = daysAfter(due.date, calculationDate);
      const vendorObligation = Math.max(0, Number(bill.total || 0) - Number(bill.tdsAmount || 0));
      const interestBase = outstanding > 0.005 ? outstanding : Math.min(vendorObligation, Number(bill.paidAmount || vendorObligation));
      const interest = estimateMsmeInterestWithRates({
        principal: interestBase,
        dueDate: due.date,
        endDate: calculationDate,
        rates: rateHistory,
      });
      const status = outstanding > 0.005 ? (overdueDays > 0 ? 'OVERDUE' : 'DUE') : (overdueDays > 0 ? 'PAID_LATE' : 'PAID');
      return { bill, vendor, due, outstanding, paymentDate, overdueDays, interest, status };
    })
    .sort((a, b) => {
      if (a.status === 'OVERDUE' && b.status !== 'OVERDUE') return -1;
      if (b.status === 'OVERDUE' && a.status !== 'OVERDUE') return 1;
      return String(a.due.date).localeCompare(String(b.due.date));
    }), [db.bills, db.debitNotes, db.payments, companyId, vendorById, today, rateHistory]);

  const selectedVendorId = statusFilter.startsWith('VENDOR:') ? statusFilter.slice('VENDOR:'.length) : '';
  const selectedVendor = selectedVendorId ? vendorById.get(selectedVendorId) || null : null;
  const scopedRows = useMemo(
    () => selectedVendorId ? rows.filter((row) => String(row.vendor?.id) === selectedVendorId) : rows,
    [rows, selectedVendorId]
  );

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scopedRows.filter((row) => {
      if (!selectedVendorId && statusFilter === 'OPEN' && row.outstanding <= 0.005) return false;
      if (!selectedVendorId && statusFilter === 'OVERDUE' && row.status !== 'OVERDUE') return false;
      if (query && ![
        row.vendor?.displayName,
        row.vendor?.name,
        row.vendor?.msmeNumber,
        row.bill?.number,
        row.bill?.refNo,
      ].some((value) => String(value || '').toLowerCase().includes(query))) return false;
      return true;
    });
  }, [scopedRows, search, statusFilter, selectedVendorId]);

  const totals = useMemo(() => scopedRows.reduce((sum, row) => ({
    outstanding: sum.outstanding + row.outstanding,
    overdue: sum.overdue + (row.status === 'OVERDUE' ? row.outstanding : 0),
    interest: sum.interest + row.interest,
  }), { outstanding: 0, overdue: 0, interest: 0 }), [scopedRows]);

  const statusLabel = (status) => ({
    OVERDUE: 'Overdue', DUE: 'Within time', PAID_LATE: 'Paid late', PAID: 'Paid on time',
  }[status] || status);

  const exportRows = visibleRows.map((row) => ({ ...row, vendorName: row.vendor?.displayName || row.vendor?.name || '', udyam: row.vendor?.msmeNumber || '', invoiceNumber: row.bill?.refNo || row.bill?.number || '', billDate: row.bill?.date || '', dueDate: row.due?.date || '', statusLabel: statusLabel(row.status) }));
  const exportMsme = (key) => {
    const format = exportFormatFromKey(key);
    if (!format) return;
    runListExport({
      format,
      title: selectedVendor ? `MSME invoices - ${selectedVendor.displayName || selectedVendor.name}` : 'MSME Compliance',
      fileName: selectedVendor ? `MSME_${selectedVendor.displayName || selectedVendor.name}` : 'MSME_Compliance',
      label: 'invoice(s)',
      rows: exportRows,
      columns: [
        { key: 'vendorName', label: 'Vendor' }, { key: 'udyam', label: 'Udyam Number' },
        { key: 'invoiceNumber', label: 'Vendor Invoice' }, { key: 'billDate', label: 'Bill Date' },
        { key: 'dueDate', label: 'Statutory Due' }, { key: 'outstanding', label: 'Outstanding' },
        { key: 'overdueDays', label: 'Overdue Days' }, { key: 'interest', label: 'Estimated Interest' },
        { key: 'statusLabel', label: 'Status' },
      ],
    });
  };

  return (
    <div className="msme-compliance-page flex h-full min-h-0 flex-col gap-2">
      <PageHeader
        entity="vendors"
        title={selectedVendor ? `MSME · ${selectedVendor.displayName || selectedVendor.name}` : 'MSME Compliance'}
        description={`Payment monitoring under MSMED Act sections 15–16 · current Bank Rate ${currentBankRate.toFixed(2)}% · statutory rate ${(currentBankRate * 3).toFixed(2)}% p.a.`}
        actions={<>
          <select className="ui-select ui-ctl-compact w-56" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="MSME invoice and vendor filter">
            <option value="ALL">All invoices</option>
            <option value="OPEN">Open invoices</option>
            <option value="OVERDUE">Overdue only</option>
            <optgroup label="MSME registered vendors">
              {registeredVendors.map((vendor) => <option key={vendor.id} value={`VENDOR:${vendor.id}`}>{vendor.displayName || vendor.name}</option>)}
            </optgroup>
          </select>
          <div className="relative">
            <Search size={15} className="ui-muted absolute start-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input className="ui-input ui-ctl-compact w-64 ps-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vendor or invoice…" aria-label="Search MSME invoices" />
          </div>
          <MoreButton items={[exportMenuItem('Export MSME invoices')]} onSelect={exportMsme} />
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setShowRateHistory(true)}>Bank rates</button>
        </>}
      />

      {selectedVendor ? (
        <section className="ui-card grid grid-cols-2 gap-3 px-3 py-2 lg:grid-cols-5" aria-label="Selected MSME vendor details">
          <div><div className="ui-t-label">Vendor</div><div className="ui-t-body font-semibold">{selectedVendor.displayName || selectedVendor.name}</div></div>
          <div><div className="ui-t-label">Udyam number</div><div className="ui-t-body ui-mono">{selectedVendor.msmeNumber || 'Missing'}</div></div>
          <div><div className="ui-t-label">PAN</div><div className="ui-t-body ui-mono">{selectedVendor.pan || '—'}</div></div>
          <div><div className="ui-t-label">GSTIN</div><div className="ui-t-body ui-mono">{selectedVendor.gstin || '—'}</div></div>
          <div><div className="ui-t-label">Invoices</div><div className="ui-t-body font-semibold">{scopedRows.length}</div></div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="MSME compliance summary">
        <div className="ui-card px-3 py-2"><div className="ui-t-label">{selectedVendor ? 'Vendor invoices' : 'Invoices received'}</div><div className="ui-money-lg">{scopedRows.length}</div></div>
        <div className="ui-card px-3 py-2"><div className="ui-t-label">{selectedVendor ? 'Vendor outstanding' : 'Outstanding'}</div><div className="ui-money-lg">{formatMoney(totals.outstanding, currentCompany)}</div></div>
        <div className="ui-card px-3 py-2"><div className="ui-t-label">{selectedVendor ? 'Vendor overdue' : 'Overdue principal'}</div><div className="ui-money-lg ui-amount-neg">{formatMoney(totals.overdue, currentCompany)}</div></div>
        <div className="ui-card px-3 py-2"><div className="ui-t-label">{selectedVendor ? 'Vendor interest' : 'Estimated interest'}</div><div className="ui-money-lg ui-amount-neg">{formatMoney(totals.interest, currentCompany)}</div></div>
      </div>

      <div className="ui-card min-h-0 flex-1 overflow-hidden">
        <div className="ui-table-scroll h-full max-h-none overflow-x-hidden overflow-y-auto">
          <table className="ui-table ui-table-sticky w-full table-fixed">
            <colgroup><col style={{ width: '19%' }} /><col style={{ width: '13%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /><col style={{ width: '13%' }} /><col style={{ width: '9%' }} /><col style={{ width: '12%' }} /><col style={{ width: '10%' }} /></colgroup>
            <thead><tr><th>{selectedVendor ? 'MSME / Udyam' : 'Vendor'}</th><th>Vendor invoice</th><th>Bill date</th><th>Statutory due</th><th className="ui-num">Outstanding</th><th className="ui-num">Overdue days</th><th className="ui-num">Est. interest</th><th>Status</th></tr></thead>
            <tbody>
              {visibleRows.length ? visibleRows.map((row) => (
                <tr key={row.bill.id}>
                  <td className="ui-col-entity truncate" title={row.vendor.displayName || row.vendor.name}><div>{selectedVendor ? (row.vendor.msmeNumber || 'Udyam number missing') : (row.vendor.displayName || row.vendor.name)}</div><div className="ui-caption truncate">{selectedVendor ? (row.vendor.gstin || 'GSTIN missing') : (row.vendor.msmeNumber || 'Udyam number missing')}</div></td>
                  <td className="ui-col-doc truncate"><div>{row.bill.refNo || row.bill.number || '—'}</div>{row.bill.refNo ? <div className="ui-caption truncate">Book no. {row.bill.number}</div> : null}</td>
                  <td>{formatDateIn(row.bill.date)}</td>
                  <td title={row.due.basis}><div>{row.due.date ? formatDateIn(row.due.date) : '—'}</div><div className="ui-caption truncate">{row.due.basis}</div></td>
                  <td className="ui-col-amount">{formatMoney(row.outstanding, currentCompany)}</td>
                  <td className={`ui-col-amount ${row.overdueDays ? 'ui-amount-neg' : ''}`}>{row.overdueDays || '—'}</td>
                  <td className={`ui-col-amount ${row.interest ? 'ui-amount-neg' : ''}`}>{formatMoney(row.interest, currentCompany)}</td>
                  <td><span className={`ui-pill ${row.status === 'OVERDUE' || row.status === 'PAID_LATE' ? 'ui-pill-neg' : row.status === 'PAID' ? 'ui-pill-pos' : 'ui-pill-warn'}`}>{statusLabel(row.status)}</span></td>
                </tr>
              )) : (
                <tr><td colSpan="8"><EmptyState icon={Building2} title={registeredVendors.length ? 'No invoices match' : 'No MSME vendor invoices'} description={registeredVendors.length ? 'No purchase invoices match the selected status and search.' : 'Mark a vendor as MSME registered and record its purchase bill to monitor payment compliance.'} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="ui-caption px-1">Interest is an estimate using the recorded bill date as acceptance date. Each saved Bank Rate applies only from its applicable date; earlier periods retain their earlier rate.</p>

      <Drawer
        open={showRateHistory}
        onClose={() => setShowRateHistory(false)}
        title="MSME Bank Rate History"
        description="Effective-dated RBI Bank Rates used for delayed-payment interest"
        widthClass="w-[38rem] max-w-[calc(100vw-1rem)]"
        actions={<button type="button" className="ui-btn ui-btn-primary" onClick={() => { setShowRateHistory(false); setShowAddRate(true); }}><Plus size={15} /> Add</button>}
      >
        <div className="ui-card overflow-hidden">
          <table className="ui-table w-full">
            <thead><tr><th>Applicable from</th><th className="ui-num">Bank Rate</th><th className="ui-num">Statutory rate (3×)</th></tr></thead>
            <tbody>{rateHistory.length ? rateHistory.slice().reverse().map((row) => (
              <tr key={row.id || row.effectiveFrom}><td>{formatDateIn(row.effectiveFrom)}</td><td className="ui-col-amount">{Number(row.bankRate).toFixed(2)}%</td><td className="ui-col-amount">{(Number(row.bankRate) * 3).toFixed(2)}%</td></tr>
            )) : <tr><td colSpan="3" className="px-4 py-10 text-center ui-muted">No saved rate history. Add the first applicable rate.</td></tr>}</tbody>
          </table>
        </div>
      </Drawer>

      <Drawer
        open={showAddRate}
        onClose={() => setShowAddRate(false)}
        title="Add MSME Bank Rate"
        description="The rate will apply from the selected date without changing earlier periods"
        widthClass="w-[32rem] max-w-[calc(100vw-1rem)]"
        actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setShowAddRate(false)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={addBankRate}>Save</button></>}
      >
        <div className="space-y-4">
          <div><label className="ui-label" htmlFor="msme-rate-date">Applicable from</label><input id="msme-rate-date" type="date" className="ui-input w-full" value={rateForm.effectiveFrom} onChange={(event) => setRateForm((previous) => ({ ...previous, effectiveFrom: event.target.value }))} required /></div>
          <div><label className="ui-label" htmlFor="msme-bank-rate">RBI Bank Rate (%)</label><input id="msme-bank-rate" type="number" min="0" max="100" step="0.01" className="ui-input w-full" value={rateForm.bankRate} onChange={(event) => setRateForm((previous) => ({ ...previous, bankRate: event.target.value }))} placeholder="e.g. 5.50" required /></div>
          <div className="ui-card p-3"><div className="ui-t-label">Statutory interest rate</div><div className="ui-money-lg">{Number.isFinite(Number(rateForm.bankRate)) && rateForm.bankRate !== '' ? `${(Number(rateForm.bankRate) * 3).toFixed(2)}% p.a.` : '—'}</div><div className="ui-caption">Three times the entered RBI Bank Rate</div></div>
        </div>
      </Drawer>
    </div>
  );
};
