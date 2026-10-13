import { useState } from 'react';
import { Search } from 'lucide-react';

import { FormRow } from '../../components/pickers/customerFormParts';
import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';
import { lookupGstin } from '@ui/api/masters';
import { notify } from '@ui/components/ui/notify';

/**
 * The company, asked the way the customer master is asked.
 *
 * Signup used to take a name and a state and nothing else, so a business
 * arrived in its own books with no legal name, no address, no financial year
 * and no contact — all of which an invoice needs, and all of which had to be
 * gone back for later. This is the same shape as the customer form because a
 * company is the same kind of record, and asking for it twice in two different
 * visual languages is how a product starts to feel assembled rather than made.
 *
 * Only three things are required: the legal name, the state, and the currency.
 * The state decides how tax splits on every invoice ever raised; the rest can
 * be filled in later without anything being wrong in the meantime.
 */

export const ENTITY_TYPES = ['Proprietorship', 'Partnership', 'Pvt Ltd', 'Ltd', 'LLP'];
/*
 * Broad enough that most businesses find themselves, short enough to read.
 * Three was not a list, it was a guess — a logistics company, a hospital and a
 * software firm all had to call themselves "Services".
 */
export const INDUSTRIES = [
  'Retail',
  'Wholesale & Distribution',
  'Manufacturing',
  'Construction & Real Estate',
  'Transport & Logistics',
  'Information Technology',
  'Professional Services',
  'Healthcare & Pharma',
  'Education & Training',
  'Hospitality & Food',
  'Agriculture & Allied',
  'Textiles & Apparel',
  'Automotive',
  'Electronics & Electricals',
  'Chemicals & Plastics',
  'Financial Services',
  'Media & Advertising',
  'E-commerce',
  'Jewellery & Precious Metals',
  'Other Services',
];
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

export const COMPANY_TABS = [
  { key: 'basic', label: 'Basic Details' },
  { key: 'contact', label: 'Contact' },
  { key: 'address', label: 'Registered Address' },
];

export const emptyCompanyForm = () => ({
  legalName: '',
  tradeName: '',
  entityType: 'Pvt Ltd',
  industries: [],
  gstin: '',
  state: '',
  incorporationDate: '',
  financialYearStart: '',
  booksBeginDate: '',
  baseCurrency: 'INR',
  country: 'India',
  timeZone: 'Asia/Kolkata',
  officialEmail: '',
  phone: '',
  website: '',
  regAddress1: '',
  regAddress2: '',
  regCity: '',
  regDistrict: '',
  regPincode: '',
});

const STATES = Object.values(GST_STATE_BY_CODE).sort((a, b) => a.localeCompare(b));

