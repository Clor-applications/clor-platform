import { Building2, Image, MapPin, ShieldCheck } from 'lucide-react';

import { GST_STATE_BY_CODE } from '@ui/utils/gst';

const Detail = ({ label, value, mono = false }) => (
  <div className="company-profile-detail">
    <div className="ui-detail-label">{label}</div>
    <div className={mono ? 'company-profile-readonly ui-input ui-detail-mono' : 'company-profile-readonly ui-input'}>{String(value || '').trim()}</div>
  </div>
);

const Section = ({ icon: Icon, title, children }) => (
  <section className="company-profile-section">
    <div className="company-profile-section-head">
      <span className="company-profile-section-icon"><Icon size={16} aria-hidden="true" /></span>
      <div><h3>{title}</h3></div>
    </div>
    <div className="company-profile-grid">{children}</div>
  </section>
);

export const CompanyProfileDetails = ({ form, company }) => {
  const stateName = GST_STATE_BY_CODE?.[String(form.regStateCode || '').trim()] || form.regStateName || '';

  return (
    <div className="company-profile-form max-w-5xl" aria-label="Company details">
      <Section icon={Building2} title="Basic Details">
        <div className="company-logo-field">
          <div className="ui-detail-label">Company Logo</div>
          <div className="company-logo-control">
            <span className="company-logo-preview">
              {form.logo ? <img src={form.logo} alt="Company logo" /> : <Image size={20} aria-hidden="true" />}
            </span>
          </div>
        </div>
        <Detail label="Company Name" value={form.companyName || company?.name} />
        <Detail label="Legal Name" value={form.legalName} />
        <Detail label="Date of Incorporation" value={form.incorporationDate} />
        <Detail label="Currency" value={form.baseCurrency} />
        <Detail label="Number Format" value={form.numberFormat} mono />
        <Detail label="Date Format" value={form.dateFormat} mono />
        <Detail label="Financial Year Begins From" value={form.financialYearStart} />
        <Detail label="Books Begin From" value={form.booksBeginDate} />
      </Section>

      <Section icon={MapPin} title="Address Details">
        <Detail label="Address Line 1" value={form.regAddress1} />
        <Detail label="Address Line 2" value={form.regAddress2} />
        <Detail label="Country" value={form.regCountry || form.country} />
        <Detail label="State" value={stateName} />
        <Detail label="City" value={form.regCity} />
        <Detail label="PIN" value={form.regPincode} mono />
      </Section>

      <Section icon={ShieldCheck} title="Statutory & Contact Details">
        <Detail label="Mobile" value={form.phone} mono />
        <Detail label="Email" value={form.officialEmail} />
        <Detail label="Website" value={form.website} />
        <Detail label="CIN" value={form.cin} mono />
        <Detail label="PAN" value={form.pan} mono />
        <Detail label="GSTIN" value={form.gstin || company?.gstin} mono />
      </Section>
    </div>
  );
};

export default CompanyProfileDetails;
