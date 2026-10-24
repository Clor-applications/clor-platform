import { useEffect, useMemo, useState } from 'react';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { GST_STATE_BY_CODE, getCompanyGstProfile, getGstStateFromGstin } from '@ui/utils/gst';
import { orgId as platformOrgId, selectWarehouse } from '@platform/context';
import { Download, MoreVertical, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import CompanyProfileForm from './CompanyProfileForm';
import CompanyProfileDetails from './CompanyProfileDetails';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { ACCENT_OPTIONS, TEMPLATE_OPTIONS, VOUCHER_DEFS, getDocSettings } from '@ui/utils/docSettings';
import Modal from '@ui/components/ui/Modal';
import { exportRows } from '@ui/components/ListToolbar';
import { resolveServerOrgId } from '../../appShared';
import { TemplatePreview } from './TemplatePreview';
export { TemplatePreview };


export const DocTemplateSettings = ({ db, setDb, currentCompany }) => {
  const [docSettings, setDocSettings] = useState(() => getDocSettings(db, currentCompany));
  const [templatePreview, setTemplatePreview] = useState(null);

  useEffect(() => {
    setDocSettings(getDocSettings(db, currentCompany));
  }, [db, currentCompany]);

  const updateTemplateSetting = (voucherKey, patch) => {
    setDocSettings((prev) => ({
      ...prev,
      templates: {
        ...prev.templates,
        [voucherKey]: {
          ...prev.templates[voucherKey],
          ...patch,
        },
      },
    }));
  };

  const handleSave = () => {
    setDb({
      ...db,
      companies: db.companies.map((c) =>
        c.id === currentCompany.id
          ? {
              ...c,
              docSettings,
            }
          : c
      ),
    });
    notify.success('Template settings saved.');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="ui-t-sec">Templates</h3>
        <button onClick={handleSave} className="px-4 py-2 ui-btn ui-btn-primary rounded-lg">
          Save
        </button>
      </div>

      <div className="ui-surface rounded-xl shadow-sm p-6 border space-y-4">
        <div>
          <h4 className="font-bold">Document Templates</h4>
          <p className="text-sm ui-muted">Choose a template and accent color for each voucher print layout.</p>
        </div>

        <div className="space-y-3">
          {VOUCHER_DEFS.map((v) => {
            const cfg = docSettings?.templates?.[v.key];
            const accent = ACCENT_OPTIONS.find((a) => a.id === cfg?.accentId) || ACCENT_OPTIONS[0];
            const templateName = TEMPLATE_OPTIONS.find((t) => t.id === cfg?.templateId)?.name || 'Classic';
            return (
              <div key={v.key} className="border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{v.label}</div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm ui-muted">{templateName}</div>
                    <button
                      type="button"
                      onClick={() =>
                        setTemplatePreview({
                          voucherLabel: v.label,
                          templateId: cfg?.templateId || 'classic',
                          accentBarClass: accent.barClass,
                        })
                      }
                      className="px-3 py-1.5 border rounded-lg text-sm ui-hover-sunken"
                    >
                      Preview
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="ui-label" htmlFor="app-template">Template</label>
                    <select id="app-template"
                      value={cfg?.templateId || 'classic'}
                      onChange={(e) => updateTemplateSetting(v.key, { templateId: e.target.value })}
                      className="ui-select w-full px-2 py-2"
                    >
                      {TEMPLATE_OPTIONS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="ui-label" htmlFor="app-accent-color">Accent Color</label>
                    <select id="app-accent-color"
                      value={cfg?.accentId || 'blue'}
                      onChange={(e) => updateTemplateSetting(v.key, { accentId: e.target.value })}
                      className="ui-select w-full px-2 py-2"
                    >
                      {ACCENT_OPTIONS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end">
                    <div className="w-full border rounded-lg overflow-hidden">
                      <div className={`h-2 ${accent.barClass}`} />
                      <div className="p-2 text-xs ui-muted">Preview header bar</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {templatePreview && (
        <Modal onClose={() => setTemplatePreview(null)} title={`${templatePreview.voucherLabel} Template`} maxWidthClass="max-w-3xl">
          <TemplatePreview
            companyName={currentCompany?.name || ''}
            voucherLabel={templatePreview.voucherLabel}
            templateId={templatePreview.templateId}
            accentBarClass={templatePreview.accentBarClass}
          />
        </Modal>
      )}
    </div>
  );
};

export const CompanyProfile = ({ db, setDb, currentCompany }) => {
  const companyGstEnabled = Boolean(currentCompany?.profile?.taxCompliances?.gstEnabled ?? currentCompany?.gstEnabled ?? currentCompany?.gstin);
  const stateOptions = [
    'Andaman & Nicobar Islands',
    'Andhra Pradesh',
    'Arunachal Pradesh',
    'Assam',
    'Bihar',
    'Chandigarh',
    'Chhattisgarh',
    'Dadra & Nagar Haveli',
    'Daman & Diu',
    'Delhi',
    'Goa',
    'Gujarat',
    'Haryana',
    'Himachal Pradesh',
    'Jammu & Kashmir',
    'Jharkhand',
    'Karnataka',
    'Kerala',
    'Ladakh',
    'Lakshadweep',
    'Madhya Pradesh',
    'Maharashtra',
    'Manipur',
    'Meghalaya',
    'Mizoram',
    'Nagaland',
    'Odisha',
    'Puducherry',
    'Punjab',
    'Rajasthan',
    'Sikkim',
    'Tamil Nadu',
    'Telangana',
    'Tripura',
    'Uttar Pradesh',
    'Uttarakhand',
    'West Bengal',
  ];

  const codeForStateName = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '';
    for (const [code, stateName] of Object.entries(GST_STATE_BY_CODE || {})) {
      if (String(stateName || '').trim().toLowerCase() === trimmed.toLowerCase()) return code;
    }
    return '';
  };

  const seedCompanyForm = () => {
    const profile = getCompanyGstProfile(currentCompany);
    return {
      name: currentCompany?.name || '',
      currency: 'INR',
      gstRegistration: companyGstEnabled && String(profile.gstRegistration || '').toLowerCase() === 'unregistered' ? 'Registered' : (profile.gstRegistration || 'Registered'),
      gstin: profile.gstin || '',
      state: profile.state || '',
    };
  };

  // Keyed to the company and reset during render on a switch — the effect
  // that re-seeded it also wiped in-progress edits whenever anything in db
  // changed, which was a bug, not a feature.
  const [companyForm, setCompanyForm] = useState(() => ({ key: currentCompany?.id, value: seedCompanyForm() }));
  if (companyForm.key !== currentCompany?.id) {
    setCompanyForm({ key: currentCompany?.id, value: seedCompanyForm() });
  }
  const formData = companyForm.value;
  const setFormData = (updater) =>
    setCompanyForm((p) => ({ ...p, value: typeof updater === 'function' ? updater(p.value) : updater }));

  const handleSave = () => {
    const gstinNormalized = String(formData.gstin || '').trim().toUpperCase();
    if (companyGstEnabled && !gstinNormalized) return notify.error('GSTIN is mandatory while GST is enabled.');
    const stateFromGstin = getGstStateFromGstin(gstinNormalized);
    const nextState = stateFromGstin || String(formData.state || '').trim();

    setDb({
      ...db,
      companies: db.companies.map((c) =>
        c.id === currentCompany.id
          ? {
              ...c,
              name: formData.name,
              currency: 'INR',
              gstRegistration: formData.gstRegistration,
              gstin: gstinNormalized,
              state: nextState,
              country: c.country || 'India',
            }
          : c
      ),
    });

    notify.success('Company profile saved.');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="ui-t-sec">Company Profile</h3>
        <button onClick={handleSave} className="px-4 py-2 ui-btn ui-btn-primary rounded-lg">
          Save
        </button>
      </div>

      <div className="ui-surface rounded-xl shadow-sm p-6 border">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="ui-label" htmlFor="app-company-name">Company Name</label>
            <input id="app-company-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              className="ui-input w-full"
            />
          </div>

          <div>
            <label className="ui-label" htmlFor="app-currency">Currency</label>
            <input id="app-currency"
              type="text"
              value={formData.currency}
              readOnly
              className="ui-input w-full ui-sunken"
            />
          </div>

          <div>
            <label className="ui-label" htmlFor="app-gst-registration">GST Registration</label>
            <select id="app-gst-registration"
              value={formData.gstRegistration}
              onChange={(e) => setFormData((p) => ({ ...p, gstRegistration: e.target.value }))}
              className="ui-select w-full"
            >
              <option value="Registered">Registered</option>
              {!companyGstEnabled ? <option value="Unregistered">Unregistered</option> : null}
              <option value="Composition">Composition</option>
              <option value="SEZ">SEZ</option>
            </select>
          </div>

          <div>
            <label className="ui-label" htmlFor="app-gstin">GSTIN</label>
            <input id="app-gstin"
              type="text"
              value={formData.gstin}
              onChange={(e) => {
                const nextGstin = e.target.value;
                const stateFromGstin = getGstStateFromGstin(nextGstin);
                setFormData((p) => ({
                  ...p,
                  gstin: nextGstin,
                  state: stateFromGstin ? stateFromGstin : p.state,
                }));
              }}
              className="ui-input w-full"
              placeholder="e.g. 29ABCDE1234F1Z5"
            />
          </div>

          <div>
            <label className="ui-label">State</label>
            <PopupSelect
              label={null}
      title="Select State"
              value={formData.state}
              onChange={(next) => setFormData((p) => ({ ...p, state: next }))}
              options={stateOptions.map((s) => ({ value: s, label: s, code: codeForStateName(s) }))}
              placeholder="Select State"
            />
          </div>

          <div className="flex items-end">
            <div className="w-full text-sm ui-muted ui-sunken border rounded-lg px-3 py-2">
              Effective GST: {String(formData.state || '').trim() ? `${formData.state}` : 'Set state'}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export const GstRegistrationsSettings = ({ db, setDb, currentCompany }) => {
  const profile = currentCompany?.profile && typeof currentCompany.profile === 'object' ? currentCompany.profile : {};
  const tax = profile?.taxCompliances && typeof profile.taxCompliances === 'object' ? profile.taxCompliances : {};
  const primarySeed = {
    id: 'primary',
    primary: true,
    status: 'Active',
    registrationType: String(currentCompany?.gstRegistration || '').toLowerCase() === 'unregistered' ? 'Regular' : (currentCompany?.gstRegistration || 'Regular'),
    gstin: currentCompany?.gstin || '',
    state: currentCompany?.state || '',
    assesseeOtherTerritory: false,
    periodicity: 'Monthly',
    username: '',
    filingMode: 'Not Applicable',
    eInvoiceApplicable: false,
  };
  const savedRows = Array.isArray(tax.gstRegistrations) && tax.gstRegistrations.length ? tax.gstRegistrations : [primarySeed];
  const [rows, setRows] = useState(savedRows);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [menuId, setMenuId] = useState('');

  // Another company brings its own registrations. Reset while rendering, not
  // in an effect, so the previous company's rows never paint.
  const [rowsCompanyId, setRowsCompanyId] = useState(currentCompany?.id);
  if (rowsCompanyId !== currentCompany?.id) {
    setRowsCompanyId(currentCompany?.id);
    setRows(savedRows);
  }

  const stateOptions = useMemo(() => Array.from(new Set(Object.values(GST_STATE_BY_CODE || {}))).filter(Boolean).sort().map((state) => ({ value: state, label: state })), []);
  const visibleRows = rows.filter((row) => [row.gstin, row.state, row.registrationType, row.periodicity, row.status].some((value) => String(value || '').toLowerCase().includes(query.trim().toLowerCase())));

  const openRecord = (row, edit = false) => {
    setSelectedId(String(row.id));
    setDraft({ ...row });
    setEditing(edit);
    setMenuId('');
  };
  const closeDrawer = () => { setSelectedId(''); setDraft(null); setEditing(false); };
  const addRegistration = () => {
    const row = { ...primarySeed, id: `gst-${Date.now()}`, primary: false, gstin: '', state: '', registrationType: 'Regular' };
    setSelectedId(row.id); setDraft(row); setEditing(true);
  };
  const persist = (nextRows) => {
    const primary = nextRows.find((row) => row.primary) || nextRows[0];
    setRows(nextRows);
    setDb({
      ...db,
      companies: (db.companies || []).map((company) => company.id === currentCompany.id ? {
        ...company,
        gstEnabled: true,
        gstRegistration: primary?.registrationType || company.gstRegistration,
        gstin: primary?.gstin || company.gstin,
        state: primary?.state || company.state,
        profile: { ...(company.profile || {}), taxCompliances: { ...((company.profile || {}).taxCompliances || {}), gstEnabled: true, gstRegistrations: nextRows } },
      } : company),
    });
  };
  const saveDraft = () => {
    const gstin = String(draft?.gstin || '').trim().toUpperCase();
    const state = getGstStateFromGstin(gstin) || String(draft?.state || '').trim();
    if (!gstin) return notify.error('GSTIN is mandatory to enable GST.');
    if (!/^\d{2}[A-Z0-9]{13}$/.test(gstin) || !getGstStateFromGstin(gstin)) return notify.error('Enter a valid 15-character GSTIN.');
    if (!state) return notify.error('State is required.');
    const saved = { ...draft, gstin, state };
    const exists = rows.some((row) => String(row.id) === String(saved.id));
    persist(exists ? rows.map((row) => String(row.id) === String(saved.id) ? saved : row) : [...rows, saved]);
    notify.success('GST registration saved.');
    setEditing(false); setDraft(saved);
  };
  const removeRegistration = async (row) => {
    setMenuId('');
    if (row.primary) return notify.error('The primary GST registration cannot be deleted.');
    if (!await confirmDialog({ title: 'Delete GST registration?', message: `Delete ${row.gstin || 'this registration'}?`, confirmLabel: 'Delete' })) return;
    persist(rows.filter((item) => String(item.id) !== String(row.id)));
    if (String(selectedId) === String(row.id)) closeDrawer();
  };

  return (
    <div className="settings-branches gst-registration-settings space-y-3">
      <div className="branch-list-toolbar flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[rgb(var(--heading-bg))] px-3 py-2">
        <div><div className="ui-t-sec">GST Registrations</div><div className="ui-caption">{visibleRows.length} {visibleRows.length === 1 ? 'registration' : 'registrations'}</div></div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative w-full max-w-xs"><Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 ui-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="ui-input w-full bg-[rgb(var(--surface))] ps-8" placeholder="Search GST registrations" /></div>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => exportRows({ fileName: 'GST Registrations', label: 'registration(s)', columns: [{ key: 'gstin', label: 'GSTIN' }, { key: 'state', label: 'State' }, { key: 'registrationType', label: 'Registration Type' }, { key: 'periodicity', label: 'Periodicity' }, { key: 'status', label: 'Status' }], rows: visibleRows })}><Download size={14} /> Export</button>
          <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={addRegistration}><Plus size={14} /> Add Other GST</button>
        </div>
      </div>

      <div className="branch-table-wrap ui-surface border rounded-lg overflow-hidden">
        <table className="branch-table ui-table w-full table-fixed ui-settled">
          <colgroup><col style={{ width: '24%' }} /><col style={{ width: '19%' }} /><col style={{ width: '20%' }} /><col style={{ width: '17%' }} /><col style={{ width: '14%' }} /><col style={{ width: '6%' }} /></colgroup>
          <thead><tr><th className="ui-th">GSTIN</th><th className="ui-th">State</th><th className="ui-th">Registration Type</th><th className="ui-th">Periodicity</th><th className="ui-th ui-col-h-center">Status</th><th className="ui-th ui-num">Actions</th></tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row.id}>
            <td className="ui-td ui-mono"><button type="button" className="hover:underline" onClick={() => openRecord(row)}>{row.gstin || 'Add details'}</button></td>
            <td className="ui-td">{row.state || ''}</td><td className="ui-td">{row.registrationType || ''}</td><td className="ui-td">{row.periodicity || ''}</td>
            <td className="ui-td"><span className={row.status === 'Inactive' ? 'ui-pill ui-pill-neutral' : 'ui-pill ui-pill-pos'}>{row.status || 'Active'}</span></td>
            <td className="ui-td text-right relative"><button type="button" className="ui-icon-btn" aria-label={`Actions for ${row.gstin || row.state || 'GST registration'}`} onClick={() => setMenuId((current) => current === row.id ? '' : row.id)}><MoreVertical size={15} /></button>{menuId === row.id ? <div className="absolute end-9 top-1 z-30 w-44 rounded border bg-[rgb(var(--surface))] p-1 shadow-lg"><button type="button" className="report-menu-item flex items-center gap-2" onClick={() => openRecord(row, true)}><Pencil size={14} /> Edit</button><button type="button" className="report-menu-item flex items-center gap-2 text-[rgb(var(--neg))]" onClick={() => removeRegistration(row)}><Trash2 size={14} /> Delete</button></div> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>

      {selectedId ? <button type="button" className="settings-drawer-backdrop" aria-label="Close GST details" onClick={closeDrawer} /> : null}
      {selectedId && draft ? <aside className="settings-side-drawer branch-detail-card space-y-3">
        <div className="settings-drawer-heading flex items-center justify-between"><div><div className="ui-t-sec">{editing ? (draft.primary ? 'GST Details' : 'Other GST Details') : 'GST Details'}</div><div className="ui-caption">Registration and filing information</div></div><div className="flex gap-2">{!editing ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button> : null}<button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={closeDrawer}>Close</button></div></div>
        {editing ? <div className="branch-editor-form space-y-3">
          <section className="branch-editor-section grid grid-cols-2 gap-3"><div className="branch-editor-section-title col-span-2">GST Registration Details</div>
            <div><label className="ui-label">Registration Status</label><select className="ui-select w-full" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option>Active</option><option>Inactive</option></select></div>
            <div><label className="ui-label">Registration Type</label><select className="ui-select w-full" value={draft.registrationType} onChange={(event) => setDraft({ ...draft, registrationType: event.target.value })}><option>Regular</option><option>Composition</option><option>SEZ</option></select></div>
            <div><label className="ui-label">GSTIN/UIN</label><input className="ui-input ui-mono w-full" value={draft.gstin} maxLength={15} onChange={(event) => { const gstin = event.target.value.toUpperCase(); setDraft({ ...draft, gstin, state: getGstStateFromGstin(gstin) || draft.state }); }} /></div>
            <div><PopupSelect label="State" value={draft.state} onChange={(state) => setDraft({ ...draft, state })} options={stateOptions} placeholder="Select state" /></div>
            <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={Boolean(draft.assesseeOtherTerritory)} onChange={(event) => setDraft({ ...draft, assesseeOtherTerritory: event.target.checked })} /> Assessee of Other Territory</label>
          </section>
          <section className="branch-editor-section grid grid-cols-2 gap-3"><div className="branch-editor-section-title col-span-2">Filing Details</div>
            <div><label className="ui-label">Periodicity of GSTR-1</label><select className="ui-select w-full" value={draft.periodicity} onChange={(event) => setDraft({ ...draft, periodicity: event.target.value })}><option>Monthly</option><option>Quarterly</option></select></div>
            <div><label className="ui-label">GST Username</label><input className="ui-input w-full" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></div>
            <div><label className="ui-label">Mode of Filing</label><select className="ui-select w-full" value={draft.filingMode} onChange={(event) => setDraft({ ...draft, filingMode: event.target.value })}><option>Not Applicable</option><option>Online</option><option>Offline</option></select></div>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" className="ui-checkbox" checked={Boolean(draft.eInvoiceApplicable)} onChange={(event) => setDraft({ ...draft, eInvoiceApplicable: event.target.checked })} /> e-Invoicing applicable</label>
          </section>
          <div className="flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={closeDrawer}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={saveDraft}>Save</button></div>
        </div> : <div className="grid grid-cols-2 gap-3">{[['Registration Status', draft.status], ['State', draft.state], ['Registration Type', draft.registrationType], ['GSTIN/UIN', draft.gstin], ['GSTR-1 Periodicity', draft.periodicity], ['GST Username', draft.username], ['Mode of Filing', draft.filingMode], ['e-Invoicing', draft.eInvoiceApplicable ? 'Yes' : 'No']].map(([label, value]) => <div key={label}><div className="ui-detail-label">{label}</div><div className="ui-detail-value">{value || ''}</div></div>)}</div>}
      </aside> : null}
    </div>
  );
};

export const SettingsView = ({ db, setDb, currentCompany, initialTab = 'company', showSidebar = true }) => {
  const [activeTab, setActiveTab] = useState(() => (String(initialTab || 'company') === 'tax' ? 'tax' : 'company'));
  /*
   * Company Profile sat permanently open as a form, while its two neighbours
   * under Organisation — Branches and Warehouses — show the record and put you
   * into a form only when you ask. Three screens describing the same kind of
   * thing behaved two different ways, and the one that mattered most was the
   * odd one out: a form that is always open is a screen you can change by
   * leaning on the keyboard.
   */
  const [editingCompany, setEditingCompany] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = String(initialTab || 'company');
    setActiveTab(next === 'tax' ? 'tax' : 'company');
  }, [initialTab]);

  const COMPANY_ENTITY_TYPES = ['Proprietorship', 'Partnership', 'Pvt Ltd', 'Ltd', 'LLP'];
  const INDUSTRY_OPTIONS = ['Retail', 'Manufacturing', 'Services'];
  const COUNTRY_OPTIONS = ['India'];
  const TZ_OPTIONS = ['Asia/Kolkata'];
  const CURRENCY_OPTIONS = ['INR'];

  const saved = (currentCompany && typeof currentCompany === 'object' ? currentCompany.profile : null) || {};
  const companySettings = (saved.companySettings && typeof saved.companySettings === 'object') ? saved.companySettings : {};

  const [form, setForm] = useState(() => ({
    companyName: companySettings.companyName || currentCompany?.name || '',
    legalName: companySettings.legalName || (currentCompany?.name || ''),
    tradeName: companySettings.tradeName || '',
    entityType: companySettings.entityType || 'Proprietorship',
    industries: Array.isArray(companySettings.industries) ? companySettings.industries : [],
    incorporationDate: companySettings.incorporationDate || '',
    financialYearStart: companySettings.financialYearStart || '',
    booksBeginDate: companySettings.booksBeginDate || '',
    baseCurrency: companySettings.baseCurrency || 'INR',
    country: companySettings.country || 'India',
    timeZone: companySettings.timeZone || 'Asia/Kolkata',

    officialEmail: companySettings.officialEmail || '',
    phone: companySettings.phone || '',
    website: companySettings.website || '',

    regAddress1: companySettings.regAddress1 || '',
    regAddress2: companySettings.regAddress2 || '',
    regCity: companySettings.regCity || '',
    regStateCode: companySettings.regStateCode || '',
    regPincode: companySettings.regPincode || '',
    regCountry: companySettings.regCountry || 'India',
    cin: companySettings.cin || '',
    pan: companySettings.pan || '',
    gstin: companySettings.gstin || currentCompany?.gstin || '',
    numberFormat: companySettings.numberFormat || '12,34,567.89',
    dateFormat: companySettings.dateFormat || 'DD-MM-YYYY',
    logo: companySettings.logo || currentCompany?.logo || '',
  }));

  useEffect(() => {
    const nextSaved = (currentCompany && typeof currentCompany === 'object' ? currentCompany.profile : null) || {};
    const nextCompanySettings = (nextSaved.companySettings && typeof nextSaved.companySettings === 'object') ? nextSaved.companySettings : {};
    setForm({
      companyName: nextCompanySettings.companyName || currentCompany?.name || '',
      legalName: nextCompanySettings.legalName || (currentCompany?.name || ''),
      tradeName: nextCompanySettings.tradeName || '',
      entityType: nextCompanySettings.entityType || 'Proprietorship',
      industries: Array.isArray(nextCompanySettings.industries) ? nextCompanySettings.industries : [],
      incorporationDate: nextCompanySettings.incorporationDate || '',
      financialYearStart: nextCompanySettings.financialYearStart || '',
      booksBeginDate: nextCompanySettings.booksBeginDate || '',
      baseCurrency: nextCompanySettings.baseCurrency || 'INR',
      country: nextCompanySettings.country || 'India',
      timeZone: nextCompanySettings.timeZone || 'Asia/Kolkata',
      officialEmail: nextCompanySettings.officialEmail || '',
      phone: nextCompanySettings.phone || '',
      website: nextCompanySettings.website || '',
      regAddress1: nextCompanySettings.regAddress1 || '',
      regAddress2: nextCompanySettings.regAddress2 || '',
      regCity: nextCompanySettings.regCity || '',
      regStateCode: nextCompanySettings.regStateCode || '',
      regPincode: nextCompanySettings.regPincode || '',
      regCountry: nextCompanySettings.regCountry || 'India',
      cin: nextCompanySettings.cin || '',
      pan: nextCompanySettings.pan || '',
      gstin: nextCompanySettings.gstin || currentCompany?.gstin || '',
      numberFormat: nextCompanySettings.numberFormat || '12,34,567.89',
      dateFormat: nextCompanySettings.dateFormat || 'DD-MM-YYYY',
      logo: nextCompanySettings.logo || currentCompany?.logo || '',
    });
  }, [currentCompany?.id]);

  const updateForm = async (patch) => setForm((p) => ({ ...p, ...patch }));

  const saveCompanySettings = async () => {
    const companyName = String(form.companyName || '').trim();
    const legalName = String(form.legalName || '').trim();
    const regAddress1 = String(form.regAddress1 || '').trim();
    const regCity = String(form.regCity || '').trim();
    const regStateCode = String(form.regStateCode || '').trim();
    const regPincode = String(form.regPincode || '').trim();
    const regCountry = String(form.regCountry || '').trim();

    if (!companyName) return notify.error('Company Name is required.');
    if (!legalName) return notify.error('Legal Name is required.');
    // Name the exact gap: "Registered Address is required" while the user is
    // looking at a filled address line reads as a broken form.
    const missing = [
      [!regAddress1, 'Address Line 1'],
      [!regCity, 'City'],
      [!regStateCode, 'State / UT'],
      [!regPincode, 'Pincode'],
      [!regCountry, 'Country'],
    ]
      .filter(([bad]) => bad)
      .map(([, label]) => label);
    if (missing.length) {
      return notify.error(`Registered address: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} still empty.`);
    }

    const stateName = (GST_STATE_BY_CODE && regStateCode && GST_STATE_BY_CODE[regStateCode]) ? GST_STATE_BY_CODE[regStateCode] : '';

    const payload = {
      companyName,
      legalName,
      tradeName: String(form.tradeName || '').trim(),
      entityType: String(form.entityType || '').trim(),
      industries: Array.isArray(form.industries) ? form.industries : [],
      incorporationDate: form.incorporationDate || '',
      financialYearStart: form.financialYearStart || '',
      booksBeginDate: form.booksBeginDate || '',
      baseCurrency: String(form.baseCurrency || 'INR').trim(),
      country: String(form.country || 'India').trim(),
      timeZone: String(form.timeZone || 'Asia/Kolkata').trim(),
      officialEmail: String(form.officialEmail || '').trim(),
      phone: String(form.phone || '').trim(),
      website: String(form.website || '').trim(),
      regAddress1,
      regAddress2: String(form.regAddress2 || '').trim(),
      regCity,
      regStateCode,
      regStateName: stateName,
      regPincode,
      regCountry,
      cin: String(form.cin || '').trim(),
      pan: String(form.pan || '').trim().toUpperCase(),
      gstin: String(form.gstin || '').trim().toUpperCase(),
      numberFormat: String(form.numberFormat || '12,34,567.89').trim(),
      dateFormat: String(form.dateFormat || 'DD-MM-YYYY').trim(),
      logo: String(form.logo || ''),
    };

    setSaving(true);
    try {
      // Save to local DB
      setDb((prev) => {
        const companies = Array.isArray(prev?.companies) ? prev.companies : [];
        const nextCompanies = companies.map((c) => {
          if (Number(c?.id) !== Number(currentCompany?.id)) return c;
          const prevProfile = c?.profile && typeof c.profile === 'object' ? c.profile : {};
          return {
            ...c,
            name: companyName,
            // Mirror the fields every GST document reads. The profile blob is
            // the source of record for this page, but invoice/bill/note
            // creation checks company.state and company.gstin at the root —
            // saving here without mirroring left documents blocked on
            // "Company state not set" forever.
            state: stateName || c.state || '',
            // Same reason, and the rest of the address is not optional either.
            // The invoice and expense-voucher print blocks read these four keys
            // and nothing else, and the e-invoice payload falls back to the
            // literal '-' for Addr1 and 0 for Pin when they are blank — so a
            // company that filled this page in and saved it successfully was
            // still printing a GST invoice with no supplier address on it and
            // submitting a placeholder pincode to the IRP.
            address: [regAddress1, payload.regAddress2].filter(Boolean).join(', '),
            city: regCity,
            pincode: regPincode,
            country: regCountry,
            gstin: payload.gstin,
            logo: payload.logo,
            profile: {
              ...prevProfile,
              companySettings: payload,
            },
          };
        });
        return { ...prev, companies: nextCompanies };
      });

      // Local-only for now — see the note on the tax & compliances save above.
      notify.success('Company settings saved.');
    } catch {
      notify.error('Failed to save company settings.');
    } finally {
      setSaving(false);
    }
  };

  const UsersRoles = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [branches, setBranches] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [activeWarehouseId, setActiveWarehouseId] = useState(() => String(selectedWarehouseId() || ''));
    const [permCatalog, setPermCatalog] = useState([]);

    const [selectedUserId, setSelectedUserId] = useState(null);
    const [selectedRoleId, setSelectedRoleId] = useState(null);
    const [selectedBranchId, setSelectedBranchId] = useState(null);
    const [selectedWarehouseId, setSelectedWarehouseId] = useState(null);

    const [permSearch, setPermSearch] = useState('');
    const [activeSection, setActiveSection] = useState('users'); // users | roles | branches | warehouses

    const [newUser, setNewUser] = useState(() => ({
      email: '',
      name: '',
      mobile: '',
      password: '',
      roleId: '',
    }));

    const [userEdit, setUserEdit] = useState(() => ({
      name: '',
      mobile: '',
      roleId: '',
      branchIds: [],
      warehouseIds: [],
    }));

    const [newRole, setNewRole] = useState(() => ({
      label: '',
      description: '',
      permissions: [],
    }));

    const [roleEdit, setRoleEdit] = useState(() => ({
      label: '',
      description: '',
      permissions: [],
    }));

    const [newBranch, setNewBranch] = useState(() => ({
      name: '',
      code: '',
      address: '',
    }));

    const [branchEdit, setBranchEdit] = useState(() => ({
      name: '',
      code: '',
      address: '',
      isActive: true,
    }));

    const [newWarehouse, setNewWarehouse] = useState(() => ({
      name: '',
      code: '',
      location: '',
      address: '',
      branchId: '',
    }));

    const [warehouseEdit, setWarehouseEdit] = useState(() => ({
      name: '',
      code: '',
      location: '',
      address: '',
      branchId: '',
      isActive: true,
    }));

    const backendCompanyId = resolveServerOrgId(currentCompany) || '';
    const token = localStorage.getItem('token');
    const orgId = String(platformOrgId() || '').trim();

    const authHeaders = useMemo(() => {
      return {
        Authorization: `Bearer ${token}`,
        'X-Company-Id': String(backendCompanyId),
        ...(orgId ? { 'x-org-id': orgId } : {}),
      };
    }, [token, backendCompanyId, orgId]);

    const loadAll = async () => {
      setLoading(true);
      setError('');
      try {
        const [uRes, rRes, bRes, wRes, pRes] = await Promise.all([
          fetch('/api/users/company', { headers: authHeaders }),
          fetch('/api/roles/company', { headers: authHeaders }),
          fetch('/api/branches/company', { headers: authHeaders }),
          fetch('/api/warehouses/company', { headers: authHeaders }),
          fetch('/api/roles/permissions', { headers: authHeaders }),
        ]);

        const readJson = async (res) => {
          const text = await res.text();
          return text ? JSON.parse(text) : null;
        };

        const [uData, rData, bData, wData, pData] = await Promise.all([
          readJson(uRes),
          readJson(rRes),
          readJson(bRes),
          readJson(wRes),
          readJson(pRes),
        ]);

        if (!uRes.ok) throw new Error((uData && uData.error) || `Users HTTP ${uRes.status}`);
        if (!rRes.ok) throw new Error((rData && rData.error) || `Roles HTTP ${rRes.status}`);
        if (!bRes.ok) throw new Error((bData && bData.error) || `Branches HTTP ${bRes.status}`);
        if (!wRes.ok) throw new Error((wData && wData.error) || `Warehouses HTTP ${wRes.status}`);
        if (!pRes.ok) throw new Error((pData && pData.error) || `Permissions HTTP ${pRes.status}`);

        setUsers(Array.isArray(uData?.users) ? uData.users : []);
        setRoles(Array.isArray(rData?.roles) ? rData.roles : []);
        setBranches(Array.isArray(bData?.branches) ? bData.branches : []);
        setWarehouses(Array.isArray(wData?.warehouses) ? wData.warehouses : []);
        setPermCatalog(Array.isArray(pData?.permissions) ? pData.permissions : []);
      } catch (e) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      if (!currentCompany?.id) return;
      loadAll();
    }, [currentCompany?.id]);

    const selectedUser = useMemo(() => {
      if (!selectedUserId) return null;
      return users.find((u) => String(u.userId) === String(selectedUserId)) || null;
    }, [users, selectedUserId]);

    const selectedRole = useMemo(() => {
      if (!selectedRoleId) return null;
      return roles.find((r) => String(r.id) === String(selectedRoleId)) || null;
    }, [roles, selectedRoleId]);

    useEffect(() => {
      if (!selectedUser) {
        setUserEdit({ name: '', mobile: '', roleId: '', branchIds: [], warehouseIds: [] });
        return;
      }

      setUserEdit({
        name: selectedUser?.name || '',
        mobile: selectedUser?.mobile || '',
        roleId: selectedUser?.roleId != null ? String(selectedUser.roleId) : '',
        branchIds: Array.isArray(selectedUser?.branchIds) ? selectedUser.branchIds : [],
        warehouseIds: Array.isArray(selectedUser?.warehouseIds) ? selectedUser.warehouseIds : [],
      });
    }, [selectedUserId]);

    useEffect(() => {
      if (!selectedRole) {
        setRoleEdit({ label: '', description: '', permissions: [] });
        return;
      }
      setRoleEdit({
        label: selectedRole?.label || '',
        description: selectedRole?.description || '',
        permissions: Array.isArray(selectedRole?.permissions) ? selectedRole.permissions : [],
      });
    }, [selectedRoleId]);

    const selectedBranch = useMemo(() => {
      if (!selectedBranchId) return null;
      return branches.find((b) => String(b.id) === String(selectedBranchId)) || null;
    }, [branches, selectedBranchId]);

    const selectedWarehouse = useMemo(() => {
      if (!selectedWarehouseId) return null;
      return warehouses.find((w) => String(w.id) === String(selectedWarehouseId)) || null;
    }, [warehouses, selectedWarehouseId]);

    const activeWarehouse = useMemo(() => {
      if (!activeWarehouseId) return null;
      return warehouses.find((w) => String(w.id) === String(activeWarehouseId)) || null;
    }, [warehouses, activeWarehouseId]);

    useEffect(() => {
      if (!selectedBranch) {
        setBranchEdit({ name: '', code: '', address: '', isActive: true });
        return;
      }
      setBranchEdit({
        name: selectedBranch?.name || '',
        code: selectedBranch?.code || '',
        address: selectedBranch?.address || '',
        isActive: selectedBranch?.isActive !== false,
      });
    }, [selectedBranchId]);

    useEffect(() => {
      if (!selectedWarehouse) {
        setWarehouseEdit({ name: '', code: '', location: '', address: '', branchId: '', isActive: true });
        return;
      }
      setWarehouseEdit({
        name: selectedWarehouse?.name || '',
        code: selectedWarehouse?.code || '',
        location: selectedWarehouse?.location || '',
        address: selectedWarehouse?.address || '',
        branchId: selectedWarehouse?.branchId ? String(selectedWarehouse.branchId) : '',
        isActive: selectedWarehouse?.isActive !== false,
      });
    }, [selectedWarehouseId]);

    const filteredPerms = useMemo(() => {
      const q = String(permSearch || '').trim().toLowerCase();
      const list = Array.isArray(permCatalog) ? permCatalog : [];
      if (!q) return list;
      return list.filter((p) => {
        const k = String(p?.key || '').toLowerCase();
        const l = String(p?.label || '').toLowerCase();
        return k.includes(q) || l.includes(q);
      });
    }, [permCatalog, permSearch]);

    const createUser = async () => {
      setError('');
      const email = String(newUser.email || '').trim();
      const password = String(newUser.password || '');
      if (!email) return notify.error('Email is required.');
      if (password && password.length < 8) return notify.error('Password must be at least 8 characters.');

      try {
        const res = await fetch('/api/users/company-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            email,
            name: String(newUser.name || '').trim(),
            mobile: String(newUser.mobile || '').trim(),
            password: password ? password : undefined,
            roleId: newUser.roleId ? Number(newUser.roleId) : undefined,
          }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setNewUser({ email: '', name: '', mobile: '', password: '', roleId: '' });
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveUserBasics = async () => {
      if (!selectedUser) return;
      setError('');
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(selectedUser.userId))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ name: userEdit.name, mobile: userEdit.mobile }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveUserRole = async () => {
      if (!selectedUser) return;
      if (!userEdit.roleId) return notify.error('Select a role.');
      setError('');
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(selectedUser.userId))}/role`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ roleId: Number(userEdit.roleId) }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveUserBranches = async () => {
      if (!selectedUser) return;
      setError('');
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(selectedUser.userId))}/branches`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ branchIds: userEdit.branchIds }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveUserWarehouses = async () => {
      if (!selectedUser) return;
      setError('');
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(selectedUser.userId))}/warehouses`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ warehouseIds: userEdit.warehouseIds }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const removeUser = async () => {
      if (!selectedUser) return;
      const ok = await confirmDialog({ title: 'Please confirm', message: `Remove ${selectedUser.email || 'this user'} from this company?`, confirmLabel: 'Yes, continue' });
      if (!ok) return;
      setError('');
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(selectedUser.userId))}/company`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setSelectedUserId(null);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const createRole = async () => {
      setError('');
      const label = String(newRole.label || '').trim();
      if (!label) return notify.error('Role name is required.');

      try {
        const res = await fetch('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ label, description: newRole.description || '', permissions: newRole.permissions }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setNewRole({ label: '', description: '', permissions: [] });
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveRole = async () => {
      if (!selectedRole) return;
      if (selectedRole.isSystem) return;
      setError('');
      const label = String(roleEdit.label || '').trim();
      if (!label) return notify.error('Role name is required.');
      try {
        const res = await fetch(`/api/roles/${encodeURIComponent(String(selectedRole.id))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ label, description: roleEdit.description || '', permissions: roleEdit.permissions }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const deleteRole = async () => {
      if (!selectedRole) return;
      if (selectedRole.isSystem) return;
      const ok = await confirmDialog({ title: 'Please confirm', message: `Delete role "${selectedRole.label}"?`, confirmLabel: 'Yes, continue' });
      if (!ok) return;
      setError('');
      try {
        const res = await fetch(`/api/roles/${encodeURIComponent(String(selectedRole.id))}`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setSelectedRoleId(null);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    /* ---- Branch CRUD ---- */
    const createBranch = async () => {
      setError('');
      const name = String(newBranch.name || '').trim();
      if (!name) return notify.error('Branch name is required.');
      try {
        const res = await fetch('/api/branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            name,
            code: newBranch.code || '',
            address: newBranch.address || '',
          }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setNewBranch({ name: '', code: '', address: '' });
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveBranch = async () => {
      if (!selectedBranch) return;
      setError('');
      const name = String(branchEdit.name || '').trim();
      if (!name) return notify.error('Branch name is required.');
      try {
        const res = await fetch(`/api/branches/${encodeURIComponent(String(selectedBranch.id))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            name,
            code: branchEdit.code || '',
            address: branchEdit.address || '',
            isActive: branchEdit.isActive,
          }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const deleteBranch = async () => {
      if (!selectedBranch) return;
      const ok = await confirmDialog({ title: 'Please confirm', message: `Delete branch "${selectedBranch.name}"?`, confirmLabel: 'Yes, continue' });
      if (!ok) return;
      setError('');
      try {
        const res = await fetch(`/api/branches/${encodeURIComponent(String(selectedBranch.id))}`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setSelectedBranchId(null);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    /* ---- Warehouse CRUD ---- */
    const createWarehouse = async () => {
      setError('');
      const name = String(newWarehouse.name || '').trim();
      if (!name) return notify.error('Warehouse name is required.');
      try {
        const res = await fetch('/api/warehouses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            name,
            code: newWarehouse.code || '',
            location: newWarehouse.location || '',
            address: newWarehouse.address || '',
            branchId: newWarehouse.branchId ? Number(newWarehouse.branchId) : null,
          }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setNewWarehouse({ name: '', code: '', location: '', address: '', branchId: '' });
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveWarehouse = async () => {
      if (!selectedWarehouse) return;
      setError('');
      const name = String(warehouseEdit.name || '').trim();
      if (!name) return notify.error('Warehouse name is required.');
      try {
        const res = await fetch(`/api/warehouses/${encodeURIComponent(String(selectedWarehouse.id))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            name,
            code: warehouseEdit.code || '',
            location: warehouseEdit.location || '',
            address: warehouseEdit.address || '',
            branchId: warehouseEdit.branchId ? Number(warehouseEdit.branchId) : null,
            isActive: warehouseEdit.isActive,
          }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const deleteWarehouse = async () => {
      if (!selectedWarehouse) return;
      const ok = await confirmDialog({ title: 'Please confirm', message: `Delete warehouse "${selectedWarehouse.name}"?`, confirmLabel: 'Yes, continue' });
      if (!ok) return;
      setError('');
      try {
        const res = await fetch(`/api/warehouses/${encodeURIComponent(String(selectedWarehouse.id))}`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setSelectedWarehouseId(null);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const setActiveWarehouse = (warehouseId) => {
      const id = warehouseId ? String(warehouseId) : '';
      if (!id) {
        selectWarehouse('');
        setActiveWarehouseId('');
        return;
      }
      selectWarehouse(id);
      setActiveWarehouseId(id);
    };

    const roleOptions = roles.map((r) => ({ value: String(r.id), label: r.label }));
    const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name + (b.code ? ` (${b.code})` : '') }));

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="ui-t-sec">Users, Roles, Branches & Warehouses</div>
            <div className="text-sm ui-muted">Manage users, roles, branches and warehouses</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border overflow-hidden">
              {['users', 'roles', 'branches', 'warehouses'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveSection(s)}
                  className={`px-3 py-2 text-sm capitalize ${activeSection === s ? 'ui-btn ui-btn-primary' : 'ui-surface ui-fg ui-hover-sunken'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={loadAll}
              className="ui-btn ui-btn-secondary"
            >
              Refresh
            </button>
          </div>
        </div>

        {error ? <div className="ui-surface border rounded-xl p-4 text-sm text-[rgb(var(--neg))]">{error}</div> : null}

        {error ? <div className="ui-surface border rounded-xl p-4 text-sm text-[rgb(var(--neg))]">{error}</div> : null}

        {activeSection === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Users column */}
          <div className="ui-surface border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b ui-sunken">
              <div className="font-bold">Users</div>
              <div className="text-xs ui-muted">Company users and their assignments</div>
            </div>

            <div className="p-5 space-y-4">
              <div className="border rounded-xl p-4">
                <div className="text-sm font-semibold">Add / Attach User</div>
                <div className="text-xs ui-muted">If the email already exists, it will be attached to this company.</div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="ui-label" htmlFor="app-email">Email</label>
                    <input id="app-email"
                      value={newUser.email}
                      onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="user@example.com"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-name">Name</label>
                    <input id="app-name"
                      value={newUser.name}
                      onChange={(e) => setNewUser((p) => ({ ...p, name: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-mobile">Mobile</label>
                    <input id="app-mobile"
                      value={newUser.mobile}
                      onChange={(e) => setNewUser((p) => ({ ...p, mobile: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-password-new-user">Password (new user)</label>
                    <input id="app-password-new-user"
                      type="password"
                      value={newUser.password}
                      onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="Min 8 chars"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="ui-label" htmlFor="app-role">Role</label>
                    <select id="app-role"
                      value={newUser.roleId}
                      onChange={(e) => setNewUser((p) => ({ ...p, roleId: e.target.value }))}
                      className="ui-select w-full ui-surface"
                    >
                      <option value="">Select role</option>
                      {roleOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={createUser}
                    className={`px-4 py-2 rounded-lg ${loading ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}
                  >
                    Add User
                  </button>
                </div>
              </div>

              <div className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b ui-sunken text-sm font-semibold">User List</div>
                <div className="max-h-64 overflow-auto">
                  <table className="ui-table w-full">
                    <thead className="ui-sunken border-b">
                      <tr>
                        <th className="ui-th">Name</th>
                        <th className="ui-th">Email</th>
                        <th className="ui-th">Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {loading ? (
                        <tr><td colSpan={3} className="px-4 py-6 text-sm ui-muted">Loading...</td></tr>
                      ) : users.length === 0 ? (
                        <tr><td colSpan={3} className="px-4 py-6 text-sm ui-muted">No users found.</td></tr>
                      ) : (
                        users.map((u) => {
                          const active = String(u.userId) === String(selectedUserId);
                          return (
                            <tr
                              key={String(u.userId)}
                              className={`cursor-pointer ${active ? 'ui-row-active' : 'ui-hover-sunken'}`}
                              onClick={() => setSelectedUserId(String(u.userId))}
                            >
                              <td className="ui-col-entity px-4 py-3 ui-fg">{u.name || '-'}</td>
                              <td className="ui-col-entity px-4 py-3 ui-fg">{u.email || '-'}</td>
                              <td className="ui-col-meta px-4 py-3 ui-fg">{u.roleLabel || u.roleKey || '-'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-sm font-semibold">Edit Selected User</div>
                {!selectedUser ? (
                  <div className="text-sm ui-muted mt-2">Select a user from the list to edit.</div>
                ) : (
                  <div className="space-y-3 mt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="ui-label" htmlFor="app-email-2">Email</label>
                        <input id="app-email-2" value={selectedUser.email || ''} disabled className="ui-input w-full ui-sunken" />
                      </div>
                      <div>
                        <label className="ui-label" htmlFor="app-role-2">Role</label>
                        <select id="app-role-2"
                          value={userEdit.roleId}
                          onChange={(e) => setUserEdit((p) => ({ ...p, roleId: e.target.value }))}
                          className="ui-select w-full ui-surface"
                        >
                          <option value="">Select role</option>
                          {roleOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <div className="mt-2 flex justify-end">
                          <button type="button" onClick={saveUserRole} className="px-3 py-2 rounded-lg ui-surface border ui-hover-sunken">
                            Save Role
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="ui-label" htmlFor="app-name-2">Name</label>
                        <input id="app-name-2"
                          value={userEdit.name}
                          onChange={(e) => setUserEdit((p) => ({ ...p, name: e.target.value }))}
                          className="ui-input w-full"
                        />
                      </div>
                      <div>
                        <label className="ui-label" htmlFor="app-mobile-2">Mobile</label>
                        <input id="app-mobile-2"
                          value={userEdit.mobile}
                          onChange={(e) => setUserEdit((p) => ({ ...p, mobile: e.target.value }))}
                          className="ui-input w-full"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={saveUserBasics} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">
                        Save User
                      </button>
                      <button type="button" onClick={removeUser} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">
                        Remove
                      </button>
                    </div>

                    <div className="border rounded-lg p-3">
                      <div className="text-sm font-semibold">Branches</div>
                      {branches.length === 0 ? (
                        <div className="text-sm ui-muted mt-2">No branches found.</div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                          {branches.map((b) => {
                            const checked = userEdit.branchIds.includes(b.id);
                            return (
                              <label key={b.id} className="flex items-center gap-2 text-sm ui-fg">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(userEdit.branchIds);
                                    if (e.target.checked) next.add(b.id);
                                    else next.delete(b.id);
                                    setUserEdit((p) => ({ ...p, branchIds: Array.from(next) }));
                                  }}
                                  className="ui-checkbox"
                                />
                                <span>{b.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <div className="mt-3 flex justify-end">
                        <button type="button" onClick={saveUserBranches} className="px-3 py-2 rounded-lg ui-surface border ui-hover-sunken">
                          Save Branches
                        </button>
                      </div>
                    </div>

                    <div className="border rounded-lg p-3">
                      <div className="text-sm font-semibold">Warehouses</div>
                      {warehouses.length === 0 ? (
                        <div className="text-sm ui-muted mt-2">No warehouses found.</div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                          {warehouses.map((w) => {
                            const checked = userEdit.warehouseIds.includes(w.id);
                            return (
                              <label key={w.id} className="flex items-center gap-2 text-sm ui-fg">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(userEdit.warehouseIds);
                                    if (e.target.checked) next.add(w.id);
                                    else next.delete(w.id);
                                    setUserEdit((p) => ({ ...p, warehouseIds: Array.from(next) }));
                                  }}
                                  className="ui-checkbox"
                                />
                                <span>{w.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <div className="mt-3 flex justify-end">
                        <button type="button" onClick={saveUserWarehouses} className="px-3 py-2 rounded-lg ui-surface border ui-hover-sunken">
                          Save Warehouses
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Roles column */}
          <div className="ui-surface border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b ui-sunken">
              <div className="font-bold">Roles</div>
              <div className="text-xs ui-muted">Create roles and assign permissions (matrix)</div>
            </div>

            <div className="p-5 space-y-4">
              <div className="border rounded-xl p-4">
                <div className="text-sm font-semibold">Create Role</div>
                <div className="grid grid-cols-1 gap-3 mt-3">
                  <div>
                    <label className="ui-label" htmlFor="app-role-name">Role Name</label>
                    <input id="app-role-name"
                      value={newRole.label}
                      onChange={(e) => setNewRole((p) => ({ ...p, label: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="e.g. Sales Executive"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-permissions">Permissions</label>
                    <input id="app-permissions"
                      value={permSearch}
                      onChange={(e) => setPermSearch(e.target.value)}
                      className="ui-input w-full"
                      placeholder="Search permissions"
                    />
                    <div className="mt-2 max-h-48 overflow-auto border rounded-lg p-2 ui-surface">
                      {filteredPerms.length === 0 ? (
                        <div className="text-sm ui-muted px-2 py-2">No permissions match.</div>
                      ) : (
                        <div className="space-y-1">
                          {filteredPerms.map((p) => {
                            const key = String(p?.key || '').trim();
                            if (!key) return null;
                            const checked = newRole.permissions.includes(key);
                            return (
                              <label key={key} className="flex items-start gap-2 text-sm ui-fg px-2 py-1 ui-hover-sunken rounded-lg">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = new Set(newRole.permissions);
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
                                    setNewRole((prev) => ({ ...prev, permissions: Array.from(next) }));
                                  }}
                                  className="ui-checkbox mt-0.5"
                                />
                                <div>
                                  <div>{p.label || key}</div>
                                  <div className="text-xs ui-muted">{key}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={createRole}
                    className={`px-4 py-2 rounded-lg ${loading ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}
                  >
                    Create Role
                  </button>
                </div>
              </div>

              <div className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b ui-sunken text-sm font-semibold">Role List</div>
                <div className="max-h-56 overflow-auto">
                  <table className="ui-table w-full">
                    <thead className="ui-sunken border-b">
                      <tr>
                        <th className="ui-th">Role</th>
                        <th className="ui-th">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {roles.length === 0 ? (
                        <tr><td colSpan={2} className="px-4 py-6 text-sm ui-muted">No roles found.</td></tr>
                      ) : (
                        roles.map((r) => {
                          const active = String(r.id) === String(selectedRoleId);
                          return (
                            <tr
                              key={String(r.id)}
                              className={`cursor-pointer ${active ? 'ui-row-active' : 'ui-hover-sunken'}`}
                              onClick={() => setSelectedRoleId(String(r.id))}
                            >
                              <td className="ui-col-meta px-4 py-3 ui-fg">{r.label}</td>
                              <td className="ui-col-meta px-4 py-3 ui-fg">{r.isSystem ? 'System' : 'Custom'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-sm font-semibold">Edit Selected Role</div>
                {!selectedRole ? (
                  <div className="text-sm ui-muted mt-2">Select a role from the list to edit.</div>
                ) : selectedRole.isSystem ? (
                  <div className="text-sm ui-muted mt-2">System roles cannot be edited here.</div>
                ) : (
                  <div className="space-y-3 mt-3">
                    <div>
                      <label className="ui-label" htmlFor="app-role-name-2">Role Name</label>
                      <input id="app-role-name-2"
                        value={roleEdit.label}
                        onChange={(e) => setRoleEdit((p) => ({ ...p, label: e.target.value }))}
                        className="ui-input w-full"
                      />
                    </div>

                    <div>
                      <label className="ui-label">Permissions</label>
                      <div className="mt-2 max-h-56 overflow-auto border rounded-lg p-2 ui-surface">
                        {filteredPerms.length === 0 ? (
                          <div className="text-sm ui-muted px-2 py-2">No permissions match.</div>
                        ) : (
                          <div className="space-y-1">
                            {filteredPerms.map((p) => {
                              const key = String(p?.key || '').trim();
                              if (!key) return null;
                              const checked = roleEdit.permissions.includes(key);
                              return (
                                <label key={key} className="flex items-start gap-2 text-sm ui-fg px-2 py-1 ui-hover-sunken rounded-lg">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const next = new Set(roleEdit.permissions);
                                      if (next.has(key)) next.delete(key);
                                      else next.add(key);
                                      setRoleEdit((prev) => ({ ...prev, permissions: Array.from(next) }));
                                    }}
                                    className="ui-checkbox mt-0.5"
                                  />
                                  <div>
                                    <div>{p.label || key}</div>
                                    <div className="text-xs ui-muted">{key}</div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={saveRole} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">
                        Save Role
                      </button>
                      <button type="button" onClick={deleteRole} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        )}

        {activeSection === 'roles' && (
        <div className="ui-surface border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b ui-sunken">
            <div className="font-bold">Roles</div>
            <div className="text-xs ui-muted">Create and manage roles with permissions</div>
          </div>
          <div className="p-5 space-y-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Create Role</div>
              <div className="grid grid-cols-1 gap-3 mt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="ui-label" htmlFor="app-role-name-3">Role Name</label>
                    <input id="app-role-name-3"
                      value={newRole.label}
                      onChange={(e) => setNewRole((p) => ({ ...p, label: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="e.g. Sales Executive"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-description">Description</label>
                    <input id="app-description"
                      value={newRole.description}
                      onChange={(e) => setNewRole((p) => ({ ...p, description: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="Optional description"
                    />
                  </div>
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-permissions-2">Permissions</label>
                  <input id="app-permissions-2"
                    value={permSearch}
                    onChange={(e) => setPermSearch(e.target.value)}
                    className="ui-input w-full"
                    placeholder="Search permissions"
                  />
                  <div className="mt-2 max-h-40 overflow-auto border rounded-lg p-2 ui-surface">
                    {filteredPerms.length === 0 ? (
                      <div className="text-sm ui-muted px-2 py-2">No permissions match.</div>
                    ) : (
                      <div className="space-y-1">
                        {filteredPerms.map((p) => {
                          const key = String(p?.key || '').trim();
                          if (!key) return null;
                          const checked = newRole.permissions.includes(key);
                          return (
                            <label key={key} className="flex items-start gap-2 text-sm ui-fg px-2 py-1 ui-hover-sunken rounded-lg">
                              <input type="checkbox" checked={checked} onChange={() => {
                                const next = new Set(newRole.permissions);
                                if (next.has(key)) next.delete(key); else next.add(key);
                                setNewRole((prev) => ({ ...prev, permissions: Array.from(next) }));
                              }} className="ui-checkbox mt-0.5" />
                              <div>
                                <div>{p.label || key}</div>
                                <div className="text-xs ui-muted">{key}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" disabled={loading} onClick={createRole} className={`px-4 py-2 rounded-lg ${loading ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}>
                  Create Role
                </button>
              </div>
            </div>
            <div className="border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b ui-sunken text-sm font-semibold">Role List</div>
              <div className="max-h-56 overflow-auto">
                <table className="ui-table w-full">
                  <thead className="ui-sunken border-b">
                    <tr>
                      <th className="ui-th">Role</th>
                      <th className="ui-th">Description</th>
                      <th className="ui-th">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {roles.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-6 text-sm ui-muted">No roles found.</td></tr>
                    ) : (
                      roles.map((r) => {
                        const active = String(r.id) === String(selectedRoleId);
                        return (
                          <tr key={String(r.id)} className={`cursor-pointer ${active ? 'ui-row-active' : 'ui-hover-sunken'}`} onClick={() => setSelectedRoleId(String(r.id))}>
                            <td className="ui-col-meta px-4 py-3 ui-fg">{r.label}</td>
                            <td className="ui-col-meta px-4 py-3 ui-muted">{r.description || '-'}</td>
                            <td className="ui-col-meta px-4 py-3 ui-fg">{r.isSystem ? 'System' : 'Custom'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {selectedRole && !selectedRole.isSystem && (
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Edit Role: {selectedRole.label}</div>
              <div className="space-y-3 mt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="ui-label" htmlFor="app-role-name-4">Role Name</label>
                    <input id="app-role-name-4" value={roleEdit.label} onChange={(e) => setRoleEdit((p) => ({ ...p, label: e.target.value }))} className="ui-input w-full" />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-description-2">Description</label>
                    <input id="app-description-2" value={roleEdit.description} onChange={(e) => setRoleEdit((p) => ({ ...p, description: e.target.value }))} className="ui-input w-full" />
                  </div>
                </div>
                <div>
                  <label className="ui-label">Permissions</label>
                  <div className="mt-2 max-h-48 overflow-auto border rounded-lg p-2 ui-surface">
                    {filteredPerms.map((p) => {
                      const key = String(p?.key || '').trim();
                      if (!key) return null;
                      const checked = roleEdit.permissions.includes(key);
                      return (
                        <label key={key} className="flex items-start gap-2 text-sm ui-fg px-2 py-1 ui-hover-sunken rounded-lg">
                          <input type="checkbox" checked={checked} onChange={() => {
                            const next = new Set(roleEdit.permissions);
                            if (next.has(key)) next.delete(key); else next.add(key);
                            setRoleEdit((prev) => ({ ...prev, permissions: Array.from(next) }));
                          }} className="ui-checkbox mt-0.5" />
                          <div>
                            <div>{p.label || key}</div>
                            <div className="text-xs ui-muted">{key}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={saveRole} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">Save Role</button>
                  <button type="button" onClick={deleteRole} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">Delete</button>
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
        )}

        {activeSection === 'branches' && (
        <div className="ui-surface border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b ui-sunken">
            <div className="font-bold">Branches</div>
            <div className="text-xs ui-muted">Create and manage company branches</div>
          </div>
          <div className="p-5 space-y-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Create Branch</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="ui-label" htmlFor="app-branch-name">Branch Name *</label>
                  <input id="app-branch-name" value={newBranch.name} onChange={(e) => setNewBranch((p) => ({ ...p, name: e.target.value }))} className="ui-input w-full" placeholder="Main Branch" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-code">Code</label>
                  <input id="app-code" value={newBranch.code} onChange={(e) => setNewBranch((p) => ({ ...p, code: e.target.value }))} className="ui-input w-full" placeholder="MAIN" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-address">Address</label>
                  <input id="app-address" value={newBranch.address} onChange={(e) => setNewBranch((p) => ({ ...p, address: e.target.value }))} className="ui-input w-full" placeholder="123 Street..." />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" disabled={loading} onClick={createBranch} className={`px-4 py-2 rounded-lg ${loading ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}>
                  Create Branch
                </button>
              </div>
            </div>
            <div className="border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b ui-sunken text-sm font-semibold">Branch List</div>
              <div className="max-h-64 overflow-auto">
                <table className="ui-table w-full">
                  <thead className="ui-sunken border-b">
                    <tr>
                      <th className="ui-th">Name</th>
                      <th className="ui-th">Code</th>
                      <th className="ui-th">Address</th>
                      <th className="ui-th ui-col-h-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {branches.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-6 text-sm ui-muted">No branches found.</td></tr>
                    ) : (
                      branches.map((b) => {
                        const active = String(b.id) === String(selectedBranchId);
                        return (
                          <tr key={String(b.id)} className={`cursor-pointer ${active ? 'ui-row-active' : 'ui-hover-sunken'}`} onClick={() => setSelectedBranchId(String(b.id))}>
                            <td className="ui-col-entity px-4 py-3 ui-fg">{b.name}</td>
                            <td className="ui-col-meta px-4 py-3 ui-fg">{b.code || '-'}</td>
                            <td className="ui-col-meta px-4 py-3 ui-muted">{b.address || '-'}</td>
                            <td className="ui-col-meta px-4 py-3">{b.isActive !== false ? <span className="text-[rgb(var(--pos))]">Active</span> : <span className="text-[rgb(var(--neg))]">Inactive</span>}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {selectedBranch && (
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Edit Branch: {selectedBranch.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="ui-label" htmlFor="app-branch-name-2">Branch Name *</label>
                  <input id="app-branch-name-2" value={branchEdit.name} onChange={(e) => setBranchEdit((p) => ({ ...p, name: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-code-2">Code</label>
                  <input id="app-code-2" value={branchEdit.code} onChange={(e) => setBranchEdit((p) => ({ ...p, code: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-address-2">Address</label>
                  <input id="app-address-2" value={branchEdit.address} onChange={(e) => setBranchEdit((p) => ({ ...p, address: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-status">Status</label>
                  <select id="app-status" value={branchEdit.isActive ? 'active' : 'inactive'} onChange={(e) => setBranchEdit((p) => ({ ...p, isActive: e.target.value === 'active' }))} className="ui-select w-full ui-surface">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={saveBranch} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">Save Branch</button>
                <button type="button" onClick={deleteBranch} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">Delete</button>
              </div>
            </div>
            )}
          </div>
        </div>
        )}

        {activeSection === 'warehouses' && (
        <div className="ui-surface border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b ui-sunken">
            <div className="font-bold">Warehouses</div>
            <div className="text-xs ui-muted">Create and manage warehouses (can be linked to branches)</div>
          </div>
          <div className="p-5 space-y-4">
            <div className="border rounded-xl p-4 ui-surface">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Active Warehouse (request header)</div>
                  <div className="text-xs ui-muted">
                    {activeWarehouse ? `${activeWarehouse.name} (ID ${activeWarehouse.id})` : 'Not set; requests will omit x-warehouse-id.'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedWarehouse) {
                        notify.error('Select a warehouse from the list first.');
                        return;
                      }
                      setActiveWarehouse(selectedWarehouse.id);
                    }}
                    className="px-3 py-2 rounded-lg ui-btn ui-btn-primary"
                  >
                    Use selected
                  </button>
                  {activeWarehouseId ? (
                    <button
                      type="button"
                      onClick={() => setActiveWarehouse('')}
                      className="px-3 py-2 rounded-lg border ui-surface ui-hover-sunken"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Create Warehouse</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="ui-label" htmlFor="app-warehouse-name">Warehouse Name *</label>
                  <input id="app-warehouse-name" value={newWarehouse.name} onChange={(e) => setNewWarehouse((p) => ({ ...p, name: e.target.value }))} className="ui-input w-full" placeholder="Main Warehouse" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-code-3">Code</label>
                  <input id="app-code-3" value={newWarehouse.code} onChange={(e) => setNewWarehouse((p) => ({ ...p, code: e.target.value }))} className="ui-input w-full" placeholder="WH-001" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-location">Location</label>
                  <input id="app-location" value={newWarehouse.location} onChange={(e) => setNewWarehouse((p) => ({ ...p, location: e.target.value }))} className="ui-input w-full" placeholder="City, Zone..." />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-address-3">Address</label>
                  <input id="app-address-3" value={newWarehouse.address} onChange={(e) => setNewWarehouse((p) => ({ ...p, address: e.target.value }))} className="ui-input w-full" placeholder="123 Street..." />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-branch-optional">Branch (optional)</label>
                  <select id="app-branch-optional" value={newWarehouse.branchId} onChange={(e) => setNewWarehouse((p) => ({ ...p, branchId: e.target.value }))} className="ui-select w-full ui-surface">
                    <option value="">No branch</option>
                    {branchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" disabled={loading} onClick={createWarehouse} className={`px-4 py-2 rounded-lg ${loading ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}>
                  Create Warehouse
                </button>
              </div>
            </div>
            <div className="border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b ui-sunken text-sm font-semibold">Warehouse List</div>
              <div className="max-h-64 overflow-auto">
                <table className="ui-table w-full">
                  <thead className="ui-sunken border-b">
                    <tr>
                      <th className="ui-th">Name</th>
                      <th className="ui-th">Code</th>
                      <th className="ui-th">Location</th>
                      <th className="ui-th">Branch</th>
                      <th className="ui-th ui-col-h-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {warehouses.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-sm ui-muted">No warehouses found.</td></tr>
                    ) : (
                      warehouses.map((w) => {
                        const active = String(w.id) === String(selectedWarehouseId);
                        return (
                          <tr key={String(w.id)} className={`cursor-pointer ${active ? 'ui-row-active' : 'ui-hover-sunken'}`} onClick={() => setSelectedWarehouseId(String(w.id))}>
                            <td className="ui-col-entity px-4 py-3 ui-fg">{w.name}</td>
                            <td className="ui-col-meta px-4 py-3 ui-fg">{w.code || '-'}</td>
                            <td className="ui-col-meta px-4 py-3 ui-muted">{w.location || '-'}</td>
                            <td className="ui-col-meta px-4 py-3 ui-muted">{w.branchName || '-'}</td>
                            <td className="ui-col-meta px-4 py-3">{w.isActive !== false ? <span className="text-[rgb(var(--pos))]">Active</span> : <span className="text-[rgb(var(--neg))]">Inactive</span>}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {selectedWarehouse && (
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Edit Warehouse: {selectedWarehouse.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="ui-label" htmlFor="app-warehouse-name-2">Warehouse Name *</label>
                  <input id="app-warehouse-name-2" value={warehouseEdit.name} onChange={(e) => setWarehouseEdit((p) => ({ ...p, name: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-code-4">Code</label>
                  <input id="app-code-4" value={warehouseEdit.code} onChange={(e) => setWarehouseEdit((p) => ({ ...p, code: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-location-2">Location</label>
                  <input id="app-location-2" value={warehouseEdit.location} onChange={(e) => setWarehouseEdit((p) => ({ ...p, location: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-address-4">Address</label>
                  <input id="app-address-4" value={warehouseEdit.address} onChange={(e) => setWarehouseEdit((p) => ({ ...p, address: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-branch">Branch</label>
                  <select id="app-branch" value={warehouseEdit.branchId} onChange={(e) => setWarehouseEdit((p) => ({ ...p, branchId: e.target.value }))} className="ui-select w-full ui-surface">
                    <option value="">No branch</option>
                    {branchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-status-2">Status</label>
                  <select id="app-status-2" value={warehouseEdit.isActive ? 'active' : 'inactive'} onChange={(e) => setWarehouseEdit((p) => ({ ...p, isActive: e.target.value === 'active' }))} className="ui-select w-full ui-surface">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={saveWarehouse} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">Save Warehouse</button>
                <button type="button" onClick={deleteWarehouse} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">Delete</button>
              </div>
            </div>
            )}
          </div>
        </div>
        )}
      </div>
    );
  };

  return (
    /*
     * The wrapper is chrome for the sidebar. Without one it is a card holding
     * cards, which is the framing noise DESIGN.md rules out.
     */
    <div className={showSidebar ? 'ui-surface border rounded-xl overflow-hidden' : ''}>
      <div className="flex">
        {showSidebar ? (
          <div className="w-64 border-r ui-surface p-4">
            <div className="space-y-1">
              {[{ key: 'company', title: 'Company' }, { key: 'tax', title: 'Tax & Compliances' }].map((s) => {
                const isActive = s.key === activeTab;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setActiveTab(s.key)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${ isActive ? 'ui-row-active ui-border-c ui-fg' : 'ui-surface border-transparent ui-fg ui-hover-sunken'
                    }`}
                  >
                    <div className="text-sm font-medium">{s.title}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className={showSidebar ? 'flex-1 p-6' : 'min-w-0 flex-1'}>
          {activeTab === 'company' ? (
            <div className="company-profile-view relative">
              <div className="company-profile-actions flex flex-wrap items-center justify-end gap-2">
                {editingCompany ? (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setEditingCompany(false)} className="ui-btn ui-btn-ghost">
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        await saveCompanySettings();
                        // Saving returns to the record, the same as a branch.
                        setEditingCompany(false);
                      }}
                      className="ui-btn ui-btn-primary"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setEditingCompany(true)} className="ui-btn ui-btn-secondary">
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </button>
                )}
              </div>

              {editingCompany ? (
                <CompanyProfileForm
                  form={form}
                  updateForm={updateForm}
                  countryOptions={COUNTRY_OPTIONS}
                  currencyOptions={CURRENCY_OPTIONS}
                  states={Object.entries(GST_STATE_BY_CODE || {}).sort(([a], [b]) => a.localeCompare(b))}
                />
              ) : (
                <CompanyProfileDetails form={form} company={currentCompany} />
              )}
            </div>
          ) : (
            <GstRegistrationsSettings db={db} setDb={setDb} currentCompany={currentCompany} />
          )}
        </div>
      </div>
    </div>
  );
};
