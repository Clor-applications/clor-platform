import { Info, MapPin, Plus, Trash2 } from 'lucide-react';
import PopupSelect from '@ui/components/pickers/PopupSelect';

import { allCountries } from './countries';

/**
 * The parts of the customer master that repeat.
 *
 * Two of them are tables rather than field groups, and that is the whole point
 * of the redesign: a customer with exactly one delivery address and exactly one
 * person at the other end is the exception. The old form had two fixed
 * addresses and a single `contactPerson` string, so the second warehouse and
 * the accounts clerk had nowhere to go.
 */

export const CUSTOMER_TABS = [
  { key: 'address', label: 'Address' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'credit', label: 'Credit Details' },
  { key: 'statutory', label: 'Statutory Details' },
  { key: 'others', label: 'Others' },
];

export const CURRENCY_OPTIONS = [
  { value: 'INR', label: 'INR - Indian Rupee' },
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - Pound Sterling' },
  { value: 'AED', label: 'AED - UAE Dirham' },
  { value: 'SGD', label: 'SGD - Singapore Dollar' },
];


/**
 * Label on the left, control on the right, explanation behind the icon.
 *
 * The hint is a `title` rather than always-on helper text: a form with a line of
 * prose under every field is longer than the form, and the person filling it in
 * for the twentieth time is not reading any of it.
 */
/* The label gutter is a fixed 11rem, not a minmax: a col-span-2 row resolves
   a flexible gutter wider than a half-width row does, and the controls end up
   starting at two different x positions on one card. */
export const FormRow = ({ label, hint = '', required = false, htmlFor = '', className = '', compact = false, children }) => (
  <div className={`grid grid-cols-1 gap-1.5 ${compact ? 'sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3' : 'sm:grid-cols-[11rem_minmax(16rem,1fr)] sm:gap-5'} sm:items-start ${className}`}>
    <div className="flex items-center gap-1.5 sm:pt-2">
      {/* A real <label> where the control has an id: a bare <span> beside a
          field names it for a sighted reader and for nobody else. */}
      <label className="text-sm" htmlFor={htmlFor || undefined}>
        {label}
        {required ? <span style={{ color: 'rgb(var(--neg))' }}> *</span> : null}
      </label>
      {hint ? (
        <span title={hint} aria-label={hint} className="ui-subtle inline-flex cursor-help">
          <Info size={14} aria-hidden="true" />
        </span>
      ) : null}
    </div>
    {/* One width for every control on the card.
        The left column's control took whatever was left after the label
        gutter and the right column's took its own cap, so the two sides
        differed by thirty-seven pixels — visible, and for no reason. */}
    <div className="min-w-0 sm:max-w-[25rem]">{children}</div>
  </div>
);

/** One field in an address card: its name above it, full width. */
const AddrField = ({ label, id, children }) => (
  <div className="min-w-0">
    <label className="ui-label" htmlFor={id}>{label}</label>
    {children}
  </div>
);

/**
 * One place this party can be written to.
 *
 * Billing and shipping were two rows of a table eight columns wide, which is
 * how an address is stored and not how anybody reads one. A card per address
 * puts the lines of it in the shape of an address, and leaves room for the two
 * things that are true of a particular card rather than of all of them: which
 * one invoices are addressed to, and whether shipping is simply billing again.
 */