export function CompanyFormFields({ form, setForm, disabled = false, authToken = '' }) {
  const [tab, setTab] = useState('basic');
  const [fetching, setFetching] = useState(false);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  /*
   * The first two digits of a GSTIN are the state code, so a GSTIN and a
   * contradicting state cannot both be right. The state follows the number
   * rather than the two being allowed to disagree.
   */
  const stateFromGstin = getGstStateFromGstin(form.gstin);
  const stateLocked = Boolean(stateFromGstin);

  /*
   * What the number itself says is filled without asking: the state from its
   * first two digits, the PAN from characters 3-12, and the legal name and
   * address where a portal is configured. Nothing already typed is overwritten
   * — somebody who filled the address by hand should not lose it to a lookup.
   */
  const fetchFromGstin = async () => {
    const gstin = String(form.gstin || '').trim().toUpperCase();
    if (gstin.length !== 15) {
      notify.error('Enter the 15-character GSTIN first.');
      return;
    }
    setFetching(true);
    try {
      const data = await lookupGstin(gstin, authToken);
      setForm((p) => ({
        ...p,
        gstin,
        state: data?.state || p.state,
        legalName: p.legalName || data?.legalName || '',
        tradeName: p.tradeName || data?.tradeName || '',
        regAddress1: p.regAddress1 || data?.address?.line1 || '',
        regCity: p.regCity || data?.address?.city || '',
        regDistrict: p.regDistrict || data?.address?.district || '',
        regPincode: p.regPincode || data?.address?.pincode || '',
      }));
      notify.success(data?.source === 'derived' ? 'State filled from the GSTIN.' : 'Fetched from the GST portal.');
    } catch (e) {
      notify.error(String(e?.message || 'Could not fetch that GSTIN.'));
    } finally {
      setFetching(false);
    }
  };

  const toggleIndustry = (name) =>
    setForm((p) => ({
      ...p,
      industries: p.industries.includes(name) ? p.industries.filter((x) => x !== name) : [...p.industries, name],
    }));

  return (
    <div className="space-y-6">
      <div className="ui-tabs" role="tablist" aria-label="Company details">
        {COMPANY_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`ui-tab ${tab === t.key ? 'is-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pt-2 space-y-4">
        {tab === 'basic' ? (
          <>
            <FormRow label="Legal Company Name" required hint="The registered name, as it should appear on an invoice.">
              <input
                value={form.legalName}
                onChange={set('legalName')}
                className="ui-input w-full"
                placeholder="Knockbell Logistics Pvt Ltd"
                disabled={disabled}
                autoFocus
              />
            </FormRow>

            <FormRow label="Display / Trade Name" hint="What customers call you, if that differs from the registered name.">
              <input value={form.tradeName} onChange={set('tradeName')} className="ui-input w-full" placeholder="Knockbell" disabled={disabled} />
            </FormRow>

            <FormRow label="GSTIN" hint="Optional. Its first two digits are the state, and characters 3–12 are the PAN.">
              <div className="flex items-center gap-2">
                <input
                  value={form.gstin}
                  onChange={(e) => setForm((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))}
                  className="ui-input ui-mono min-w-0 flex-1"
                  placeholder="Enter 15 digit GSTIN"
                  maxLength={15}
                  disabled={disabled}
                />
                <button
                  type="button"
                  onClick={fetchFromGstin}
                  disabled={disabled || fetching}
                  className="ui-btn ui-btn-secondary shrink-0"
                  style={{ borderColor: 'rgb(var(--brand))', color: 'rgb(var(--brand))' }}
                >
                  <Search size={14} aria-hidden="true" />
                  {fetching ? 'Fetching…' : 'Fetch from GSTN'}
                </button>
              </div>
            </FormRow>

            <FormRow
              label="State"
              required
              hint="The single most consequential field here: it decides whether a sale inside the state splits into CGST and SGST or leaves as IGST."
            >
              <select
                value={stateLocked ? stateFromGstin : form.state}
                onChange={set('state')}
                className="ui-select w-full"
                disabled={disabled || stateLocked}
              >
                <option value="">Select state</option>
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {stateLocked ? <p className="ui-caption mt-1">Taken from the GSTIN, which carries the state in its first two digits.</p> : null}
            </FormRow>

            <FormRow label="Business Type" hint="Decides which statutory registers and returns apply.">
              <select value={form.entityType} onChange={set('entityType')} className="ui-select w-full" disabled={disabled}>
                {ENTITY_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </FormRow>

            <FormRow label="Industry" hint="Select one or more. Used to suggest sensible defaults.">
              <div className="ui-card ui-in grid max-h-44 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto p-3 sm:grid-cols-2">
                {INDUSTRIES.map((name) => (
                  <label key={name} className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      checked={form.industries.includes(name)}
                      onChange={() => toggleIndustry(name)}
                      disabled={disabled}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </FormRow>

            <FormRow label="Financial Year Start" hint="India runs April to March. Leave blank to use that.">
              <input type="date" value={form.financialYearStart} onChange={set('financialYearStart')} className="ui-input w-full" disabled={disabled} />
            </FormRow>

            <FormRow label="Books Begin Date" hint="The day this book starts. Nothing can be posted before it.">
              <input type="date" value={form.booksBeginDate} onChange={set('booksBeginDate')} className="ui-input w-full" disabled={disabled} />
            </FormRow>

            <FormRow label="Base Currency" hint="The currency the books are kept in. Documents may be raised in others.">
              <select value={form.baseCurrency} onChange={set('baseCurrency')} className="ui-select w-full" disabled={disabled}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </FormRow>
          </>
        ) : null}

        {tab === 'contact' ? (
          <>
            <FormRow label="Official Email" hint="Where customers and vendors reach you. Printed on documents.">
              <input type="email" value={form.officialEmail} onChange={set('officialEmail')} className="ui-input w-full" disabled={disabled} />
            </FormRow>
            <FormRow label="Phone Number">
              <input value={form.phone} onChange={set('phone')} className="ui-input ui-mono w-full" disabled={disabled} />
            </FormRow>
            <FormRow label="Website">
              <input value={form.website} onChange={set('website')} className="ui-input w-full" placeholder="https://" disabled={disabled} />
            </FormRow>
          </>
        ) : null}

        {tab === 'address' ? (
          <>
            <FormRow label="Address Line 1">
              <input value={form.regAddress1} onChange={set('regAddress1')} className="ui-input w-full" disabled={disabled} />
            </FormRow>
            <FormRow label="Address Line 2">
              <input value={form.regAddress2} onChange={set('regAddress2')} className="ui-input w-full" disabled={disabled} />
            </FormRow>
            <FormRow label="City">
              <input value={form.regCity} onChange={set('regCity')} className="ui-input w-full" disabled={disabled} />
            </FormRow>
            <FormRow label="District">
              <input value={form.regDistrict} onChange={set('regDistrict')} className="ui-input w-full" disabled={disabled} />
            </FormRow>
            <FormRow label="Pincode">
              <input value={form.regPincode} onChange={set('regPincode')} className="ui-input ui-mono w-full" maxLength={10} disabled={disabled} />
            </FormRow>
            <FormRow label="Country">
              <input value={form.country} readOnly className="ui-input w-full ui-sunken" />
            </FormRow>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default CompanyFormFields;
