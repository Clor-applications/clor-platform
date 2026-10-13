# Ledger and Customer masters — what the specs ask for, and what is there

Inspected 2026-09-10 against the two supplied PDFs. The vendor specification was
referred to but not attached, so nothing here covers it.

---

## Customer Creation Form

Built 2026-09-09 to an earlier version of this spec, so most of it stands.

### Already there
Basic Details above the tabs, in order: GST Registration Type (Registered /
Unregistered), GSTIN with Fetch from GSTN, Customer Name, Customer Group,
Currency, Opening Balance, Opening Balance Type defaulting to Dr · the five
horizontal tabs Address, Contacts, Credit Details, Statutory Details, Others ·
address table with the eight named columns and Add Address · contacts table with
Name, Position, Email, Mobile and Add Contact · Credit Details holding only
Credit Period, Credit Limit and Price List, with currency deliberately not
repeated there · Statutory showing GSTIN read-only beside PAN, MSME and Others ·
customer code auto-generated as CUS-0001 · GSTN fetch that fills blanks and does
not overwrite what was typed.

### To change
| Spec | Now |
|---|---|
| Save and Cancel at the top-right of the header | A bottom action bar |
| A three-dot secondary menu in the header | None |
| No bottom primary action bar | Present |
| Others: Active / Inactive | Not offered |
| Remarks excluded | A Notes field is present |
| Statutory: GST Registration / Treatment shown | Only in Basic Details |

---

## Ledger Creation Module

The existing `ChartAccountForm` is one flat form of about 470 lines. It holds
Ledger Name, Group, Opening Balance, a default GST rate, and four bank fields
inline.

### Already there
Ledger name with duplicate validation · hierarchical group selector that can
create a group inline · opening balance · bank name, account number, branch and
IFSC · the accounting wiring that makes a ledger usable the moment it is saved.

### To add
| Spec | Now |
|---|---|
| Currency in Basic Details | Absent |
| Opening Balance Type (Dr / Cr) | Absent |
| Horizontal tabs, shown by group | No tabs; everything inline |
| Bank Details: Account Type, Account Holder Name, UPI ID, Branch Address | Absent |
| Statutory Details as its own tab: PAN, GSTIN, Fetch from GSTN | Absent |
| Address table, multiple | Absent |
| Contact Persons table, multiple | Absent |
| TDS Details tab driven by group classification | Absent |
| TCS Details tab | Absent |
| GST Details tab | A single "Default GST rate" field inline |

### To remove
Description, and anything resembling custom fields, reporting tags or remarks —
the spec excludes all four from the approved form.

### Deliberately NOT doing
The spec's data model lists `TDSSection` and `TDSRateRule` as new entities. The
product already has a section and rate table with thresholds, deductee-type
rates and the Income-tax Act 2025 references, built 2026-09-08. Adding a second
one would be two sources of truth for the same rates. The ledger's TDS tab
references what exists.

Nothing in either spec asks for a change to how anything posts, so no posting
logic, ledger seeding or existing column is touched.