const AddressCard = ({ row, index, states, onChange, onRemove, tone, title, subtitle, badge, linked = false }) => {
  const id = (f) => `addr-${index}-${f}`;
  const disabled = linked;

  return (
    <div className="ui-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {/*
            Brand on the address invoices are addressed to, blue on the one
            goods go to. Both are tokens with a dark-mode pair, so the pair
            holds in either theme; anything past the two built-in places is
            neutral, or a wall of coloured squares says nothing.
          */}
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={
              tone === 'brand'
                ? { backgroundColor: 'rgb(var(--brand) / 0.12)', color: 'rgb(var(--brand-ink))' }
                : tone === 'blue'
                  ? { backgroundColor: 'rgb(var(--ov-blue-soft))', color: 'rgb(var(--ov-blue))' }
                  : { backgroundColor: 'rgb(var(--surface-sunken))', color: 'rgb(var(--info))' }
            }
            aria-hidden="true"
          >
            <MapPin size={18} />
          </span>
          <div className="min-w-0">
            {row.builtIn ? (
              /* A heading element, and a shade heavier than the fields under
                 it: the card's name is what you read first when there are
                 several of them on the tab. */
              <h5 className="text-sm font-semibold">{title}</h5>
            ) : (
              <input
                value={row.label}
                onChange={(e) => onChange(index, 'label', e.target.value)}
                className="ui-input w-full min-w-0 max-w-[14rem]"
                aria-label={`Name of place, address ${index + 1}`}
                placeholder="Name of place"
              />
            )}
            <p className="ui-caption mt-0.5">{subtitle}</p>
          </div>
        </div>

        {badge}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <AddrField label="Address Line 1" id={id('line1')}>
          <input
            id={id('line1')}
            value={row.line1}
            onChange={(e) => onChange(index, 'line1', e.target.value)}
            disabled={disabled}
            className="ui-input w-full"
            placeholder="Enter address line 1"
          />
        </AddrField>
        <AddrField label="Address Line 2" id={id('line2')}>
          <input
            id={id('line2')}
            value={row.line2}
            onChange={(e) => onChange(index, 'line2', e.target.value)}
            disabled={disabled}
            className="ui-input w-full"
            placeholder="Enter address line 2"
          />
        </AddrField>
      </div>

      <div className="mt-3 grid gap-3 grid-cols-2 lg:grid-cols-4">
        {/* The picker prints its own label, which is the one a sighted reader
            sees; the spoken name says which card it belongs to. */}
        <div className="min-w-0">
          <PopupSelect
            label="Country"
            ariaLabel={`Country, address ${index + 1}`}
      title="Select Country"
            value={row.country}
            onChange={(v) => onChange(index, 'country', v)}
            options={[{ value: 'India', label: 'India' }]}
            placeholder="Country"
            allowCustom
            disabled={disabled}
          />
        </div>
        <div className="min-w-0">
          <PopupSelect
            label="State"
            ariaLabel={`State, address ${index + 1}`}
      title="Select State"
            value={row.state}
            onChange={(v) => onChange(index, 'state', v)}
            options={states.map((st) => ({ value: st.name, label: st.name, code: st.code }))}
            placeholder="Select"
            /* An Indian state decides CGST + SGST against IGST by string
               match, so a typed "Karntaka" charges the wrong tax silently.
               Outside India there is no list to pick from and typing is the
               only way in. */
            allowCustom={String(row.country || '').trim() !== 'India'}
            disabled={disabled}
          />
        </div>
        <AddrField label="City" id={id('city')}>
          <input
            id={id('city')}
            value={row.city}
            onChange={(e) => onChange(index, 'city', e.target.value)}
            disabled={disabled}
            className="ui-input w-full"
            placeholder="Enter city"
          />
        </AddrField>
        <AddrField label="Pincode" id={id('pincode')}>
          <input
            id={id('pincode')}
            value={row.pincode}
            onChange={(e) => onChange(index, 'pincode', e.target.value)}
            disabled={disabled}
            className="ui-input ui-mono w-full"
            maxLength={10}
            placeholder="Enter pincode"
          />
        </AddrField>
      </div>


      {row.builtIn ? null : (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Remove ${row.label || `address ${index + 1}`}`}
            className="ui-btn ui-btn-ghost ui-btn-sm"
          >
            <Trash2 size={14} aria-hidden="true" className="text-[rgb(var(--neg))]" /> Remove
          </button>
        </div>
      )}
    </div>
  );
};

const CustomerAddressTable = ({ rows, states, onChange, onAdd, onRemove, sameAsBilling, onSameAsBilling }) => {
  const addressCountries = allCountries();
  return (
  <section className="customer-address-table space-y-2">
    <div className="overflow-visible rounded-xl border border-[rgb(var(--border))]">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col style={{ width: '12%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '4%' }} />
        </colgroup>
        <thead>
          <tr>
            {['Location name', 'Address Line 1', 'Address Line 2', 'Country', 'State', 'City', 'PIN', ''].map((heading) => (
              <th key={heading || 'actions'} className="ui-t-label border-e border-[rgb(var(--border))] px-2 py-1.5 text-left last:border-e-0">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const linked = index === 1 && sameAsBilling;
            const locationName = index === 0 ? 'Billing' : index === 1 ? 'Shipping' : row.label || `Address ${index - 1}`;
            /* India picks from the GST state list (the state decides CGST + SGST or IGST); elsewhere it is typed. */
            const indian = !row.country || row.country === 'India';
            const countryStates = indian ? states.map((state) => ({ isoCode: state.code, name: state.name })) : [];
            return (
              <tr key={row.key ?? index}>
                <td className="border-e border-t border-[rgb(var(--border))] p-1 align-middle">
                  <div className="flex min-w-0 items-center gap-1">
                    <input
                      value={locationName}
                      onChange={(event) => onChange(index, 'label', event.target.value)}
                      readOnly={row.builtIn}
                      className="ui-input min-w-0 flex-1"
                      aria-label={`Location name, address ${index + 1}`}
                    />
                  {index === 1 && onSameAsBilling ? (
                    <label className="inline-flex shrink-0 cursor-pointer items-center" title="Same as billing">
                      <input type="checkbox" className="ui-checkbox" checked={sameAsBilling} onChange={(event) => onSameAsBilling(event.target.checked)} />
                      <span className="sr-only">Same as billing</span>
                    </label>
                  ) : null}
                  </div>
                </td>
                {[
                  ['line1', 'Address Line 1'],
                  ['line2', 'Address Line 2'],
                ].map(([key, label]) => (
                  <td key={key} className="border-e border-t border-[rgb(var(--border))] p-1 align-middle">
                    <input id={key === 'line1' ? `customer-address-${index}-line1` : undefined} value={row[key] || ''} onChange={(event) => onChange(index, key, event.target.value)} disabled={linked} className="ui-input w-full" aria-label={label} />
                  </td>
                ))}
                <td className="border-e border-t border-[rgb(var(--border))] p-1 align-middle">
                  <PopupSelect
                    value={row.country || ''}
                    onChange={(value) => {
                      onChange(index, 'country', value);
                      onChange(index, 'state', '');
                      onChange(index, 'city', '');
                    }}
                    disabled={linked}
                    ariaLabel={`Country, address ${index + 1}`}
                    title="Select Country"
                    placeholder="Country"
                    alwaysSearch
                    icon={null}
                    options={[
                      ...addressCountries.map((country) => ({ value: country.name, label: country.name, code: country.isoCode })),
                      ...(row.country && !addressCountries.some((country) => country.name === row.country) ? [{ value: row.country, label: row.country }] : []),
                    ]}
                  />
                </td>
                <td className="border-e border-t border-[rgb(var(--border))] p-1 align-middle">
                  {indian ? (
                    <PopupSelect value={row.state || ''} onChange={(value) => onChange(index, 'state', value)} disabled={linked || !row.country} ariaLabel={`State, address ${index + 1}`} title="Select State" placeholder="Select" alwaysSearch icon={null} options={[
                      ...countryStates.map((state) => ({ value: state.name, label: state.name, code: state.isoCode })),
                      ...(row.state && !countryStates.some((state) => state.name === row.state) ? [{ value: row.state, label: row.state }] : []),
                    ]} />
                  ) : (
                    <input value={row.state || ''} onChange={(event) => onChange(index, 'state', event.target.value)} disabled={linked} className="ui-input w-full" maxLength={80} aria-label={`State, address ${index + 1}`} placeholder="State / region" />
                  )}
                </td>
                <td className="border-e border-t border-[rgb(var(--border))] p-1 align-middle">
                  <input value={row.city || ''} onChange={(event) => onChange(index, 'city', event.target.value)} disabled={linked} className="ui-input w-full" maxLength={80} aria-label={`City, address ${index + 1}`} placeholder="City" autoComplete="address-level2" />
                </td>
                <td className="border-e border-t border-[rgb(var(--border))] p-1 align-middle">
                  <input value={row.pincode || ''} onChange={(event) => onChange(index, 'pincode', event.target.value)} disabled={linked} className="ui-input ui-mono w-full" maxLength={10} aria-label="Pincode" />
                </td>
                <td className="border-t border-[rgb(var(--border))] p-1 text-center align-middle">
                  <button
                    type="button"
                    className="customer-address-delete ui-icon-btn mx-auto text-[rgb(var(--neg))] disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label={`Delete ${locationName}`}
                    title={row.builtIn ? `${locationName} cannot be deleted` : `Delete ${locationName}`}
                    disabled={row.builtIn}
                    onClick={() => onRemove(index)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <button type="button" onClick={onAdd} className="ui-btn ui-btn-ghost ui-btn-sm px-1">
      <Plus size={14} aria-hidden="true" /> Add Address
    </button>
  </section>
  );
};

export const AddressTab = ({
  rows,
  states,
  onChange,
  onAdd,
  onRemove,
  /* Shipping is the billing address far more often than not. */
  sameAsBilling = false,
  onSameAsBilling = null,
  /* The ledger master reuses this and has no customers, so the copy is a prop
     rather than the customer wording repeated in a second component. */
  caption = 'Billing and shipping addresses are here by default. Add more places below if you need them.',
  /* 'cards' for the party masters, where billing and shipping are objects
     with their own linkage; 'table' for a ledger, where an address is one
     line of fields the way a contact person is. */
  variant = 'cards',
}) => (
  variant === 'customer-table' ? (
    <CustomerAddressTable
      rows={rows}
      states={states}
      onChange={onChange}
      onAdd={onAdd}
      onRemove={onRemove}
      sameAsBilling={sameAsBilling}
      onSameAsBilling={onSameAsBilling}
    />
  ) : variant === 'table' ? (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="party-section-title ui-t-sec">Address</h4>
          <p className="party-section-copy ui-caption mt-0.5">{caption}</p>
        </div>
        <button type="button" onClick={onAdd} className="ui-btn ui-btn-secondary shrink-0">
          <Plus size={16} aria-hidden="true" /> Add Address
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead>
            <tr>
              {['Name of place', 'Address Line 1', 'Address Line 2', 'City', 'State', 'Pincode'].map((c) => (
                <th key={c} className="ui-t-label px-2 py-2 text-left">
                  {c}
                </th>
              ))}
              <th
                className="ui-t-label sticky end-0 w-20 px-2 py-2 text-center"
                style={{ backgroundColor: 'rgb(var(--surface))' }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key ?? i}>
                <td className="px-1 py-1">
                  <input value={r.label} onChange={(e) => onChange(i, 'label', e.target.value)} className="ui-input w-full min-w-[8rem]" aria-label={`Name of place, address ${i + 1}`} placeholder="Registered Office" />
                </td>
                <td className="px-1 py-1">
                  <input value={r.line1} onChange={(e) => onChange(i, 'line1', e.target.value)} className="ui-input w-full min-w-[9rem]" aria-label={`Address line 1, address ${i + 1}`} />
                </td>
                <td className="px-1 py-1">
                  <input value={r.line2} onChange={(e) => onChange(i, 'line2', e.target.value)} className="ui-input w-full min-w-[9rem]" aria-label={`Address line 2, address ${i + 1}`} />
                </td>
                <td className="px-1 py-1">
                  <input value={r.city} onChange={(e) => onChange(i, 'city', e.target.value)} className="ui-input w-full min-w-[7rem]" aria-label={`City, address ${i + 1}`} />
                </td>
                <td className="px-1 py-1">
                  {/* A state typed in from outside the list (a foreign
                      address) still shows rather than snapping to blank. */}
                  <select value={r.state} onChange={(e) => onChange(i, 'state', e.target.value)} className="ui-select w-full min-w-[8rem]" aria-label={`State, address ${i + 1}`}>
                    <option value="">Select</option>
                    {states.map((st) => (
                      <option key={st.code} value={st.name}>{st.name}</option>
                    ))}
                    {r.state && !states.some((st) => st.name === r.state) ? <option value={r.state}>{r.state}</option> : null}
                  </select>
                </td>
                <td className="px-1 py-1">
                  <input value={r.pincode} onChange={(e) => onChange(i, 'pincode', e.target.value)} className="ui-input ui-mono w-full min-w-[6rem]" maxLength={10} aria-label={`Pincode, address ${i + 1}`} />
                </td>
                <td
                  className="sticky end-0 px-1 py-1 text-center"
                  style={{ backgroundColor: 'rgb(var(--surface))' }}
                >
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    aria-label={`Remove address ${i + 1}`}
                    className="ui-icon-btn mx-auto"
                  >
                    <Trash2 size={16} aria-hidden="true" className="text-[rgb(var(--neg))]" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  ) : (
  <section className="space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="party-section-title ui-t-sec">Address</h4>
        <p className="party-section-copy ui-caption mt-0.5">{caption}</p>
      </div>

      {/* At the head of the group it adds to, where the mockup puts it and
          where a section action belongs. */}
      <button type="button" onClick={onAdd} className="ui-btn ui-btn-secondary shrink-0">
        <Plus size={16} aria-hidden="true" /> Add Address
      </button>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((r, i) => (
        <AddressCard
          key={r.key ?? i}
          row={r}
          index={i}
          states={states}
          onChange={onChange}
          onRemove={onRemove}
          tone={i === 0 ? 'brand' : i === 1 ? 'blue' : 'muted'}
          title={i === 0 ? 'Billing Address' : i === 1 ? 'Shipping Address' : r.label || `Address ${i + 1}`}
          subtitle={
            i === 0
              ? 'Primary address for invoices and accounting.'
              : i === 1
                ? 'Used for delivery and correspondence.'
                : 'Another place goods or documents go.'
          }
          /* Shipping copies billing while the box is ticked, so the two cannot
             drift apart by a door number. */
          linked={i === 1 && sameAsBilling}
          badge={
            i === 0 ? (
              <span
                className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ backgroundColor: 'rgb(var(--brand) / 0.12)', color: 'rgb(var(--brand-ink))' }}
              >
                Primary
              </span>
            ) : i === 1 && onSameAsBilling ? (
              <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={sameAsBilling}
                  onChange={(e) => onSameAsBilling(e.target.checked)}
                />
                Same as billing
              </label>
            ) : null
          }
        />
      ))}
    </div>
  </section>
  )
);

export const ContactsTab = ({
  rows,
  onChange,
  onAdd,
  onRemove,
  onSetPrimary = null,
  heading = 'Contacts',
  caption = 'The people at this customer. The one marked primary is who a reminder is addressed to.',
}) => (
  <section className="space-y-3">
    <div>
      <h4 className="party-section-title ui-t-sec">{heading}</h4>
      <p className="party-section-copy ui-caption mt-0.5">{caption}</p>
    </div>

    {/*
      A row is already there to type into. An empty state with an Add button is
      one click before anybody can start, and the commonest case by far is a
      customer with exactly one contact.
    */}
    <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] border-collapse text-sm">
          <thead>
            <tr>
              {/* Centred over the control, not aligned to the word above it:
                  a radio under the P of PRIMARY reads as belonging to the
                  column before it. */}
              {onSetPrimary ? <th className="ui-t-label w-20 px-2 py-2 text-center">Primary</th> : null}
              {['Name', 'Position', 'Email', 'Mobile'].map((c) => (
                <th key={c} className="ui-t-label px-2 py-2 text-left">
                  {c}
                </th>
              ))}
              {/* Pinned to the right edge so the delete control is on screen
                  however far the table is scrolled. */}
              <th
                className="ui-t-label sticky end-0 w-20 px-2 py-2 text-center"
                style={{ backgroundColor: 'rgb(var(--surface))' }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {/*
                  Which of them a reminder is addressed to. Both masters ask for
                  it, and without it the first row typed was the one every
                  message went to — so adding an accounts clerk above the person
                  you actually deal with quietly redirected the correspondence.
                */}
                {onSetPrimary ? (
                  <td className="px-1 py-1 text-center">
                    <input
                      type="radio"
                      name="party-primary-contact"
                      /* `.ui-radio` is display:grid, so it is a block and the
                         cell's text-align does not move it. */
                      className="ui-radio mx-auto"
                      checked={Boolean(r.isPrimary) || (!rows.some((c) => c?.isPrimary) && i === 0)}
                      onChange={() => onSetPrimary(i)}
                      aria-label={`Primary contact, row ${i + 1}`}
                    />
                  </td>
                ) : null}
                <td className="px-1 py-1">
                  <input value={r.name} onChange={(e) => onChange(i, 'name', e.target.value)} className="ui-input w-full min-w-[8rem]" aria-label={`Contact name, row ${i + 1}`} />
                </td>
                <td className="px-1 py-1">
                  <input value={r.position} onChange={(e) => onChange(i, 'position', e.target.value)} className="ui-input w-full min-w-[7rem]" aria-label={`Position, row ${i + 1}`} />
                </td>
                <td className="px-1 py-1">
                  <input type="email" value={r.email} onChange={(e) => onChange(i, 'email', e.target.value)} className="ui-input w-full min-w-[9rem]" aria-label={`Email, row ${i + 1}`} />
                </td>
                <td className="px-1 py-1">
                  <input value={r.mobile} onChange={(e) => onChange(i, 'mobile', e.target.value)} className="ui-input ui-mono w-full min-w-[7rem]" aria-label={`Mobile, row ${i + 1}`} />
                </td>
                <td
                  className="sticky end-0 px-1 py-1 text-center"
                  style={{ backgroundColor: 'rgb(var(--surface))' }}
                >
                  {/* A target the size of the fields it sits beside. At 32px
                      in a 36px row it was the smallest thing to hit on the
                      tab, and the only one you cannot undo. */}
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    aria-label={`Remove contact ${i + 1}`}
                    className="ui-icon-btn mx-auto !h-9 !w-9"
                  >
                    {/* The same red every other delete in the product carries.
                        Grey, it read as one more field control. */}
                    <Trash2 size={18} aria-hidden="true" className="text-[rgb(var(--neg))]" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
    </div>

    <div>
      <button type="button" onClick={onAdd} className="ui-btn ui-btn-secondary">
        <Plus size={16} aria-hidden="true" /> Add Contact
      </button>
    </div>
  </section>
);
