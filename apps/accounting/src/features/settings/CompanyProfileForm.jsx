import { useRef, useState } from 'react';
import { Building2, Image, MapPin, ShieldCheck, Trash2, Upload } from 'lucide-react';

const Field = ({ label, required = false, children }) => (
  <label className="block min-w-0">
    <span className="ui-label mb-1 block">{label}{required ? <span className="text-[rgb(var(--neg))]"> *</span> : null}</span>
    {children}
  </label>
);

const Section = ({ icon: Icon, title, description, children }) => (
  <section className="company-profile-section">
    <div className="company-profile-section-head">
      <span className="company-profile-section-icon"><Icon size={16} aria-hidden="true" /></span>
      <div><h3>{title}</h3><p>{description}</p></div>
    </div>
    <div className="company-profile-grid">{children}</div>
  </section>
);

export default function CompanyProfileForm({ form, updateForm, countryOptions, currencyOptions, states }) {
  const logoInputRef = useRef(null);
  const [logoError, setLogoError] = useState('');
  const chooseLogo = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setLogoError('Use a PNG, JPG or WebP image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('Logo must be smaller than 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoError('');
      updateForm({ logo: String(reader.result || '') });
    };
    reader.onerror = () => setLogoError('Could not read this image.');
    reader.readAsDataURL(file);
  };

  return (
    <div className="company-profile-form max-w-5xl">
      <Section icon={Building2} title="Basic Details" description="Enter your business name and accounting preferences.">
        <div className="company-logo-field">
          <span className="ui-label block">Company Logo</span>
          <div className="company-logo-control">
            <span className="company-logo-preview">
              {form.logo ? <img src={form.logo} alt="Company logo preview" /> : <Image size={20} aria-hidden="true" />}
            </span>
            <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={chooseLogo} aria-label="Upload company logo" />
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => logoInputRef.current?.click()}>
              <Upload size={14} aria-hidden="true" /> {form.logo ? 'Replace' : 'Upload logo'}
            </button>
            {form.logo ? (
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { setLogoError(''); updateForm({ logo: '' }); }}>
                <Trash2 size={14} aria-hidden="true" /> Remove
              </button>
            ) : null}
            <span className={logoError ? 'ui-caption text-[rgb(var(--neg))]' : 'ui-caption ui-muted'}>{logoError || 'PNG, JPG or WebP · maximum 2 MB'}</span>
          </div>
        </div>
        <Field label="Company Name" required><input aria-label="Company Name" value={form.companyName} onChange={(e) => updateForm({ companyName: e.target.value })} className="ui-input w-full" /></Field>
        <Field label="Legal Name" required><input aria-label="Legal Name" value={form.legalName} onChange={(e) => updateForm({ legalName: e.target.value })} className="ui-input w-full" /></Field>
        <Field label="Date of Incorporation"><input aria-label="Date of Incorporation" type="date" value={form.incorporationDate} onChange={(e) => updateForm({ incorporationDate: e.target.value })} className="ui-input w-full" /></Field>
        <Field label="Currency"><select aria-label="Currency" value={form.baseCurrency} onChange={(e) => updateForm({ baseCurrency: e.target.value })} className="ui-select w-full">{currencyOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
        <Field label="Number Format"><select aria-label="Number Format" value={form.numberFormat} onChange={(e) => updateForm({ numberFormat: e.target.value })} className="ui-select w-full"><option value="12,34,567.89">12,34,567.89</option><option value="1,234,567.89">1,234,567.89</option><option value="1.234.567,89">1.234.567,89</option></select></Field>
        <Field label="Date Format"><select aria-label="Date Format" value={form.dateFormat} onChange={(e) => updateForm({ dateFormat: e.target.value })} className="ui-select w-full"><option value="DD-MM-YYYY">DD-MM-YYYY</option><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></select></Field>
        <Field label="Financial Year Begins From"><input aria-label="Financial Year Begins From" type="date" value={form.financialYearStart} onChange={(e) => updateForm({ financialYearStart: e.target.value })} className="ui-input w-full" /></Field>
        <Field label="Books Begin From"><input aria-label="Books Begin From" type="date" value={form.booksBeginDate} onChange={(e) => updateForm({ booksBeginDate: e.target.value })} className="ui-input w-full" /></Field>
      </Section>

      <Section icon={MapPin} title="Address Details" description="Enter your registered business address.">
        <Field label="Address Line 1" required><input aria-label="Address Line 1" value={form.regAddress1} onChange={(e) => updateForm({ regAddress1: e.target.value })} className="ui-input w-full" /></Field>
        <Field label="Address Line 2"><input aria-label="Address Line 2" value={form.regAddress2} onChange={(e) => updateForm({ regAddress2: e.target.value })} className="ui-input w-full" /></Field>
        <Field label="Country" required><select aria-label="Country" value={form.regCountry} onChange={(e) => updateForm({ regCountry: e.target.value, country: e.target.value })} className="ui-select w-full">{countryOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
        <Field label="State" required><select aria-label="State" value={form.regStateCode} onChange={(e) => updateForm({ regStateCode: e.target.value })} className="ui-select w-full"><option value="">Select state</option>{states.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></Field>
        <Field label="City" required><input aria-label="City" value={form.regCity} onChange={(e) => updateForm({ regCity: e.target.value })} className="ui-input w-full" /></Field>
        <Field label="PIN" required><input aria-label="PIN" inputMode="numeric" value={form.regPincode} onChange={(e) => updateForm({ regPincode: e.target.value })} className="ui-input w-full" /></Field>
      </Section>

      <Section icon={ShieldCheck} title="Statutory & Contact Details" description="Enter contact and regulatory information.">
        <Field label="Mobile"><input aria-label="Mobile" inputMode="tel" value={form.phone} onChange={(e) => updateForm({ phone: e.target.value })} className="ui-input w-full" /></Field>
        <Field label="Email"><input aria-label="Email" type="email" value={form.officialEmail} onChange={(e) => updateForm({ officialEmail: e.target.value })} className="ui-input w-full" /></Field>
        <Field label="Website"><input aria-label="Website" type="url" value={form.website} onChange={(e) => updateForm({ website: e.target.value })} className="ui-input w-full" /></Field>
        <Field label="CIN"><input aria-label="CIN" value={form.cin} onChange={(e) => updateForm({ cin: e.target.value.toUpperCase() })} className="ui-input ui-mono w-full" /></Field>
        <Field label="PAN"><input aria-label="PAN" value={form.pan} onChange={(e) => updateForm({ pan: e.target.value.toUpperCase() })} className="ui-input ui-mono w-full" /></Field>
        <Field label="GSTIN"><input aria-label="GSTIN" value={form.gstin} onChange={(e) => updateForm({ gstin: e.target.value.toUpperCase() })} className="ui-input ui-mono w-full" /></Field>
      </Section>
    </div>
  );
}
